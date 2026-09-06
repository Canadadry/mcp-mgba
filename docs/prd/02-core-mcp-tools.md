# Milestone 2: Core MCP tools — ROM, execution, memory, input, screenshot, state

## Problem Statement

Once the native shim (Milestone 1) exists, there is still no way for an LLM
client to actually drive the emulator: no MCP server, no TypeScript bindings
to the shim, and none of the baseline emulator-control tools (load a ROM,
step it, inspect/mutate memory, press buttons, capture the screen, save/load
state) that every later debugging feature depends on.

## Solution

Stand up the MCP server itself (stdio transport) and implement the
synchronous, single-session core toolset by binding `src/ffi.ts` to the
shim's flat C ABI via koffi, with `src/session.ts` holding the one loaded-core
handle for the process's lifetime.

## User Stories

1. As an LLM client, I want a `load_rom` tool, so that I can start a
   debugging session against a specific ROM file.
2. As an LLM client, I want a `reset` tool, so that I can restart execution
   from the beginning of the currently loaded ROM.
3. As an LLM client, I want a `step` tool, so that I can advance execution by
   a single instruction and inspect the effect.
4. As an LLM client, I want a `run_frames(n)` tool, so that I can advance
   execution by whole video frames when single-instruction stepping is too
   slow for the task at hand.
5. As an LLM client, I want a `read_memory(addr, length)` tool, so that I can
   inspect arbitrary GBA memory (IWRAM/EWRAM/ROM/etc.) at a given address.
6. As an LLM client, I want a `write_memory(addr, bytes)` tool, so that I can
   patch memory to test hypotheses (e.g. force a flag, unlock a state).
7. As an LLM client, I want a `press_button(buttons, frames)` tool, so that I
   can simulate player input and observe how the game reacts.
8. As an LLM client, I want a `screenshot` tool that returns PNG image data,
   so that I can visually inspect what's currently rendered.
9. As an LLM client, I want `save_state`/`load_state` tools, so that I can
   snapshot a point in execution and return to it later without replaying
   input.
10. As an LLM client, I want every tool call to block until it has a
    definitive result (no polling, no background jobs), so that the
    conversation stays simple: call a tool, get the state back, decide the
    next action.
11. As an LLM client, I want a clear, structured error when I call a tool
    before any ROM is loaded, so that I don't have to guess why a `step` or
    `read_memory` call failed.
12. As a maintainer, I want each tool grouped by concern in its own file
    (`tools/rom.ts`, `tools/execution.ts`, `tools/memory.ts`,
    `tools/input.ts`, `tools/screenshot.ts`, `tools/state.ts`), so that the
    tool surface stays navigable as it grows in later milestones.

## Implementation Decisions

- `src/ffi.ts`: koffi `.define()` calls mapping 1:1 onto the Milestone 1
  shim's exported functions — no additional logic beyond type marshaling.
- `src/session.ts`: owns the single loaded-core handle for the process;
  every tool call goes through it, and it's the place that raises a clean
  "no ROM loaded" error for tool calls made out of order, rather than each
  tool re-implementing that check.
- Execution model is synchronous and pull-based end-to-end: an MCP tool call
  blocks in the shim, gets a result, and returns it — no background
  execution, no separate thread, single session only (multi-session is
  explicitly deferred).
- `screenshot()` PNG-encodes the raw framebuffer returned by the shim's
  `getPixels`-backed function. Because the native build uses
  `DISABLE_DEPS` (no bundled libpng), this milestone must confirm whether a
  PNG codepath is still available from `libmgba` in that configuration or
  whether encoding needs to happen JS-side with a small pure-JS PNG encoder,
  to avoid quietly reintroducing libpng as a dependency.
- `save_state()`/`load_state(blob)` use the shim's `stateSize`/`saveState`/
  `loadState`-backed functions; state blobs are opaque binary data returned
  to/accepted from the MCP client, not interpreted by the server.
- `src/index.ts` registers one `server.tool(...)` per tool file using
  `@modelcontextprotocol/sdk` over stdio transport.

## Testing Decisions

- Integration test (not unit-mocked) that: loads the Milestone 4 fixture
  ROM, steps N frames, reads the RAM address the fixture ROM is known to
  write, takes a screenshot, and round-trips a save state (save, mutate
  state further, load, confirm memory matches the saved point).
- `src/session.ts` is the deep module worth testing in isolation: exercise
  its "no ROM loaded" error path directly, separate from any individual
  tool.
- Tool handlers themselves are thin (parse MCP input → call session/ffi →
  format MCP output) and are covered by the end-to-end integration test
  rather than being unit-tested individually.

## Out of Scope

- Breakpoints, watchpoints, register read/write, and disassembly
  (Milestone 3).
- The fixture ROM itself (Milestone 4) — this milestone consumes it as a
  fixed input.
- Prebuilt binary packaging / CI matrix (Milestone 5).
- Multi-session support, ELF/symbol loading.

## Further Notes

The PNG-encoding question (native `libmgba` PNG support vs. JS-side
encoding under `DISABLE_DEPS`) should be resolved early in this milestone —
it affects whether any new runtime dependency needs to be added to
`package.json`.
