/* mcp-mgba native shim implementation.
 *
 * Wraps libmgba's mCore (include/mgba/core/core.h) and mDebuggerPlatform
 * (include/mgba/debugger/debugger.h) vtables behind the flat C ABI declared
 * in shim.h. No display/Qt/SDL headers are referenced here or anywhere in
 * native/ — this file only ever talks to the headless mCore/mDebugger
 * surface.
 */
#include "shim.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <mgba/debugger/debugger.h>
#include <mgba/internal/arm/decoder.h>

/* Single-session state: one loaded core + its attached debugger, at most. */
static struct mCore* g_core = NULL;
static struct mDebugger g_debugger;

/* ---- run_until_breakpoint's stop-capture state ----
 * mDebuggerEnter() (called by mDebuggerPlatform when a breakpoint/watchpoint
 * fires - see arm/debugger/debugger.c and arm/debugger/memory-debugger.c)
 * sets g_debugger.state to DEBUGGER_PAUSED *and* invokes
 * g_debugger.entered(), which this shim points at
 * mcbamgba_capture_debugger_entry() below. That's the only hook this shim
 * needs: it captures the reason + mDebuggerEntryInfo here so
 * mcbamgba_run_until_breakpoint() can report exactly what fired, right after
 * detecting the state flip. */
static enum mDebuggerEntryReason g_entry_reason;
static struct mDebuggerEntryInfo g_entry_info;

static void mcbamgba_capture_debugger_entry(struct mDebugger* debugger, enum mDebuggerEntryReason reason,
                                             struct mDebuggerEntryInfo* info) {
	(void) debugger;
	g_entry_reason = reason;
	if (info) {
		g_entry_info = *info;
	} else {
		memset(&g_entry_info, 0, sizeof(g_entry_info));
	}
}

/* The core's video renderer draws into this buffer whenever it runs
 * (runFrame/step/runLoop) - wired up via setVideoBuffer() before reset() in
 * mcbamgba_load_rom() below, since the GBA core only associates a renderer
 * at reset time if an output buffer has already been set. `color_t` is
 * `uint32_t` in this DISABLE_DEPS build (COLOR_16_BIT is not defined), laid
 * out per-byte as R,G,B,A (see mgba/core/interface.h's M_COLOR_* masks),
 * i.e. already tightly-packed RGBA8888 - mcbamgba_get_framebuffer() below
 * copies it out verbatim. */
static color_t g_framebuffer[MCBAMGBA_SCREEN_WIDTH * MCBAMGBA_SCREEN_HEIGHT];

static void mcbamgba_teardown(void) {
	if (!g_core) {
		return;
	}
	if (g_core->debugger) {
		g_core->detachDebugger(g_core);
	}
	mCoreConfigDeinit(&g_core->config);
	g_core->deinit(g_core); /* frees the mCore/GBACore struct itself */
	g_core = NULL;
	memset(&g_debugger, 0, sizeof(g_debugger));
}

int mcbamgba_load_rom(const char* path) {
	if (!path) {
		return MCBAMGBA_ERR_GENERIC;
	}

	mcbamgba_teardown();

	struct mCore* core = mCoreFind(path);
	if (!core) {
		return MCBAMGBA_ERR_NOT_FOUND;
	}

	if (!core->init(core)) {
		core->deinit(core);
		return MCBAMGBA_ERR_GENERIC;
	}

	mCoreInitConfig(core, "mcbamgba");
	mCoreLoadConfig(core);
	/* No real GBA BIOS image is bundled or discovered here, so skip
	 * straight to the cartridge entry point on reset rather than trying to
	 * execute unmapped memory at the BIOS's reset vector. */
	core->opts.skipBios = true;

	/* Must happen before the first reset() below: the GBA core only
	 * associates a video renderer with the board at reset time, and only if
	 * an output buffer has already been set (see _GBACoreReset in
	 * src/gba/core.c). Without this, getPixels() would return a renderer
	 * with no buffer at all. */
	core->setVideoBuffer(core, g_framebuffer, MCBAMGBA_SCREEN_WIDTH);

	if (!mCoreLoadFile(core, path)) {
		mCoreConfigDeinit(&core->config);
		core->deinit(core);
		return MCBAMGBA_ERR_LOAD_FAILED;
	}

	core->reset(core);

	g_core = core;
	memset(&g_debugger, 0, sizeof(g_debugger));
	mDebuggerAttach(&g_debugger, g_core);
	g_debugger.entered = mcbamgba_capture_debugger_entry;

	return MCBAMGBA_OK;
}

void mcbamgba_unload_rom(void) {
	mcbamgba_teardown();
}

int mcbamgba_is_rom_loaded(void) {
	return g_core ? 1 : 0;
}

int mcbamgba_reset(void) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	g_core->reset(g_core);
	return MCBAMGBA_OK;
}

int mcbamgba_step(void) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	g_core->step(g_core);
	return MCBAMGBA_OK;
}

int mcbamgba_run_frame(void) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	g_core->runFrame(g_core);
	return MCBAMGBA_OK;
}

int mcbamgba_set_keys(uint32_t keys) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	g_core->setKeys(g_core, keys);
	return MCBAMGBA_OK;
}

uint8_t mcbamgba_bus_read8(uint32_t address) {
	if (!g_core) {
		return 0;
	}
	return (uint8_t) g_core->busRead8(g_core, address);
}

uint16_t mcbamgba_bus_read16(uint32_t address) {
	if (!g_core) {
		return 0;
	}
	return (uint16_t) g_core->busRead16(g_core, address);
}

uint32_t mcbamgba_bus_read32(uint32_t address) {
	if (!g_core) {
		return 0;
	}
	return g_core->busRead32(g_core, address);
}

void mcbamgba_bus_write8(uint32_t address, uint8_t value) {
	if (!g_core) {
		return;
	}
	g_core->busWrite8(g_core, address, value);
}

void mcbamgba_bus_write16(uint32_t address, uint16_t value) {
	if (!g_core) {
		return;
	}
	g_core->busWrite16(g_core, address, value);
}

void mcbamgba_bus_write32(uint32_t address, uint32_t value) {
	if (!g_core) {
		return;
	}
	g_core->busWrite32(g_core, address, value);
}

/* ---- Breakpoints ---- */

int64_t mcbamgba_set_breakpoint(uint32_t address) {
	if (!g_core || !g_debugger.platform) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	struct mBreakpoint bp = {0};
	bp.address = address;
	bp.segment = -1;
	/* BREAKPOINT_SOFTWARE is unimplemented in libmgba's ARM debugger
	 * (it calls abort()) - always use BREAKPOINT_HARDWARE here. */
	bp.type = BREAKPOINT_HARDWARE;
	bp.condition = NULL;
	ssize_t id = g_debugger.platform->setBreakpoint(g_debugger.platform, &bp);
	return (int64_t) id;
}

int mcbamgba_clear_breakpoint(int64_t id) {
	if (!g_core || !g_debugger.platform) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	bool ok = g_debugger.platform->clearBreakpoint(g_debugger.platform, (ssize_t) id);
	return ok ? MCBAMGBA_OK : MCBAMGBA_ERR_NOT_FOUND;
}

int32_t mcbamgba_list_breakpoints(mcbamgba_breakpoint_t* out, int32_t max_count) {
	if (!g_core || !g_debugger.platform) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	struct mBreakpointList list;
	mBreakpointListInit(&list, 0);
	g_debugger.platform->listBreakpoints(g_debugger.platform, &list);

	size_t total = mBreakpointListSize(&list);
	int32_t written = 0;
	for (size_t i = 0; i < total && written < max_count; ++i, ++written) {
		struct mBreakpoint* bp = mBreakpointListGetPointer(&list, i);
		out[written].id = (int64_t) bp->id;
		out[written].address = bp->address;
	}

	mBreakpointListDeinit(&list);
	return written;
}

/* ---- Watchpoints ---- */

int64_t mcbamgba_set_watchpoint(uint32_t address, int32_t type) {
	if (!g_core || !g_debugger.platform) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	struct mWatchpoint wp = {0};
	wp.address = address;
	wp.segment = -1;
	wp.type = (enum mWatchpointType) type;
	wp.condition = NULL;
	ssize_t id = g_debugger.platform->setWatchpoint(g_debugger.platform, &wp);
	return (int64_t) id;
}

int mcbamgba_clear_watchpoint(int64_t id) {
	if (!g_core || !g_debugger.platform) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	/* libmgba's ARM debugger platform shares one id namespace across
	 * breakpoints and watchpoints, and clearBreakpoint() checks both lists
	 * internally - there is no separate clearWatchpoint entry point. */
	bool ok = g_debugger.platform->clearBreakpoint(g_debugger.platform, (ssize_t) id);
	return ok ? MCBAMGBA_OK : MCBAMGBA_ERR_NOT_FOUND;
}

int32_t mcbamgba_list_watchpoints(mcbamgba_watchpoint_t* out, int32_t max_count) {
	if (!g_core || !g_debugger.platform) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	struct mWatchpointList list;
	mWatchpointListInit(&list, 0);
	g_debugger.platform->listWatchpoints(g_debugger.platform, &list);

	size_t total = mWatchpointListSize(&list);
	int32_t written = 0;
	for (size_t i = 0; i < total && written < max_count; ++i, ++written) {
		struct mWatchpoint* wp = mWatchpointListGetPointer(&list, i);
		out[written].id = (int64_t) wp->id;
		out[written].address = wp->address;
		out[written].type = (int32_t) wp->type;
	}

	mWatchpointListDeinit(&list);
	return written;
}

/* ---- Registers ---- */

int32_t mcbamgba_list_registers(mcbamgba_register_t* out, int32_t max_count) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	const struct mCoreRegisterInfo* info = NULL;
	size_t total = g_core->listRegisters(g_core, &info);

	int32_t written = 0;
	for (size_t i = 0; i < total && written < max_count; ++i) {
		int32_t value = 0;
		if (!g_core->readRegister(g_core, info[i].name, &value)) {
			continue;
		}
		strncpy(out[written].name, info[i].name, MCBAMGBA_REGISTER_NAME_MAX - 1);
		out[written].name[MCBAMGBA_REGISTER_NAME_MAX - 1] = '\0';
		out[written].value = (uint32_t) value;
		++written;
	}
	return written;
}

int mcbamgba_read_register(const char* name, uint32_t* out_value) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	if (!name || !out_value) {
		return MCBAMGBA_ERR_GENERIC;
	}
	int32_t value = 0;
	if (!g_core->readRegister(g_core, name, &value)) {
		return MCBAMGBA_ERR_NOT_FOUND;
	}
	*out_value = (uint32_t) value;
	return MCBAMGBA_OK;
}

int mcbamgba_write_register(const char* name, uint32_t value) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	if (!name) {
		return MCBAMGBA_ERR_GENERIC;
	}
	int32_t signedValue = (int32_t) value;
	if (!g_core->writeRegister(g_core, name, &signedValue)) {
		return MCBAMGBA_ERR_NOT_FOUND;
	}
	return MCBAMGBA_OK;
}

/* ---- run_until_breakpoint ---- */

int mcbamgba_run_until_breakpoint(int64_t max_instructions, mcbamgba_run_result_t* out_result) {
	if (!g_core || !g_debugger.platform) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	if (!out_result) {
		return MCBAMGBA_ERR_GENERIC;
	}
	if (max_instructions <= 0) {
		max_instructions = MCBAMGBA_DEFAULT_MAX_INSTRUCTIONS;
	}

	memset(out_result, 0, sizeof(*out_result));

	/* Reset capture state and the debugger's own state so a stop left over
	 * from an earlier call (or from breakpoints/watchpoints never having
	 * fired at all) can't be mistaken for one that happens here. */
	g_debugger.state = DEBUGGER_RUNNING;
	bool hit = false;
	int64_t executed = 0;
	for (; executed < max_instructions; ++executed) {
		g_core->step(g_core);
		/* Watchpoints fire *during* step() itself, via the memory-access
		 * shim installed by mcbamgba_set_watchpoint() (see
		 * arm/debugger/memory-debugger.c) - if one already flipped the
		 * debugger to PAUSED this instruction, don't also run the
		 * breakpoint check below: it would risk overwriting the just
		 * captured watchpoint info with an unrelated breakpoint match on
		 * the same instruction. */
		if (g_debugger.state != DEBUGGER_PAUSED) {
			g_debugger.platform->checkBreakpoints(g_debugger.platform);
		}
		if (g_debugger.state == DEBUGGER_PAUSED) {
			hit = true;
			++executed; /* count the instruction that triggered the stop */
			break;
		}
	}
	g_debugger.state = DEBUGGER_RUNNING;

	if (hit) {
		out_result->instructions_run = executed;
		out_result->point_id = (int64_t) g_entry_info.pointId;
		out_result->address = g_entry_info.address;
		if (g_entry_reason == DEBUGGER_ENTER_WATCHPOINT) {
			out_result->stop_reason = MCBAMGBA_STOP_WATCHPOINT;
			out_result->watch_type = (int32_t) g_entry_info.type.wp.watchType;
			out_result->old_value = g_entry_info.type.wp.oldValue;
			out_result->new_value = g_entry_info.type.wp.newValue;
		} else {
			/* DEBUGGER_ENTER_BREAKPOINT is the only other reason this shim's
			 * debugger setup can produce - no software breakpoints, stack
			 * trace mode, or illegal-op traps are ever enabled here. */
			out_result->stop_reason = MCBAMGBA_STOP_BREAKPOINT;
		}
	} else {
		out_result->stop_reason = MCBAMGBA_STOP_CAP;
		out_result->point_id = -1;
		out_result->instructions_run = max_instructions;
		uint32_t pc = 0;
		mcbamgba_read_register("pc", &pc);
		out_result->address = pc;
	}

	return MCBAMGBA_OK;
}

/* ---- Disassembly ---- */

int32_t mcbamgba_disassemble(uint32_t address, int32_t count, mcbamgba_instruction_t* out) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	if (!out || count <= 0) {
		return MCBAMGBA_ERR_GENERIC;
	}

	/* This shim's flat mCore interface has no accessor for a live ARMCore*,
	 * so decode without one (ARMDisassemble treats a NULL `core` as "don't
	 * dereference memory for a load-literal value comment" - see
	 * arm/decoder.c's _decodeMemory - so output stays correct, just without
	 * that comment) and without a symbol table (no ELF/symbol loading is in
	 * scope for this milestone - see shim.h). Mode is read once from the
	 * live cpsr's Thumb bit and applied to the whole requested range, since
	 * this shim has no per-address mode information for arbitrary
	 * addresses (see mcbamgba_disassemble's doc comment in shim.h). */
	uint32_t cpsr = 0;
	mcbamgba_read_register("cpsr", &cpsr);
	bool thumb = (cpsr & 0x20) != 0; /* PSR bit 5 is the ARM/Thumb (T) bit */

	uint32_t addr = address;
	int32_t written = 0;
	for (; written < count; ++written) {
		struct ARMInstructionInfo info;
		mcbamgba_instruction_t* entry = &out[written];
		memset(entry, 0, sizeof(*entry));
		entry->address = addr;

		uint32_t pc_field; /* the "PC" ARMDisassemble expects: the pipelined
		                     * fetch address (instruction address + 2x its
		                     * size), matching what a live CPU would report
		                     * while executing this instruction - needed to
		                     * resolve PC-relative branches/literals. */
		if (thumb) {
			uint16_t opcode = g_core->busRead16(g_core, addr);
			ARMDecodeThumb(opcode, &info);
			entry->opcode = opcode;
			entry->size = 2;
			pc_field = addr + 4;
		} else {
			uint32_t opcode = g_core->busRead32(g_core, addr);
			ARMDecodeARM(opcode, &info);
			entry->opcode = opcode;
			entry->size = 4;
			pc_field = addr + 8;
		}

		ARMDisassemble(&info, NULL, NULL, pc_field, entry->text, MCBAMGBA_DISASM_TEXT_MAX);
		entry->text[MCBAMGBA_DISASM_TEXT_MAX - 1] = '\0';

		addr += (uint32_t) entry->size;
	}
	return written;
}

/* ---- Screenshot / framebuffer ---- */

int mcbamgba_get_framebuffer(uint8_t* out, int32_t out_size) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	int32_t needed = (int32_t) (MCBAMGBA_SCREEN_WIDTH * MCBAMGBA_SCREEN_HEIGHT * sizeof(color_t));
	if (!out || out_size < needed) {
		return MCBAMGBA_ERR_GENERIC;
	}

	const void* pixels = NULL;
	size_t stride = 0;
	g_core->getPixels(g_core, &pixels, &stride);
	if (!pixels) {
		return MCBAMGBA_ERR_GENERIC;
	}

	/* stride is in pixels, set to MCBAMGBA_SCREEN_WIDTH by setVideoBuffer()
	 * in mcbamgba_load_rom(), so the buffer is already contiguous and a
	 * single memcpy covers the whole frame - but copy row by row against
	 * `stride` regardless, in case that assumption ever changes. */
	const uint8_t* src = (const uint8_t*) pixels;
	size_t rowBytes = (size_t) MCBAMGBA_SCREEN_WIDTH * sizeof(color_t);
	size_t strideBytes = stride * sizeof(color_t);
	for (int y = 0; y < MCBAMGBA_SCREEN_HEIGHT; ++y) {
		memcpy(out + (size_t) y * rowBytes, src + (size_t) y * strideBytes, rowBytes);
	}

	/* Force the alpha byte opaque: the GBA has no real alpha channel, and
	 * nothing upstream guarantees M_COLOR_ALPHA's bits are populated. */
	for (int32_t i = 0; i < needed; i += (int32_t) sizeof(color_t)) {
		out[i + 3] = 0xFF;
	}

	return MCBAMGBA_OK;
}

/* ---- Save states ---- */

int32_t mcbamgba_state_size(void) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	return (int32_t) g_core->stateSize(g_core);
}

int mcbamgba_save_state(uint8_t* out, int32_t out_size) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	int32_t needed = (int32_t) g_core->stateSize(g_core);
	if (!out || out_size < needed) {
		return MCBAMGBA_ERR_GENERIC;
	}
	return g_core->saveState(g_core, out) ? MCBAMGBA_OK : MCBAMGBA_ERR_GENERIC;
}

int mcbamgba_load_state(const uint8_t* data, int32_t size) {
	if (!g_core) {
		return MCBAMGBA_ERR_NO_ROM;
	}
	int32_t expected = (int32_t) g_core->stateSize(g_core);
	if (!data || size < expected) {
		return MCBAMGBA_ERR_GENERIC;
	}
	return g_core->loadState(g_core, data) ? MCBAMGBA_OK : MCBAMGBA_ERR_GENERIC;
}
