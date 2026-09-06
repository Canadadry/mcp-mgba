# mcp-mgba: headless GBA debugger MCP server

## Context

An MCP server that lets an LLM drive and debug Game Boy Advance ROMs,
installable with zero GUI-toolkit dependency (no X server, no Qt, no SDL
window). The design below was locked in via a `/grill-me` interview:

- **Engine**: mGBA's core (`libmgba`), built with `LIBMGBA_ONLY`/`DISABLE_FRONTENDS`
  so no Qt/SDL/X11 ever enters the picture — it's a headless software-emulation
  library, the same one mGBA's own perf-test tool links against.
- **Binding**: Node.js MCP server, calling into `libmgba` via **koffi** (pure-JS
  FFI, `dlopen`s a shared library — no `node-gyp`, no compiler, no matching
  Node ABI versions across releases).
- **Distribution**: prebuilt `libmgba` shared libraries for linux-x64 and
  macOS (arm64+x64) bundled directly inside the published npm tarball. Install
  is `npm install`/`npx`, fully offline, no postinstall network fetch.
- **Execution model**: single session, fully synchronous/pull-based — every
  MCP tool call blocks and returns state; nothing runs in the background.
- **Tool surface (v1)**: load ROM, reset, step/run-to-breakpoint, read/write
  memory, set/clear breakpoints & watchpoints, get/set registers, disassemble,
  press buttons, screenshot, save/load state.
- **Deferred**: ELF/symbol loading, multi-session, Windows/Linux-arm64 binaries.
- **License**: MPL-2.0 (matches mGBA).
- **Tests**: a tiny homebrew GBA ROM assembled from source in CI (no
  copyrighted game ROMs in the repo).

This plan sequences that design into buildable milestones, since it's a
from-scratch project (the repo currently contains only the `.claude/`
skills scaffold — no existing code to integrate with).

## Confirmed via research (mgba-emu/mgba source, master branch)

- `LIBMGBA_ONLY=ON` sets `DISABLE_FRONTENDS=ON`, `DISABLE_DEPS=ON`, and
  **also forces `BUILD_SHARED=OFF`/`BUILD_STATIC=ON`** in `CMakeLists.txt`.
  Since we need a `.so`/`.dylib` for koffi to `dlopen`, the CI build must
  explicitly pass `-DBUILD_SHARED=ON` after `-DLIBMGBA_ONLY=ON` and verify
  CMake honors the override (this is a build-script detail to confirm
  empirically in Milestone 1, not a design question).
- Relevant `mCore` function-pointer API (`include/mgba/core/core.h`):
  `loadROM`, `unloadROM`, `reset`, `runFrame`, `step`, `busRead{8,16,32}`,
  `busWrite{8,16,32}`, `getPixels`, `saveState`/`loadState`/`stateSize`,
  `readRegister`/`writeRegister`/`listRegisters`. This covers ROM loading,
  stepping, memory, screenshot, save state, and registers without touching
  internal headers.
- Breakpoints/watchpoints live on `mDebuggerPlatform`
  (`include/mgba/debugger/debugger.h`): `setBreakpoint`, `clearBreakpoint`,
  `toggleBreakpoint`, `listBreakpoints`, `setWatchpoint`, `listWatchpoints`,
  attached to a core via `mDebuggerAttach`.
- No single public "disassemble one instruction" function was found in the
  public debugger headers — the CLI debugger's `disassemble` is a
  system-level callback, and ARM/THUMB decoding lives under
  `include/mgba/internal/arm/`. Since we build `libmgba` from source
  ourselves (not consuming a preinstalled SDK), the native binding can
  `#include` those internal headers directly at compile time — this only
  affects our own build, not runtime `dlopen` compatibility. Pin down the
  exact decode-to-string call in Milestone 3 as a short spike.

## Repository layout

```
mcp-mgba/
  native/                  # C shim compiled against libmgba, exports a small
                            # flat C ABI (one function per capability) so the
                            # JS side never has to poke raw mCore vtables
                            # through koffi struct layouts.
    shim.c
    shim.h
    CMakeLists.txt          # builds libmgba (LIBMGBA_ONLY + BUILD_SHARED=ON)
                            # as a subdirectory/FetchContent dependency, then
                            # links shim.c against it into libmcbamgba_shim.so
  prebuilt/                # committed only at publish time (see Milestone 5),
    linux-x64/
    darwin-arm64/
    darwin-x64/
  src/                      # TypeScript MCP server
    index.ts                 # MCP server entrypoint, stdio transport
    ffi.ts                    # koffi bindings to the shim's flat C ABI
    session.ts                 # single-session emulator state (loaded ROM,
                                # breakpoint bookkeeping visible to JS)
    tools/
      rom.ts                    # load_rom, reset
      execution.ts               # step, run_until_breakpoint, continue
      memory.ts                   # read_memory, write_memory
      breakpoints.ts               # set/clear breakpoint, set/clear watchpoint
      registers.ts                  # get_registers, set_register
      disassemble.ts                 # disassemble
      input.ts                        # press_button
      screenshot.ts                    # screenshot (PNG bytes, base64)
      state.ts                          # save_state, load_state
  test/
    fixtures/rom/               # tiny homebrew test ROM source (assembly),
                                 # built by CI, not committed as a binary
    *.test.ts
  .github/workflows/
    build-native.yml            # matrix build of native/ per platform,
                                 # uploads artifacts consumed by publish
    ci.yml                       # lint, typecheck, unit tests on linux-x64
  LICENSE                       # MPL-2.0
  NOTICE                        # mGBA attribution + source pointer (pinned tag/commit)
  package.json
```

## Milestones

### 1. Native shim + build script (foundation, unblocks everything else)

- Vendor `libmgba` as a pinned submodule or `FetchContent` at the latest
  stable mGBA release tag, built with `-DLIBMGBA_ONLY=ON -DBUILD_SHARED=ON
  -DBUILD_STATIC=OFF` (and confirm that override actually produces a shared
  object — if `LIBMGBA_ONLY`'s forced values win over the command-line
  override, patch the CMake invocation, e.g. set the cache var explicitly
  with `-DBUILD_SHARED:BOOL=ON` before the `LIBMGBA_ONLY` block runs, or
  build in two CMake passes).
  - No display/Qt/SDL headers are needed at all in this configuration.
- `native/shim.c` wraps the `mCore` vtable and `mDebuggerPlatform` into a flat,
  `extern "C"` ABI with fixed, koffi-friendly signatures (plain pointers,
  ints, fixed-size structs) — e.g. `mcbamgba_load_rom(path)`,
  `mcbamgba_step(void)`, `mcbamgba_bus_read8(addr)`,
  `mcbamgba_set_breakpoint(addr) -> id`, `mcbamgba_get_registers(out_struct*)`.
  This keeps `ffi.ts` trivial and avoids replicating mGBA's internal struct
  layouts in JS.
- Build script (`native/build.sh` or a small Node script invoked from
  `package.json`'s `prepare`/dev workflow) runs CMake/make locally for
  whatever platform you're developing on, output goes to
  `native/build/<platform>/libmcbamgba_shim.{so,dylib}`.
- **Verification**: a standalone C or Node smoke test that loads the tiny
  test ROM (Milestone 4) via the shim and reads a known memory address.

### 2. Core MCP tools: ROM, execution, memory, input, screenshot, state

- `src/ffi.ts`: koffi `.define()` calls mapping 1:1 to the shim's exported
  functions.
- `src/session.ts`: holds the single loaded-core handle; enforces "no ROM
  loaded" errors cleanly for tool calls made out of order.
- Implement `load_rom`, `reset`, `step`, `run_frames(n)`, `read_memory(addr,
  length)`, `write_memory(addr, bytes)`, `press_button(buttons, frames)`,
  `screenshot()` (PNG-encode the raw framebuffer — check whether libmgba's
  `USE_PNG` path is available in a `DISABLE_DEPS` build or whether PNG
  encoding needs to happen JS-side with a small pure-JS encoder to avoid
  reintroducing libpng as a bundled dependency), `save_state()`/
  `load_state(blob)` using `stateSize`/`saveState`/`loadState`.
- Wire these into an MCP server (`@modelcontextprotocol/sdk`, stdio
  transport) in `src/index.ts`, one `server.tool(...)` registration per
  tool file.
- **Verification**: integration test that loads the fixture ROM, steps N
  frames, reads the RAM address the fixture ROM is known to write, takes a
  screenshot, and round-trips a save state.

### 3. Debugger tools: breakpoints, watchpoints, registers, disassembly

- Extend the shim with `mDebuggerAttach`-based breakpoint/watchpoint
  set/clear/list, and `readRegister`/`writeRegister`/`listRegisters` for the
  register tools.
- Spike the disassembly path against mGBA's internal ARM/THUMB decoder
  headers (`include/mgba/internal/arm/decoder.h` at the pinned tag) to land
  on a `mcbamgba_disassemble(addr, count, out_buf)` shim function; fall back
  to formatting raw opcode bytes if no clean decode-to-string entry point
  exists at the pinned version.
- Implement `run_until_breakpoint()` (synchronous: loops `step`/`runFrame`
  internally in the shim until a breakpoint/watchpoint fires or a safety
  frame cap is hit, then returns) — keeping the blocking, pull-based model
  the interview settled on, with no threads on the JS side.
- **Verification**: integration test that sets a breakpoint at the fixture
  ROM's known write instruction, calls `run_until_breakpoint`, and asserts
  the reported PC/registers match expectations.

### 4. Test fixture ROM

- Small assembly-only GBA ROM (a handful of instructions: write a known
  constant to a known IWRAM address, loop) assembled with `devkitARM`'s
  `arm-none-eabi-as`/`gbafix` (or a minimal hand-built header if pulling in
  devkitARM is too heavy for CI) as part of the test pipeline — never
  committed as a prebuilt binary artifact, only its assembly source.
- This ROM is the shared fixture for Milestones 2 and 3's integration tests.

### 5. Packaging, CI matrix, licensing

- `.github/workflows/build-native.yml`: matrix over linux-x64 and macOS
  (arm64 + x64) runners, each building `native/` per Milestone 1 and
  uploading the resulting shared library as a build artifact — **not**
  committed into git history (avoids bloating the repo with binary diffs on
  every mGBA version bump).
- A publish workflow/script downloads those artifacts into `prebuilt/<platform>/`
  immediately before `npm publish`, so the published tarball is
  self-contained while the git repo stays lean.
- `src/ffi.ts` picks the right prebuilt path based on `process.platform`/
  `process.arch` at runtime.
- `LICENSE` (MPL-2.0) + `NOTICE` recording the exact mGBA tag/commit vendored
  and a link to its source, satisfying MPL-2.0's source-availability terms
  for the bundled binaries.
- `package.json` `files` field limited to `dist/`, `prebuilt/`, `LICENSE`,
  `NOTICE` — no native source or build artifacts beyond the shipped shared
  libraries.

## Verification (end-to-end, once Milestones 1-4 land)

1. `npm install` in a clean checkout — confirms no compiler/network is
   needed at install time (prebuilt libs already in `prebuilt/` for the dev
   platform, or built locally via Milestone 1's script for iteration).
2. Run the MCP server over stdio and drive it with a minimal MCP client
   script (or `npx @modelcontextprotocol/inspector`) to call `load_rom`
   against the fixture ROM, `step`, `read_memory`, `set_breakpoint`,
   `run_until_breakpoint`, `get_registers`, `disassemble`, and `screenshot`
   in sequence, confirming each returns sane data.
3. `npm test` runs the fixture-ROM integration tests from Milestones 2-3
   in CI on linux-x64 (and ideally macOS in the matrix) with no Xvfb, no
   display server, and no Qt/SDL packages installed on the runner —
   directly proving the "no X server / no Qt" requirement.
