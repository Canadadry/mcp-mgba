# mcp-mgba

A headless GBA debugger MCP server: it lets an LLM (or any MCP client) load
a Game Boy Advance ROM, step it instruction-by-instruction, read/write
memory, and manage breakpoints/watchpoints/registers — all with zero GUI
toolkit dependency (no X server, no Qt, no SDL window). Under the hood it's
built on [mGBA](https://mgba.io/)'s core emulation library (`libmgba`),
built headless.

See [`docs/plan.md`](docs/plan.md) for the full project plan and milestone
breakdown, and [`docs/prd/triage/`](docs/prd/triage/) for the per-milestone
PRDs. This repo is early: Milestone 1 (the native shim) and Milestone 2 (the
core MCP tools) have landed so far.

## Native shim (`native/`)

The `native/` directory vendors `libmgba` and wraps it in a small,
hand-written C shim (`native/shim.c` / `native/shim.h`) that exposes a
flat, `extern "C"` ABI — plain ints, pointers, and fixed-size structs only,
no raw mGBA vtables or internal structs. This is the surface a later
TypeScript/koffi FFI layer binds to, so `libmgba`'s internal memory layout
never has to be mirrored in JavaScript.

It covers:

- ROM lifecycle: `mcbamgba_load_rom`, `mcbamgba_unload_rom`,
  `mcbamgba_is_rom_loaded`, `mcbamgba_reset`, `mcbamgba_step`.
- Frame stepping: `mcbamgba_run_frame` (a whole video frame at a time, via
  `mCore::runFrame`, as opposed to `mcbamgba_step`'s single-instruction
  granularity).
- Bus memory access: `mcbamgba_bus_read{8,16,32}` /
  `mcbamgba_bus_write{8,16,32}`.
- Breakpoints and watchpoints (backed by `mDebuggerPlatform`, attached via
  `mDebuggerAttach`): `mcbamgba_set_breakpoint`, `mcbamgba_clear_breakpoint`,
  `mcbamgba_list_breakpoints`, and the watchpoint equivalents.
- Registers: `mcbamgba_list_registers`, `mcbamgba_read_register`,
  `mcbamgba_write_register`.
- Input: `mcbamgba_set_keys`, taking a bitmask of the GBA's 10 buttons
  (`MCBAMGBA_KEY_*`, mirroring libmgba's internal `enum GBAKey` bit
  positions).
- Screenshot/framebuffer: `mcbamgba_get_framebuffer`, copying the current
  frame out as tightly-packed 240x160 RGBA8888 (a fixed video buffer is
  wired up via `mCore::setVideoBuffer` before the first reset, since the
  GBA core only associates a renderer with the board at reset time if an
  output buffer is already set).
- Save states: `mcbamgba_state_size`, `mcbamgba_save_state`,
  `mcbamgba_load_state` — opaque binary blobs the shim never interprets.

See `native/shim.h` for the full, documented API.

### Building

`libmgba` is vendored as a git submodule pinned to release tag `0.10.5`
(`native/vendor/mgba`), not a floating branch. Build it headless
(`LIBMGBA_ONLY=ON`, `BUILD_SHARED=ON`, `BUILD_STATIC=OFF`) with no
Qt/SDL/X11/display code anywhere in the build.

`LIBMGBA_ONLY` normally forces libmgba into a *static-only* build even when
`-DBUILD_SHARED=ON` is passed on the command line (its `CMakeLists.txt`
overwrites `BUILD_SHARED`/`BUILD_STATIC` again after that point, in a way a
command-line override can't reach). `native/build.sh` works around this by
applying `native/patches/0001-libmgba-only-shared.patch` to the vendored
checkout before configuring — idempotently, so re-running it is always
safe — and `native/CMakeLists.txt` double-checks the resulting `mgba`
target is genuinely a `SHARED_LIBRARY` and fails the build loudly if it
isn't.

```sh
git submodule update --init --recursive   # first time only

native/build.sh          # configure + build
native/build.sh --test   # configure + build + run the smoke test
native/build.sh --clean  # wipe this platform's build dir first
```

Output goes to `native/build/<platform>/`, e.g.
`native/build/linux-x64/libmcbamgba_shim.so`.

Requires `cmake`, a C compiler (gcc/clang), and `make` — no Node.js
toolchain is needed to build the native layer on its own.

### Smoke test

`native/test/smoke_test.c` is a standalone C program (no test framework)
that loads a fixture ROM through the real, compiled shim + `libmgba` (no
mocking), steps it, and checks that the ROM's known side effect — writing
the constant `0x42` to IWRAM address `0x03000000` — actually happened. It
also exercises reset, register read/write/list, breakpoint/watchpoint
set/list/clear, frame stepping, input (`set_keys` against the `KEYINPUT`
I/O register), the framebuffer getter, and a save-state round-trip.

Run it via `native/build.sh --test` (uses CTest), or directly:

```sh
native/build/linux-x64/mcbamgba_smoke_test native/test/fixtures/minimal.gba
```

#### Fixture ROM

`native/test/fixtures/minimal.gba` is a hand-built, 512-byte GBA ROM with a
valid header (correct entry-point branch, fixed byte, header checksum) and
four ARM instructions: it writes `0x42` to `0x03000000` (the start of
IWRAM) and then loops forever. It exists only because Milestone 4's proper
fixture-ROM pipeline (assembled from source via devkitARM, see
[`docs/prd/triage/04-test-fixture-rom.md`](docs/prd/triage/04-test-fixture-rom.md))
hasn't landed yet — once it does, it should supersede this placeholder as
the shared fixture for the native, MCP-tool, and debugger-tool tests alike.

## MCP server (`src/`)

A TypeScript MCP server, speaking the stdio transport
(`@modelcontextprotocol/sdk`), that binds to the native shim above via
[koffi](https://koffi.dev/) (a pure-JS FFI library — no `node-gyp`, no
compiler needed at `npm install` time, just `dlopen`). It exposes one MCP
tool per emulator-control capability, is fully synchronous/pull-based
(every tool call blocks and returns a definitive result — no polling, no
background execution), and supports a single loaded ROM/session at a time.

- `src/ffi.ts`: koffi bindings mapping 1:1 onto `native/shim.h`'s exported
  C functions — pure type marshaling, no other logic.
- `src/session.ts`: owns the one loaded-core handle for the process's
  lifetime. Every tool goes through it, and it's the single place that
  raises a structured `SessionError` (`code: "NO_ROM_LOADED"`) for any
  tool call made before `load_rom` — individual tools don't reimplement
  that check.
- `src/png.ts`: a small, dependency-free PNG encoder for the `screenshot`
  tool's raw RGBA framebuffer. The native build uses `DISABLE_DEPS` (see
  `native/vendor/mgba/CMakeLists.txt`), which forces `USE_PNG` off — there
  is no libpng linked into the shim. Rather than reintroduce libpng as a
  native dependency, this encoder hand-writes the PNG chunk framing
  (signature/IHDR/IDAT/IEND + CRC32) and calls Node's *built-in* `zlib`
  module (already part of every Node runtime — not a new dependency) for
  the DEFLATE/zlib compression PNG's `IDAT` chunk requires.
- `src/tools/`: one file per tool group — `rom.ts`, `execution.ts`,
  `memory.ts`, `input.ts`, `screenshot.ts`, `state.ts` — each a thin layer
  that parses MCP input, calls `Session`, and formats an MCP result.
- `src/index.ts`: registers every tool on an `McpServer` and connects it
  over `StdioServerTransport`.

### Building and running

```sh
git submodule update --init --recursive   # first time only
native/build.sh                            # build the native shim (see above)

npm install
npm run build   # tsc -> dist/
npm start        # runs dist/index.js over stdio
# or, for local development without a build step:
npm run dev      # runs src/index.ts directly via tsx
```

The server expects the native shim to already be built at
`native/build/<platform>/libmcbamgba_shim.{so,dylib}` (matching
`native/build.sh`'s output layout) and resolves it relative to the
package's own location at startup; set `MCBAMGBA_SHIM_PATH` to point at a
shim built elsewhere instead. `npm run typecheck` runs `tsc --noEmit`, and
`npm test` runs the Vitest suite (see [Testing](#testing) below).

Point any MCP client (e.g. `npx @modelcontextprotocol/inspector node
dist/index.js`) at the built server to drive it interactively.

### Tool surface

| Tool | Description |
| --- | --- |
| `load_rom` | Loads a GBA ROM from an absolute path, replacing any ROM already loaded, and resets to its entry point. Required before any other tool. |
| `reset` | Resets the currently loaded ROM back to its entry point. |
| `step` | Executes a single CPU instruction. |
| `run_frames` | Advances execution by `count` whole video frames — faster than single-instruction stepping when that granularity isn't needed. |
| `read_memory` | Reads `length` bytes of GBA-mapped memory (IWRAM/EWRAM/ROM/palette/OAM/etc.) starting at `address`, returned as a hex string. |
| `write_memory` | Writes a hex-encoded byte string into GBA-mapped memory starting at `address` — patch state, force a flag, unlock progress. |
| `press_button` | Holds one or more of the GBA's 10 buttons (`A`, `B`, `SELECT`, `START`, `RIGHT`, `LEFT`, `UP`, `DOWN`, `R`, `L`) down for `frames` whole video frames, then releases them. |
| `screenshot` | Captures the current 240x160 frame as a PNG image. |
| `save_state` | Snapshots the current point in execution as an opaque, base64-encoded blob (never interpreted by the server) that `load_state` can return to later without replaying input. |
| `load_state` | Restores emulator state from a blob previously returned by `save_state`, for a core loaded from the same ROM. |

Every tool other than `load_rom` fails with a structured
`[NO_ROM_LOADED]` error if called before a ROM is loaded.

Breakpoints, watchpoints, register read/write, and disassembly land in
Milestone 3 — the native shim already exposes their C ABI (see above), but
no MCP tools wrap them yet.

### Testing

```sh
npm test
```

Runs on the real compiled native shim + `libmgba` (nothing about
`libmgba`/koffi is mocked):

- `test/ffi.test.ts` — a tracer-bullet test proving the koffi bindings in
  `src/ffi.ts` marshal correctly against the compiled shim.
- `test/session.test.ts` — unit tests `Session`'s `NO_ROM_LOADED` error
  path directly, in isolation from any individual tool.
- `test/png.test.ts` — round-trips `encodeRgbaToPng`'s output back through
  `zlib.inflateSync` and independent chunk parsing to confirm it's a valid
  PNG.
- `test/integration.test.ts` — the end-to-end integration test: drives the
  real registered MCP tools (via an in-process client/server pair) to load
  the fixture ROM, step past its known write, read that memory address,
  run whole frames, press a button, take a screenshot, and round-trip a
  save state (save, mutate memory further, load, confirm memory matches
  the saved point rather than the mutation).
