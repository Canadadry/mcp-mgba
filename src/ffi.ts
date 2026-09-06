/**
 * koffi bindings to the native shim's flat C ABI (native/shim.h).
 *
 * This module is pure type marshaling: one koffi `.func()` declaration per
 * shim export, with argument/return types matching shim.h exactly, plus the
 * handful of numeric constants shim.h defines. No control flow, retries, or
 * "no ROM loaded" logic belongs here - see src/session.ts for that.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import koffi from "koffi";

/** Locates the compiled shim library for the current platform.
 *
 * Mirrors native/build.sh's platform-directory naming (`${os}-${arch}`,
 * e.g. `linux-x64`, `darwin-arm64`) and output layout
 * (`native/build/<platform>/libmcbamgba_shim.{so,dylib}`). Milestone 5 adds
 * a `prebuilt/` fallback for published packages; for now this always
 * resolves to a locally-built shim, unless MCBAMGBA_SHIM_PATH overrides it
 * (used by tests and anyone pointing at a shim built elsewhere). */
function resolveShimPath(): string {
	const override = process.env.MCBAMGBA_SHIM_PATH;
	if (override) {
		return override;
	}

	let os: string;
	switch (process.platform) {
		case "linux":
			os = "linux";
			break;
		case "darwin":
			os = "darwin";
			break;
		default:
			throw new Error(
				`mcp-mgba: unsupported platform '${process.platform}' (native shim only builds for linux/darwin - see native/build.sh)`,
			);
	}

	let arch: string;
	switch (process.arch) {
		case "x64":
			arch = "x64";
			break;
		case "arm64":
			arch = "arm64";
			break;
		default:
			throw new Error(
				`mcp-mgba: unsupported architecture '${process.arch}' (native shim only builds for x64/arm64 - see native/build.sh)`,
			);
	}

	const ext = os === "darwin" ? "dylib" : "so";
	const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const shimPath = path.join(
		projectRoot,
		"native",
		"build",
		`${os}-${arch}`,
		`libmcbamgba_shim.${ext}`,
	);

	if (!existsSync(shimPath)) {
		throw new Error(
			`mcp-mgba: native shim not found at ${shimPath} - build it first with ` +
				`'native/build.sh' (or set MCBAMGBA_SHIM_PATH to point at an existing build)`,
		);
	}
	return shimPath;
}

const lib = koffi.load(resolveShimPath());

/* ---- Error codes (mirrors shim.h's MCBAMGBA_ERR_* / MCBAMGBA_OK) ---- */
export const MCBAMGBA_OK = 0;
export const MCBAMGBA_ERR_GENERIC = -1;
export const MCBAMGBA_ERR_NO_ROM = -2;
export const MCBAMGBA_ERR_LOAD_FAILED = -3;
export const MCBAMGBA_ERR_NOT_FOUND = -4;

/* ---- Watchpoint types (mirrors shim.h's MCBAMGBA_WATCHPOINT_*) ---- */
export const MCBAMGBA_WATCHPOINT_WRITE = 1;
export const MCBAMGBA_WATCHPOINT_READ = 2;
export const MCBAMGBA_WATCHPOINT_RW = 3;
export const MCBAMGBA_WATCHPOINT_CHANGE = 4;
export const MCBAMGBA_WATCHPOINT_WRITE_CHANGE = 5;

/* ---- Input key bits (mirrors shim.h's MCBAMGBA_KEY_*) ---- */
export const MCBAMGBA_KEY_A = 0x0001;
export const MCBAMGBA_KEY_B = 0x0002;
export const MCBAMGBA_KEY_SELECT = 0x0004;
export const MCBAMGBA_KEY_START = 0x0008;
export const MCBAMGBA_KEY_RIGHT = 0x0010;
export const MCBAMGBA_KEY_LEFT = 0x0020;
export const MCBAMGBA_KEY_UP = 0x0040;
export const MCBAMGBA_KEY_DOWN = 0x0080;
export const MCBAMGBA_KEY_R = 0x0100;
export const MCBAMGBA_KEY_L = 0x0200;

/* ---- Screen dimensions (mirrors shim.h's MCBAMGBA_SCREEN_*) ---- */
export const MCBAMGBA_SCREEN_WIDTH = 240;
export const MCBAMGBA_SCREEN_HEIGHT = 160;
export const MCBAMGBA_FRAMEBUFFER_BYTES = MCBAMGBA_SCREEN_WIDTH * MCBAMGBA_SCREEN_HEIGHT * 4;

/* ---- Struct types (mirror shim.h's fixed-size structs) ---- */
export const mcbamgba_breakpoint_t = koffi.struct("mcbamgba_breakpoint_t", {
	id: "int64_t",
	address: "uint32_t",
});

export const mcbamgba_watchpoint_t = koffi.struct("mcbamgba_watchpoint_t", {
	id: "int64_t",
	address: "uint32_t",
	type: "int32_t",
});

export const mcbamgba_register_t = koffi.struct("mcbamgba_register_t", {
	name: koffi.array("char", 16),
	value: "uint32_t",
});

/* ---- Lifecycle ---- */
export const loadRom = lib.func("int mcbamgba_load_rom(const char *path)");
export const unloadRom = lib.func("void mcbamgba_unload_rom(void)");
export const isRomLoaded = lib.func("int mcbamgba_is_rom_loaded(void)");
export const reset = lib.func("int mcbamgba_reset(void)");
export const step = lib.func("int mcbamgba_step(void)");
export const runFrame = lib.func("int mcbamgba_run_frame(void)");

/* ---- Bus memory access ---- */
export const busRead8 = lib.func("uint8_t mcbamgba_bus_read8(uint32_t address)");
export const busRead16 = lib.func("uint16_t mcbamgba_bus_read16(uint32_t address)");
export const busRead32 = lib.func("uint32_t mcbamgba_bus_read32(uint32_t address)");
export const busWrite8 = lib.func("void mcbamgba_bus_write8(uint32_t address, uint8_t value)");
export const busWrite16 = lib.func("void mcbamgba_bus_write16(uint32_t address, uint16_t value)");
export const busWrite32 = lib.func("void mcbamgba_bus_write32(uint32_t address, uint32_t value)");

/* ---- Breakpoints (Milestone 3 debugger tools; bound here for
 * completeness since ffi.ts mirrors the shim's whole ABI 1:1) ---- */
export const setBreakpoint = lib.func("int64_t mcbamgba_set_breakpoint(uint32_t address)");
export const clearBreakpoint = lib.func("int mcbamgba_clear_breakpoint(int64_t id)");
export const listBreakpoints = lib.func(
	"int32_t mcbamgba_list_breakpoints(_Out_ mcbamgba_breakpoint_t *out, int32_t max_count)",
);

/* ---- Watchpoints ---- */
export const setWatchpoint = lib.func(
	"int64_t mcbamgba_set_watchpoint(uint32_t address, int32_t type)",
);
export const clearWatchpoint = lib.func("int mcbamgba_clear_watchpoint(int64_t id)");
export const listWatchpoints = lib.func(
	"int32_t mcbamgba_list_watchpoints(_Out_ mcbamgba_watchpoint_t *out, int32_t max_count)",
);

/* ---- Registers ---- */
export const listRegisters = lib.func(
	"int32_t mcbamgba_list_registers(_Out_ mcbamgba_register_t *out, int32_t max_count)",
);
export const readRegister = lib.func(
	"int mcbamgba_read_register(const char *name, _Out_ uint32_t *out_value)",
);
export const writeRegister = lib.func(
	"int mcbamgba_write_register(const char *name, uint32_t value)",
);

/* ---- Input ---- */
export const setKeys = lib.func("int mcbamgba_set_keys(uint32_t keys)");

/* ---- Screenshot / framebuffer ----
 * `out` must be a Buffer of at least MCBAMGBA_FRAMEBUFFER_BYTES bytes. */
export const getFramebuffer = lib.func(
	"int mcbamgba_get_framebuffer(_Out_ uint8_t *out, int32_t out_size)",
);

/* ---- Save states ----
 * `out`/`data` must be Buffers of exactly mcbamgba_state_size() bytes. */
export const stateSize = lib.func("int32_t mcbamgba_state_size(void)");
export const saveState = lib.func(
	"int mcbamgba_save_state(_Out_ uint8_t *out, int32_t out_size)",
);
export const loadState = lib.func("int mcbamgba_load_state(const uint8_t *data, int32_t size)");
