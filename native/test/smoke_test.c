/* Standalone smoke test for the native shim, run against the real compiled
 * libmcbamgba_shim + libmgba - no mocking of libmgba itself, per the
 * Milestone 1 PRD's testing decisions.
 *
 * Loads the fixture ROM at native/test/fixtures/minimal.gba (a hand-built
 * minimal-header GBA ROM - see native/test/fixtures/README.md), steps the
 * CPU through its four instructions, and confirms that the known constant
 * it writes (0x42) shows up at the known IWRAM address (0x03000000). Also
 * exercises reset, breakpoint/watchpoint set+list+clear, and register
 * read/write/list, since those are cheap to check here too and are the
 * next milestones' load-bearing surface.
 */
#include "shim.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int g_failures = 0;

#define CHECK(cond, msg) \
	do { \
		if (!(cond)) { \
			fprintf(stderr, "FAIL: %s (%s:%d)\n", (msg), __FILE__, __LINE__); \
			++g_failures; \
		} else { \
			printf("ok: %s\n", (msg)); \
		} \
	} while (0)

int main(int argc, char** argv) {
	const char* rom_path = argc > 1 ? argv[1] : "native/test/fixtures/minimal.gba";

	CHECK(mcbamgba_is_rom_loaded() == 0, "no ROM loaded initially");

	int rc = mcbamgba_load_rom(rom_path);
	if (rc != MCBAMGBA_OK) {
		fprintf(stderr, "FAIL: mcbamgba_load_rom(\"%s\") returned %d\n", rom_path, rc);
		return 1;
	}
	CHECK(mcbamgba_is_rom_loaded() == 1, "ROM reports loaded after load_rom");

	/* The fixture's ROM entry point is a branch over the header to its
	 * real code: MOV R0,#IWRAM; MOV R1,#0x42; STR R1,[R0]; loop. Step past
	 * the branch and all three, then confirm the write landed. */
	for (int i = 0; i < 4; ++i) {
		CHECK(mcbamgba_step() == MCBAMGBA_OK, "step succeeds");
	}

	uint8_t value = mcbamgba_bus_read8(0x03000000);
	CHECK(value == 0x42, "known IWRAM address holds the fixture's known constant");

	uint32_t value32 = mcbamgba_bus_read32(0x03000000);
	CHECK((value32 & 0xFF) == 0x42, "32-bit read agrees with the 8-bit read");

	/* Registers: PC should be past the store, sitting on the loop
	 * instruction's prefetch. */
	uint32_t pc = 0;
	CHECK(mcbamgba_read_register("pc", &pc) == MCBAMGBA_OK, "read_register(pc) succeeds");
	CHECK(pc == 0x080000D0, "pc has advanced past the fixture's store instruction");

	CHECK(mcbamgba_write_register("r2", 0x1234) == MCBAMGBA_OK, "write_register(r2) succeeds");
	uint32_t r2 = 0;
	CHECK(mcbamgba_read_register("r2", &r2) == MCBAMGBA_OK && r2 == 0x1234, "write_register round-trips");

	mcbamgba_register_t regs[MCBAMGBA_REGISTER_NAME_MAX * 2];
	int32_t reg_count = mcbamgba_list_registers(regs, 64);
	CHECK(reg_count > 0, "list_registers returns at least one register");

	/* Breakpoints/watchpoints: wired now per the PRD's "cheap to add"
	 * note, even though hit-detection during step() is Milestone 3. */
	int64_t bp_id = mcbamgba_set_breakpoint(0x080000C0);
	CHECK(bp_id >= 1, "set_breakpoint returns a positive id");

	mcbamgba_breakpoint_t bps[8];
	int32_t bp_count = mcbamgba_list_breakpoints(bps, 8);
	CHECK(bp_count == 1 && bps[0].id == bp_id && bps[0].address == 0x080000C0,
	      "list_breakpoints reflects the breakpoint just set");

	CHECK(mcbamgba_clear_breakpoint(bp_id) == MCBAMGBA_OK, "clear_breakpoint succeeds");
	bp_count = mcbamgba_list_breakpoints(bps, 8);
	CHECK(bp_count == 0, "list_breakpoints is empty after clearing");

	int64_t wp_id = mcbamgba_set_watchpoint(0x03000000, MCBAMGBA_WATCHPOINT_WRITE);
	CHECK(wp_id >= 1, "set_watchpoint returns a positive id");

	mcbamgba_watchpoint_t wps[8];
	int32_t wp_count = mcbamgba_list_watchpoints(wps, 8);
	CHECK(wp_count == 1 && wps[0].id == wp_id, "list_watchpoints reflects the watchpoint just set");

	CHECK(mcbamgba_clear_watchpoint(wp_id) == MCBAMGBA_OK, "clear_watchpoint succeeds");
	wp_count = mcbamgba_list_watchpoints(wps, 8);
	CHECK(wp_count == 0, "list_watchpoints is empty after clearing");

	/* Frame stepping: the fixture loops forever on its last instruction, so
	 * running whole frames should just burn cycles without crashing or
	 * moving IWRAM's known value. */
	for (int i = 0; i < 3; ++i) {
		CHECK(mcbamgba_run_frame() == MCBAMGBA_OK, "run_frame succeeds");
	}
	CHECK(mcbamgba_bus_read8(0x03000000) == 0x42, "IWRAM value survives run_frame");

	/* Input: KEYINPUT (0x04000130) is active-low, so holding A (bit 0)
	 * should clear that bit once the I/O register is read back. */
	CHECK(mcbamgba_set_keys(MCBAMGBA_KEY_A) == MCBAMGBA_OK, "set_keys succeeds");
	uint16_t keyinput = mcbamgba_bus_read16(0x04000130);
	CHECK((keyinput & MCBAMGBA_KEY_A) == 0, "KEYINPUT reflects A held (active-low)");
	CHECK(mcbamgba_set_keys(0) == MCBAMGBA_OK, "set_keys(0) releases all keys");
	keyinput = mcbamgba_bus_read16(0x04000130);
	CHECK((keyinput & MCBAMGBA_KEY_A) != 0, "KEYINPUT reflects A released");

	/* Screenshot / framebuffer. */
	static uint8_t framebuffer[MCBAMGBA_SCREEN_WIDTH * MCBAMGBA_SCREEN_HEIGHT * 4];
	CHECK(mcbamgba_get_framebuffer(framebuffer, sizeof(framebuffer)) == MCBAMGBA_OK,
	      "get_framebuffer succeeds");
	CHECK(framebuffer[3] == 0xFF, "framebuffer alpha byte is forced opaque");
	CHECK(mcbamgba_get_framebuffer(framebuffer, 4) == MCBAMGBA_ERR_GENERIC,
	      "get_framebuffer rejects an undersized buffer");

	/* Save states: save, mutate memory further, load, confirm the mutation
	 * is undone and the original known value is back. */
	int32_t state_size = mcbamgba_state_size();
	CHECK(state_size > 0, "state_size returns a positive size");

	uint8_t* state_buf = malloc((size_t) state_size);
	CHECK(mcbamgba_save_state(state_buf, state_size) == MCBAMGBA_OK, "save_state succeeds");

	mcbamgba_bus_write8(0x03000000, 0x99);
	CHECK(mcbamgba_bus_read8(0x03000000) == 0x99, "mutation after save_state took effect");

	CHECK(mcbamgba_load_state(state_buf, state_size) == MCBAMGBA_OK, "load_state succeeds");
	CHECK(mcbamgba_bus_read8(0x03000000) == 0x42,
	      "load_state restores the value from the save point");
	free(state_buf);

	/* Reset should bring PC back to its just-loaded state, before the
	 * fixture's entry-point branch has executed. */
	CHECK(mcbamgba_reset() == MCBAMGBA_OK, "reset succeeds");
	CHECK(mcbamgba_read_register("pc", &pc) == MCBAMGBA_OK && pc == 0x08000004,
	      "pc is back at its post-reset value");

	mcbamgba_unload_rom();
	CHECK(mcbamgba_is_rom_loaded() == 0, "ROM reports unloaded after unload_rom");

	if (g_failures > 0) {
		fprintf(stderr, "\n%d check(s) failed\n", g_failures);
		return 1;
	}
	printf("\nall checks passed\n");
	return 0;
}
