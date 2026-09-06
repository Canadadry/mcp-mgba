# mcp-mgba

A headless GBA debugger MCP server: it lets an LLM (or any MCP client) load
a Game Boy Advance ROM, step it instruction-by-instruction, read/write
memory, and manage breakpoints/watchpoints/registers — all with zero GUI
toolkit dependency (no X server, no Qt, no SDL window). Under the hood it's
built on [mGBA](https://mgba.io/)'s core emulation library (`libmgba`),
built headless.

## Prerequisites

- `cmake`, a C compiler (gcc/clang), and `make` — for building the native
  shim.
- Node.js `>=18` and npm.

## Setup

```sh
git submodule update --init --recursive   # first time only
native/build.sh                            # build the native shim
npm install
npm run build                              # tsc -> dist/
```

## Running

```sh
npm start        # runs dist/index.js over stdio
# or, for local development without a build step:
npm run dev       # runs src/index.ts directly via tsx
```

Point any MCP client at the built server to drive it interactively, e.g.:

```sh
npx @modelcontextprotocol/inspector node dist/index.js
```

By default the server locates its native shim next to itself
(`native/build/<platform>/` in a checkout, or `prebuilt/<platform>/` in a
published install). Set `MCBAMGBA_SHIM_PATH` to point it at a shim built
elsewhere instead.

## Tools

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

Every tool other than `load_rom` fails with a structured `[NO_ROM_LOADED]`
error if called before a ROM is loaded. `clear_breakpoint`,
`clear_watchpoint`, and `set_register` fail with a structured `[NOT_FOUND]`
error if given an id/register name that doesn't exist.

The server is fully synchronous/pull-based — every tool call blocks and
returns a definitive result — and supports a single loaded ROM/session at
a time.

## License

MPL-2.0 — see [`LICENSE`](LICENSE). Built on [mGBA](https://mgba.io/)'s
`libmgba` (also MPL-2.0), vendored as a git submodule and statically
linked into the compiled native shim this package distributes. See
[`NOTICE`](NOTICE) for the exact vendored tag/commit.
