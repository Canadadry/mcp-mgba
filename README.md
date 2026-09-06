# mcp-mgba

A headless GBA debugger MCP server: it lets an LLM (or any MCP client) load
a Game Boy Advance ROM, step it instruction-by-instruction, read/write
memory, and manage breakpoints/watchpoints/registers — all with zero GUI
toolkit dependency (no X server, no Qt, no SDL window). Under the hood it's
built on [mGBA](https://mgba.io/)'s core emulation library (`libmgba`),
built headless.

See [`docs/plan.md`](docs/plan.md) for the full project plan and milestone
breakdown, and [`docs/prd/triage/`](docs/prd/triage/) for the per-milestone
PRDs. This repo is early: only Milestone 1 (the native shim below) has
landed so far.

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
- Bus memory access: `mcbamgba_bus_read{8,16,32}` /
  `mcbamgba_bus_write{8,16,32}`.
- Breakpoints and watchpoints (backed by `mDebuggerPlatform`, attached via
  `mDebuggerAttach`): `mcbamgba_set_breakpoint`, `mcbamgba_clear_breakpoint`,
  `mcbamgba_list_breakpoints`, and the watchpoint equivalents.
- Registers: `mcbamgba_list_registers`, `mcbamgba_read_register`,
  `mcbamgba_write_register`.

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
also exercises reset, register read/write/list, and breakpoint/watchpoint
set/list/clear.

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
