# Milestone 1: Native shim + headless libmgba build

## Problem Statement

The project needs a way for a Node.js process to observe and control a GBA
emulator core (load a ROM, step instructions, read/write memory) without any
GUI toolkit dependency. mGBA's `libmgba` only exposes its C API through
`mCore`/`mDebuggerPlatform` function-pointer vtables designed for C
consumers. Right now nothing in this repo builds `libmgba`, no shared
library artifact exists, and there is no minimal, fixed-signature C surface
that a JS FFI layer (koffi) can safely call without replicating mGBA's
internal struct/vtable layouts in JavaScript.

## Solution

Vendor `libmgba` at a pinned stable release tag, build it in headless mode
(`LIBMGBA_ONLY`, no Qt/SDL/X11) as a shared library, and wrap its
`mCore`/`mDebuggerPlatform` vtables behind a small hand-written C shim
(`native/shim.c`) that exports a flat, `extern "C"` ABI — one function per
capability, plain pointers/ints/fixed-size structs only. This shim becomes
the sole surface the later TypeScript FFI layer binds to, so `libmgba`'s
internal layout never leaks into JS.

## User Stories

1. As a contributor building this project locally, I want a single build
   script that produces a `libmcbamgba_shim.{so,dylib}`, so that I don't
   have to hand-run CMake invocations to get a working native binary.
2. As a contributor, I want `libmgba` built with `LIBMGBA_ONLY` (no
   Qt/SDL/X11), so that I can build and test on a headless machine or CI
   runner with no display server or GUI toolket installed.
3. As a contributor, I want the build to actually produce a shared object
   (not a static archive), so that koffi can `dlopen` it at runtime.
4. As a future maintainer of the TypeScript FFI layer, I want a flat C ABI
   with fixed, simple signatures (no raw vtables, no internal mGBA structs
   exposed), so that the koffi bindings stay simple and don't have to mirror
   `libmgba`'s internal memory layout.
5. As a future maintainer, I want the shim to expose ROM loading (`load_rom`,
   `unload_rom`), reset, stepping (`step`), and 8/16/32-bit bus read/write,
   so that Milestone 2's MCP tools have something to bind to.
6. As a future maintainer, I want the shim to expose breakpoint/watchpoint
   set/clear/list functions backed by `mDebuggerPlatform`, so that
   Milestone 3's debugger tools have something to bind to.
7. As a future maintainer, I want the shim to expose register read/write/list
   functions, so that Milestone 3's register tools have something to bind
   to.
8. As a contributor, I want a smoke test that loads the tiny fixture ROM
   through the shim and reads a known memory address, so that I can verify
   the native layer works in isolation before any TypeScript exists.

## Implementation Decisions

- `libmgba` is vendored as a pinned submodule or CMake `FetchContent` at the
  latest stable mGBA release tag — not a floating branch reference, so
  builds are reproducible.
- Build flags: `-DLIBMGBA_ONLY=ON -DBUILD_SHARED=ON -DBUILD_STATIC=OFF`.
  `LIBMGBA_ONLY` normally forces `BUILD_SHARED=OFF`/`BUILD_STATIC=ON` in
  mGBA's `CMakeLists.txt`, so this milestone must empirically verify the
  override takes effect; if it doesn't, the build script sets the cache
  variable explicitly (`-DBUILD_SHARED:BOOL=ON`) before the `LIBMGBA_ONLY`
  block runs, or builds in two CMake passes.
- `native/shim.c`/`native/shim.h` wrap the `mCore` function-pointer vtable
  (`include/mgba/core/core.h`) and `mDebuggerPlatform`
  (`include/mgba/debugger/debugger.h`, attached via `mDebuggerAttach`) into
  named C functions, e.g. `mcbamgba_load_rom(path)`, `mcbamgba_step(void)`,
  `mcbamgba_bus_read8(addr)`, `mcbamgba_set_breakpoint(addr) -> id`,
  `mcbamgba_get_registers(out_struct*)`.
- `native/CMakeLists.txt` builds `libmgba` as a dependency, then links
  `shim.c` against it into `libmcbamgba_shim.{so,dylib}`.
- A build script (`native/build.sh` or an npm script) runs the CMake/make
  invocation for the current platform, outputting to
  `native/build/<platform>/`.
- No display, Qt, or SDL headers are referenced anywhere in this
  configuration — this is the concrete mechanism that satisfies the
  project's "no X server" requirement.

## Testing Decisions

- A standalone smoke test (C or a minimal Node script calling the shim
  directly, ahead of any MCP server code) loads the fixture ROM from
  Milestone 4 and reads a known memory address to confirm the shim +
  `libmgba` build actually works end-to-end.
- This is a deep module: the shim's C ABI is the one thing every later
  milestone depends on and should rarely change shape once stable, so it's
  worth testing in isolation before any TypeScript exists.
- No mocking of `libmgba` itself — the test runs against the real compiled
  shared library and the real fixture ROM.

## Out of Scope

- The TypeScript/koffi binding layer (Milestone 2).
- Breakpoint/watchpoint/register/disassembly shim functions beyond what's
  needed to unblock Milestone 1's own smoke test (full coverage lands in
  Milestone 3, though the vtable wiring for them may be added here if
  convenient).
- CI matrix builds and prebuilt-binary packaging (Milestone 5).
- Windows and Linux-arm64 builds.

## Further Notes

`LIBMGBA_ONLY`'s forced-static behavior is the single biggest risk in this
milestone — confirm it empirically early rather than assuming the
command-line override works as documented.
