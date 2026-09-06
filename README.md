# mcp-mgba

A headless GBA debugger MCP server: it lets an LLM (or any MCP client) load
a Game Boy Advance ROM, step it instruction-by-instruction, read/write
memory, and manage breakpoints/watchpoints/registers — all with zero GUI
toolkit dependency (no X server, no Qt, no SDL window). Under the hood it's
built on [mGBA](https://mgba.io/)'s core emulation library (`libmgba`),
built headless.

See [`docs/plan.md`](docs/plan.md) for the full project plan and milestone
breakdown, and [`docs/prd/done/`](docs/prd/done/) for the per-milestone
PRDs. Milestone 1 (the native shim), Milestone 2 (the core MCP tools),
Milestone 3 (debugger tools — breakpoints, watchpoints, registers,
disassembly), Milestone 4 (the from-source test fixture ROM), and
Milestone 5 (packaging, CI matrix, and licensing) have all landed — the
triage queue is empty.

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
  `mcbamgba_list_breakpoints`, and the watchpoint equivalents. A breakpoint
  fires just *before* the instruction at its address executes; a watchpoint
  fires as part of the memory access that triggers it (so its reported value
  already reflects a completed write).
- Registers: `mcbamgba_list_registers`, `mcbamgba_read_register`,
  `mcbamgba_write_register`.
- `mcbamgba_run_until_breakpoint`: runs forward one instruction at a time —
  internally, inside the shim, as a single blocking call with no polling and
  no threads — until a breakpoint or watchpoint fires, or until a safety cap
  on the number of instructions is reached with nothing firing. Fills an
  out-struct with a stop-reason code (`MCBAMGBA_STOP_BREAKPOINT` /
  `MCBAMGBA_STOP_WATCHPOINT` / `MCBAMGBA_STOP_CAP`), the id and address of
  whatever fired (or `-1`/current PC for a cap timeout), watchpoint
  before/after values where applicable, and the instruction count actually
  run — so a caller can always tell a real hit apart from a timeout
  unambiguously, never just infer it from a lack of error.
- `mcbamgba_disassemble`: decodes `count` ARM/THUMB instructions starting at
  an address into mnemonic + operand strings (e.g. `"str r1, [r0]"`), using
  mGBA's internal ARM/THUMB decoder (`mgba/internal/arm/decoder.h`, vendored
  header — safe to include at compile time since `libmgba` is built from
  source here, not consumed as a preinstalled SDK). Every instruction in a
  requested range is decoded using the CPU's *current* execution mode (ARM
  or Thumb); no ELF/symbol table is loaded, so branch/load targets are raw
  addresses, not symbol names.
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

It also exercises `mcbamgba_run_until_breakpoint` (stopping for a breakpoint
on the fixture's known write instruction, for a watchpoint on the write
address, and hitting the safety cap against an unreachable breakpoint) and
`mcbamgba_disassemble` (decoding the fixture's four known instructions and
checking the resulting mnemonics/operands).

Run it via `native/build.sh --test` (uses CTest, and assembles the fixture
ROM below first), or directly, once the fixture has been built (see below):

```sh
native/build/linux-x64/mcbamgba_smoke_test test/fixtures/rom/build/fixture.gba
```

#### Fixture ROM

Milestones 2-4's tests all need a real GBA ROM with known, predictable
behavior to assert against, and the project's no-committed-binary-ROM
policy means that ROM can never be checked into git as a binary — see
[`docs/prd/done/04-test-fixture-rom.md`](docs/prd/done/04-test-fixture-rom.md).

Only assembly **source** is committed, at
[`test/fixtures/rom/fixture.s`](test/fixtures/rom/fixture.s) (note: this
lives at the repo root under `test/fixtures/rom/`, not under `native/`,
since it's shared by both the native smoke test and the TypeScript
integration tests). It's a tiny ARM program with a standard 192-byte GBA
header followed by four instructions:

```
0x080000C0: mov  r0, #0x03000000   ; r0 = start of IWRAM
0x080000C4: mov  r1, #0x42         ; r1 = the known constant
0x080000C8: str  r1, [r0]          ; the known write: IWRAM[0x03000000] = 0x42
0x080000CC: b    loop              ; infinite loop (branches to itself)
```

[`test/fixtures/rom/build.sh`](test/fixtures/rom/build.sh) assembles this
source into `test/fixtures/rom/build/fixture.gba` (gitignored — always
rebuilt, never committed) using `arm-none-eabi-as`/`-ld`/`-objcopy`, then
patches in the header's complement checksum by hand (libmgba doesn't
actually validate the GBA header checksum or Nintendo logo on this
loading path — see `fixture.s`'s header comment for why — so this is
computed for spec-completeness, not because anything here checks it). No
`gbafix`-equivalent tool is needed. This one script is the single place
the fixture-build logic lives, invoked both by `npm test` (as the
`pretest` script) and by `native/build.sh --test`, so both test suites
always run against a freshly-assembled fixture.

**Toolchain prerequisite**: assembling the fixture requires
`arm-none-eabi-as`, `arm-none-eabi-ld`, and `arm-none-eabi-objcopy` on
`PATH` — a bare ARM cross-binutils, *not* the full devkitARM toolchain.
On Debian/Ubuntu:

```sh
sudo apt-get install binutils-arm-none-eabi
```

On macOS (Homebrew): `brew install --cask gcc-arm-embedded`, or any
equivalent package that provides those three binaries. This is an
OS-level dependency, not an npm one — `test/fixtures/rom/build.sh` checks
for it up front and fails with this same guidance (rather than a bare
"command not found") if it's missing.

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
  `memory.ts`, `input.ts`, `screenshot.ts`, `state.ts`, `debugger.ts` — each
  a thin layer that parses MCP input, calls `Session`, and formats an MCP
  result.
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

At startup, `src/ffi.ts`'s `resolveShimPath()` locates the native shim
relative to the package's own location, in this order:

1. `MCBAMGBA_SHIM_PATH` env var, if set — used as-is, no existence check
   (for tests, or pointing at a shim built elsewhere).
2. `prebuilt/<platform>/libmcbamgba_shim.{so,dylib}` — populated only in a
   published npm tarball (see [Packaging, CI, and
   releasing](#packaging-ci-and-releasing) below); never present in a git
   checkout.
3. `native/build/<platform>/libmcbamgba_shim.{so,dylib}` — this repo's own
   local build (see [Building](#building) above), which is what keeps this
   repo's own dev loop and test suite working without `prebuilt/` ever
   being populated.

`npm run typecheck` runs `tsc --noEmit`, and `npm test` runs the Vitest
suite (see [Testing](#testing) below).

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
| `set_breakpoint` | Sets a hardware breakpoint at `address`. Fires just before the instruction at that address executes. |
| `clear_breakpoint` | Removes the breakpoint with the given `id`. |
| `list_breakpoints` | Lists every breakpoint currently set. |
| `set_watchpoint` | Sets a watchpoint at `address` for a given access `kind` (`write`, `read`, `rw`, `change`, `write_change`). |
| `clear_watchpoint` | Removes the watchpoint with the given `id`. |
| `list_watchpoints` | Lists every watchpoint currently set. |
| `get_registers` | Reads the full CPU register set (`r0`-`r15`, `cpsr`, ...) at the current point in execution. |
| `set_register` | Writes a single register by name (e.g. `r0`, `pc`, `sp`, `lr`, `cpsr`), to mutate CPU state and test a hypothesis. |
| `run_until_breakpoint` | Runs forward (single-stepping internally, one blocking call) until a breakpoint or watchpoint fires, or a safety `max_instructions` cap is reached. The response's `stop_reason` (`"breakpoint"` / `"watchpoint"` / `"cap"`) unambiguously distinguishes a real hit from a timeout, alongside the id/address that fired and the current register set. |
| `disassemble` | Decodes `count` ARM/THUMB instructions starting at `address` into mnemonic + operand strings, using the CPU's current execution mode for the whole range. |

Every tool other than `load_rom` fails with a structured
`[NO_ROM_LOADED]` error if called before a ROM is loaded. `clear_breakpoint`,
`clear_watchpoint`, and `set_register` fail with a structured `[NOT_FOUND]`
error if given an id/register name that doesn't exist.

### Testing

```sh
npm test
```

`npm test`'s `pretest` script runs
[`test/fixtures/rom/build.sh`](test/fixtures/rom/build.sh) first, freshly
assembling the shared fixture ROM (see "Fixture ROM" above) before Vitest
runs — so the same toolchain prerequisite documented there
(`arm-none-eabi-as`/`-ld`/`-objcopy`) applies here too.

Runs on the real compiled native shim + `libmgba` (nothing about
`libmgba`/koffi is mocked):

- `test/ffi.test.ts` — a tracer-bullet test proving the koffi bindings in
  `src/ffi.ts` marshal correctly against the compiled shim, plus the
  Milestone 5 `resolveShimPath()` tests covering its
  override/`prebuilt/`/`native/build/` precedence (see above).
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
- `test/debugger.test.ts` — the Milestone 3 integration tests: drives the
  real registered debugger MCP tools to set a breakpoint on the fixture's
  known write instruction and confirm `run_until_breakpoint` stops there
  with matching PC/registers before the write happens; set a watchpoint on
  the write address and confirm it stops for the write instead of running
  past it into the fixture's infinite loop; confirm a `max_instructions`
  safety cap is clearly distinguishable (`stop_reason: "cap"`) from a real
  hit; round-trip a register write; and disassemble the fixture's four
  known instructions, asserting the decoded mnemonics/operands match its
  known assembly source.

## Packaging, CI, and releasing

This package ships as a self-contained npm tarball: `npm install` needs no
compiler, no `node-gyp`, and no network fetch beyond npm itself, because
the native shim is prebuilt per-platform ahead of time rather than
compiled on install. Windows and linux-arm64 are explicitly out of scope
for now — only linux-x64 and macOS (arm64 + x64) are built and published.

### CI

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on
  `ubuntu-latest` on every push/PR: checks out the repo (with submodules),
  installs `binutils-arm-none-eabi` (the same fixture-ROM toolchain
  prerequisite documented above), builds the native shim
  (`native/build.sh`), then runs `npm run typecheck` and `npm test`.
  Nothing in this workflow installs Xvfb, a display server, or any
  Qt/SDL/X11 package — that absence is itself the automated proof of this
  project's headless requirement, not just a claim in this README.
- [`.github/workflows/build-native.yml`](.github/workflows/build-native.yml)
  builds the native shim across a platform matrix (`ubuntu-latest` for
  linux-x64, `macos-14` for darwin-arm64, `macos-15-intel` for darwin-x64,
  each running `native/build.sh --test`) and uploads each platform's
  `libmcbamgba_shim.{so,dylib}` as a CI artifact (`shim-linux-x64`,
  `shim-darwin-arm64`, `shim-darwin-x64`). This is the matrix that catches
  a platform-specific native build break before publishing.

### Releasing

Automated `npm publish` on tag push is out of scope for now — publishing
is a deliberate, manual step a maintainer runs:

1. Make sure `.github/workflows/build-native.yml` has completed
   successfully for the commit being released (push to `master` triggers
   it, or trigger it manually — it also accepts `workflow_dispatch`), and
   note its run id (`gh run list --workflow=build-native.yml`).
2. Populate `prebuilt/<platform>/` from that run's artifacts. Either:
   - run [`scripts/prepare-publish.sh <run id>`](scripts/prepare-publish.sh)
     locally (requires the `gh` CLI, authenticated against this repo), or
   - trigger
     [`.github/workflows/publish.yml`](.github/workflows/publish.yml)
     (`workflow_dispatch`, `build_run_id` input) to do the same download
     plus `npm publish` in CI, gated behind a `dry_run` input (defaults to
     `true`, which runs `npm publish --dry-run` instead of a real publish).
3. `prebuilt/` is never committed to git (see `.gitignore`) — it exists
   only in the working tree for this one step, immediately before
   `npm publish`/`npm pack`. `package.json`'s `files` field scopes the
   published tarball to `dist/`, `prebuilt/`, `LICENSE`, and `NOTICE` only
   (verify with `npm pack --dry-run` before a real publish, per the
   manual dry-run this milestone's PRD calls for).

At runtime, `src/ffi.ts`'s `resolveShimPath()` picks up whichever
`prebuilt/<platform>/` shim matches `process.platform`/`process.arch` (see
[Building and running](#building-and-running) above).

## Licensing

This project is MPL-2.0 licensed — see [`LICENSE`](LICENSE) for the full
text. It's built on [mGBA](https://mgba.io/)'s `libmgba`
(also MPL-2.0), vendored as a git submodule pinned to release tag
`0.10.5` (`native/vendor/mgba`) and statically linked into the compiled
native shim this package distributes. See [`NOTICE`](NOTICE) for the
exact vendored tag/commit and a link to mGBA's upstream source, satisfying
MPL-2.0 §3.2's source-availability requirement for the libmgba code
distributed in this package's `prebuilt/` binaries.
