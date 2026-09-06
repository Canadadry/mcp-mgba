/* mcp-mgba native shim: a small, flat, `extern "C"` ABI over libmgba's
 * mCore/mDebuggerPlatform vtables. Every function here uses only plain
 * ints, pointers, and fixed-size structs — no mGBA internal structs or
 * function-pointer vtables cross this boundary — so a JS FFI layer (koffi)
 * can bind to it directly without mirroring libmgba's internal memory
 * layout.
 *
 * Only a single GBA core may be loaded at a time (single-session model).
 */
#ifndef MCBAMGBA_SHIM_H
#define MCBAMGBA_SHIM_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ---- Error codes (returned by functions with an `int` result) ---- */
#define MCBAMGBA_OK 0
#define MCBAMGBA_ERR_GENERIC (-1)
#define MCBAMGBA_ERR_NO_ROM (-2)
#define MCBAMGBA_ERR_LOAD_FAILED (-3)
#define MCBAMGBA_ERR_NOT_FOUND (-4)

/* ---- Lifecycle ---- */

/* Loads the ROM at `path`, replacing any previously loaded ROM. Returns
 * MCBAMGBA_OK on success, or a negative MCBAMGBA_ERR_* code on failure. */
int mcbamgba_load_rom(const char* path);

/* Unloads the current ROM, if any. Safe to call when nothing is loaded. */
void mcbamgba_unload_rom(void);

/* Returns 1 if a ROM is currently loaded, 0 otherwise. */
int mcbamgba_is_rom_loaded(void);

/* Resets the currently loaded core. Returns MCBAMGBA_ERR_NO_ROM if no ROM
 * is loaded. */
int mcbamgba_reset(void);

/* Executes a single CPU instruction. Returns MCBAMGBA_ERR_NO_ROM if no ROM
 * is loaded. */
int mcbamgba_step(void);

/* Runs the core forward by exactly one whole video frame (all scanlines +
 * blanking), distinct from mcbamgba_step()'s single-CPU-instruction
 * granularity. Returns MCBAMGBA_ERR_NO_ROM if no ROM is loaded. */
int mcbamgba_run_frame(void);

/* ---- Input ----
 * Bit values mirror libmgba's internal `enum GBAKey` positions exactly
 * (bit N set = key N held), so no internal enum needs to cross the ABI. */

#define MCBAMGBA_KEY_A 0x0001
#define MCBAMGBA_KEY_B 0x0002
#define MCBAMGBA_KEY_SELECT 0x0004
#define MCBAMGBA_KEY_START 0x0008
#define MCBAMGBA_KEY_RIGHT 0x0010
#define MCBAMGBA_KEY_LEFT 0x0020
#define MCBAMGBA_KEY_UP 0x0040
#define MCBAMGBA_KEY_DOWN 0x0080
#define MCBAMGBA_KEY_R 0x0100
#define MCBAMGBA_KEY_L 0x0200

/* Sets the full set of currently-held keys to exactly `keys` (an OR of
 * MCBAMGBA_KEY_* bits; any other bits are ignored by the core). Replaces
 * whatever was held before - callers wanting to hold+release across
 * several frames should call this once, run frames, then call it again
 * with 0. Returns MCBAMGBA_ERR_NO_ROM if no ROM is loaded. */
int mcbamgba_set_keys(uint32_t keys);

/* ---- Bus memory access (the GBA's full mapped address space) ----
 * These are thin wrappers over mCore's busRead.../busWrite... vtable
 * entries. Reads return 0 and writes are a no-op when no ROM is loaded. */

uint8_t mcbamgba_bus_read8(uint32_t address);
uint16_t mcbamgba_bus_read16(uint32_t address);
uint32_t mcbamgba_bus_read32(uint32_t address);

void mcbamgba_bus_write8(uint32_t address, uint8_t value);
void mcbamgba_bus_write16(uint32_t address, uint16_t value);
void mcbamgba_bus_write32(uint32_t address, uint32_t value);

/* ---- Breakpoints ----
 * Backed by mDebuggerPlatform, attached via mDebuggerAttach when a ROM is
 * loaded. Hitting a breakpoint during mcbamgba_step() is not yet observable
 * through this shim (that lands with run_until_breakpoint in Milestone 3);
 * set/clear/list are wired now since later milestones depend on them. */

typedef struct mcbamgba_breakpoint {
	int64_t id;
	uint32_t address;
} mcbamgba_breakpoint_t;

/* Sets a hardware breakpoint at `address`. Returns the new breakpoint's id
 * (>= 1) on success, or a negative MCBAMGBA_ERR_* code on failure. */
int64_t mcbamgba_set_breakpoint(uint32_t address);

/* Clears the breakpoint with the given id. Returns MCBAMGBA_OK on success,
 * MCBAMGBA_ERR_NOT_FOUND if no breakpoint with that id exists. */
int mcbamgba_clear_breakpoint(int64_t id);

/* Writes up to `max_count` breakpoints into `out` and returns the number
 * written. Returns MCBAMGBA_ERR_NO_ROM if no ROM is loaded. */
int32_t mcbamgba_list_breakpoints(mcbamgba_breakpoint_t* out, int32_t max_count);

/* ---- Watchpoints ----
 * `type` mirrors libmgba's mWatchpointType numeric values exactly, so no
 * internal enum needs to be exposed across the ABI boundary. */

#define MCBAMGBA_WATCHPOINT_WRITE 1
#define MCBAMGBA_WATCHPOINT_READ 2
#define MCBAMGBA_WATCHPOINT_RW 3
#define MCBAMGBA_WATCHPOINT_CHANGE 4
#define MCBAMGBA_WATCHPOINT_WRITE_CHANGE 5

typedef struct mcbamgba_watchpoint {
	int64_t id;
	uint32_t address;
	int32_t type;
} mcbamgba_watchpoint_t;

/* Sets a watchpoint of the given MCBAMGBA_WATCHPOINT_* type at `address`.
 * Returns the new watchpoint's id (>= 1) on success, or a negative
 * MCBAMGBA_ERR_* code on failure. */
int64_t mcbamgba_set_watchpoint(uint32_t address, int32_t type);

/* Clears the watchpoint with the given id. Returns MCBAMGBA_OK on success,
 * MCBAMGBA_ERR_NOT_FOUND if no watchpoint with that id exists. */
int mcbamgba_clear_watchpoint(int64_t id);

/* Writes up to `max_count` watchpoints into `out` and returns the number
 * written. Returns MCBAMGBA_ERR_NO_ROM if no ROM is loaded. */
int32_t mcbamgba_list_watchpoints(mcbamgba_watchpoint_t* out, int32_t max_count);

/* ---- Registers ---- */

#define MCBAMGBA_REGISTER_NAME_MAX 16

typedef struct mcbamgba_register {
	char name[MCBAMGBA_REGISTER_NAME_MAX];
	uint32_t value;
} mcbamgba_register_t;

/* Writes up to `max_count` readable registers (r0-r15, cpsr, ...) into
 * `out` and returns the number written. Returns MCBAMGBA_ERR_NO_ROM if no
 * ROM is loaded. */
int32_t mcbamgba_list_registers(mcbamgba_register_t* out, int32_t max_count);

/* Reads a single register by name (e.g. "r0", "pc", "sp", "lr", "cpsr").
 * Returns MCBAMGBA_OK on success, MCBAMGBA_ERR_NOT_FOUND for an unknown
 * name, MCBAMGBA_ERR_NO_ROM if no ROM is loaded. */
int mcbamgba_read_register(const char* name, uint32_t* out_value);

/* Writes a single register by name. Same return codes as
 * mcbamgba_read_register. */
int mcbamgba_write_register(const char* name, uint32_t value);

/* ---- Screenshot / framebuffer ----
 * The GBA's screen is a fixed 240x160 resolution for every ROM - these
 * dimensions never vary at runtime. */

#define MCBAMGBA_SCREEN_WIDTH 240
#define MCBAMGBA_SCREEN_HEIGHT 160

/* Copies the current frame's pixels into `out` as tightly-packed RGBA8888
 * (one byte per channel, row-major, no row padding - matching
 * MCBAMGBA_SCREEN_WIDTH * MCBAMGBA_SCREEN_HEIGHT * 4 bytes exactly). The
 * alpha byte is always 0xFF (the GBA has no real alpha channel).
 * `out_size` must be at least that many bytes. Returns MCBAMGBA_OK on
 * success, MCBAMGBA_ERR_NO_ROM if no ROM is loaded, MCBAMGBA_ERR_GENERIC if
 * `out` is NULL or `out_size` is too small. */
int mcbamgba_get_framebuffer(uint8_t* out, int32_t out_size);

/* ---- Save states ----
 * State blobs are opaque binary data - the server never interprets their
 * contents, only stores/replays them via these three calls. */

/* Returns the exact size in bytes of a save-state blob for the currently
 * loaded core, or a negative MCBAMGBA_ERR_* code (MCBAMGBA_ERR_NO_ROM if no
 * ROM is loaded). Always call this to size the buffer passed to
 * mcbamgba_save_state - the size can vary by core/ROM. */
int32_t mcbamgba_state_size(void);

/* Serializes the current emulator state into `out`. `out_size` must be at
 * least mcbamgba_state_size() bytes. Returns MCBAMGBA_OK on success,
 * MCBAMGBA_ERR_NO_ROM if no ROM is loaded, MCBAMGBA_ERR_GENERIC on any
 * other failure (including `out` NULL or `out_size` too small). */
int mcbamgba_save_state(uint8_t* out, int32_t out_size);

/* Restores emulator state from a blob previously produced by
 * mcbamgba_save_state for a core loaded from the same ROM. Returns
 * MCBAMGBA_OK on success, MCBAMGBA_ERR_NO_ROM if no ROM is loaded,
 * MCBAMGBA_ERR_GENERIC on any other failure (including a malformed or
 * mismatched blob). */
int mcbamgba_load_state(const uint8_t* data, int32_t size);

#ifdef __cplusplus
}
#endif

#endif /* MCBAMGBA_SHIM_H */
