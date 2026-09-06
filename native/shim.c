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

/* Single-session state: one loaded core + its attached debugger, at most. */
static struct mCore* g_core = NULL;
static struct mDebugger g_debugger;

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

	if (!mCoreLoadFile(core, path)) {
		mCoreConfigDeinit(&core->config);
		core->deinit(core);
		return MCBAMGBA_ERR_LOAD_FAILED;
	}

	core->reset(core);

	g_core = core;
	memset(&g_debugger, 0, sizeof(g_debugger));
	mDebuggerAttach(&g_debugger, g_core);

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
