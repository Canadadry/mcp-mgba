# Milestone 4: Test fixture ROM

## Problem Statement

Milestones 2 and 3's integration tests all need a real GBA ROM with known,
predictable behavior (a specific memory write at a specific address/
instruction) to assert against. The project's tests must not depend on any
copyrighted commercial game ROM — none of those can be committed to or
fetched into the repo — so no such fixture currently exists.

## Solution

Write a tiny, from-scratch homebrew GBA ROM in assembly (write a known
constant to a known IWRAM address, then loop) and assemble it as part of the
test pipeline, committing only its assembly source to the repo — never a
prebuilt binary artifact.

## User Stories

1. As a contributor running the test suite, I want the fixture ROM built
   from source during the test run (or a prior CI step), so that no
   binary ROM file needs to be committed to git history.
2. As a contributor, I want the fixture ROM's behavior (which address it
   writes, what value, when) to be simple and documented, so that
   Milestones 2 and 3's integration tests can assert against it without
   reverse-engineering the fixture itself.
3. As a maintainer, I want the fixture ROM's source small enough to read in
   one sitting (a handful of instructions), so that it stays trivially
   auditable and isn't mistaken for actual product functionality.
4. As a contributor setting up the project for the first time, I want the
   fixture build to use a documented, minimal toolchain, so that I'm not
   blocked by an undocumented dependency (e.g. a specific devkitARM
   version) when trying to run tests locally.
5. As a legal/compliance reviewer, I want confidence that no copyrighted
   game ROM ever enters the repository or CI artifacts, so that the project
   has no ROM-distribution risk.

## Implementation Decisions

- Fixture source lives under `test/fixtures/rom/` as assembly only (no
  binary committed).
- Content: a minimal program — write a known constant to a known IWRAM
  address, then an infinite loop (or a small number of predictable
  instructions) — chosen specifically to give Milestones 2 and 3's tests an
  unambiguous "did the expected memory write happen" and "does disassembly
  at this address match this known instruction" assertion target.
- Toolchain: assembled with `devkitARM`'s `arm-none-eabi-as` plus `gbafix`
  to produce a valid GBA ROM header. If pulling in the full devkitARM
  toolchain proves too heavy for CI, fall back to a minimal hand-built ROM
  header + raw machine code bytes assembled by a lighter tool — this
  tradeoff should be decided empirically in this milestone based on what's
  actually available/installable in the CI image.
- The build step (assemble fixture → `.gba` file) runs as part of the test
  pipeline (e.g. a `pretest` script or a CI step before the integration
  tests), not committed as a build artifact.

## Testing Decisions

- This milestone's own "test" is that the fixture assembles successfully
  and produces a valid GBA header (checked via a small assertion in the
  build step or a trivial test that just loads it through the Milestone 1
  shim and confirms `load_rom` succeeds).
- The fixture's real value is as a dependency of Milestones 2 and 3's
  integration tests — no independent behavioral test suite is needed for
  the fixture beyond "it builds and loads."

## Out of Scope

- Any commercial/copyrighted ROM, in source or binary form.
- Multiple fixture ROMs for different scenarios — v1 ships with exactly one,
  sized to cover the memory-write/breakpoint/watchpoint/disassembly
  assertions Milestones 2-3 need.

## Further Notes

Because Milestones 2 and 3 both depend on this fixture's exact behavior,
land this milestone before or alongside the start of Milestone 2's test
work, not strictly after Milestone 3.
