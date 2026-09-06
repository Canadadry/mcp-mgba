# Milestone 3: Debugger tools — breakpoints, watchpoints, registers, disassembly

## Problem Statement

The core toolset (Milestone 2) lets an LLM step and inspect memory, but that
alone doesn't make this a *debugger*: there is no way to stop execution at a
condition of interest (a breakpoint or a memory watchpoint), inspect/mutate
CPU registers, or turn raw memory at the program counter into readable
disassembly. Without these, diagnosing "why does the game do X at this
point" still requires manual single-stepping through the whole run.

## Solution

Extend the native shim with breakpoint/watchpoint and register
functions backed by `mDebuggerPlatform`, add a disassembly function backed
by mGBA's internal ARM/THUMB decoder, and implement a synchronous
`run_until_breakpoint()` MCP tool that loops stepping internally (in the
shim, not in JS) until a breakpoint/watchpoint fires or a safety frame cap
is hit.

## User Stories

1. As an LLM client, I want a `set_breakpoint(addr)` tool, so that I can stop
   execution exactly when the program counter reaches an address I care
   about.
2. As an LLM client, I want a `clear_breakpoint(id)` tool, so that I can
   remove a breakpoint once it's no longer useful.
3. As an LLM client, I want a `list_breakpoints` tool, so that I can see
   which breakpoints are currently active without tracking that state
   myself across the conversation.
4. As an LLM client, I want a `set_watchpoint(addr, kind)` tool (read/write/
   access), so that I can stop execution when a specific memory location
   changes or is read, not just when the PC reaches a fixed address.
5. As an LLM client, I want a `clear_watchpoint(id)` tool, so that I can
   remove a watchpoint once it's no longer useful.
6. As an LLM client, I want a `run_until_breakpoint` tool that blocks until a
   breakpoint or watchpoint fires (or a safety cap is hit) and then returns
   the stop reason plus current CPU state, so that I don't have to manually
   call `step` in a loop from the client side.
7. As an LLM client, I want a `get_registers` tool, so that I can inspect the
   full CPU register set (general-purpose + status registers) at the current
   point in execution.
8. As an LLM client, I want a `set_register` tool, so that I can mutate a
   register to test a hypothesis about program behavior.
9. As an LLM client, I want a `disassemble(addr, count)` tool, so that I can
   read human-readable ARM/THUMB instructions around the current PC instead
   of raw opcode bytes.
10. As an LLM client, when `run_until_breakpoint` hits its safety frame cap
    instead of an actual breakpoint, I want that distinguished clearly in
    the response from a "breakpoint hit" result, so that I don't mistake a
    timeout for the condition I was looking for.

## Implementation Decisions

- Shim additions: `mDebuggerAttach`-based breakpoint set/clear/list and
  watchpoint set/clear/list functions, plus `readRegister`/`writeRegister`/
  `listRegisters`-backed functions, following the same flat-C-ABI pattern as
  Milestone 1.
- Disassembly: spike against mGBA's internal ARM/THUMB decoder headers
  (`include/mgba/internal/arm/decoder.h` at the pinned vendored tag) to land
  on a `mcbamgba_disassemble(addr, count, out_buf)` shim function. Because
  `libmgba` is built from source in this project (not consumed as a
  preinstalled SDK), including internal headers at compile time is fine —
  it only affects this project's own native build, not runtime `dlopen`
  compatibility for consumers. If no clean decode-to-string entry point
  exists at the pinned version, fall back to formatting raw opcode bytes
  rather than blocking the milestone on it.
- `run_until_breakpoint()` is implemented as an internal loop inside the
  shim (repeated `step`/`runFrame` calls) rather than a loop on the
  TypeScript side, so the MCP call stays a single synchronous request/response
  with no polling and no threads in the Node process — consistent with the
  project's blocking, pull-based execution model.
- A safety frame cap bounds `run_until_breakpoint` so a breakpoint that
  never fires can't hang the tool call indefinitely; the cap value and the
  "cap hit" vs. "breakpoint hit" distinction are surfaced in the tool's
  response.

## Testing Decisions

- Integration test: set a breakpoint at the fixture ROM's known
  memory-write instruction, call `run_until_breakpoint`, and assert the
  reported PC/registers match what's expected at that instruction.
- Integration test: set a watchpoint on the fixture ROM's known write
  address, call `run_until_breakpoint`, and assert it stops for the write
  rather than running past it.
- Integration test: call `disassemble` at a known address in the fixture
  ROM and assert the decoded mnemonic/operands match the ROM's known
  assembly source (ties disassembly correctness back to a fixture whose
  source is in the repo, not just an opaque binary).
- The shim's debugger-attachment logic is a deep module: it should be
  testable by asserting stop reason + register state, without the test
  needing to know how `mDebuggerPlatform` is wired internally.

## Out of Scope

- ELF/symbol loading (so disassembly output is address-based, not
  symbol-annotated).
- Multi-session support.
- Conditional breakpoints (e.g. "break when register X equals Y") beyond
  plain address breakpoints and typed watchpoints.

## Further Notes

The disassembly spike is the one open technical unknown in this milestone —
budget time to confirm the exact decode-to-string call exists at the
pinned mGBA tag before committing to the `disassemble` tool's output format.
