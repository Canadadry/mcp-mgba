# Milestone 5: Packaging, CI matrix, and licensing

## Problem Statement

Even once the native shim and MCP tools work locally, there is no
repeatable way to build the native library for every platform this project
targets, no self-contained npm package (a consumer would need a compiler
and network access to `libmgba`'s source), and no licensing/attribution
paperwork to distribute mGBA's code (MPL-2.0) inside this package.

## Solution

Add a CI build matrix that compiles the native shim for linux-x64 and macOS
(arm64 + x64), a publish step that bundles those prebuilt shared libraries
into the npm tarball, and the MPL-2.0 licensing/attribution files that make
that bundling compliant.

## User Stories

1. As a consumer of this package, I want `npm install`/`npx` to work with no
   compiler, no `node-gyp`, and no network fetch beyond npm itself, so that
   installing this MCP server is as simple as any other npm package.
2. As a consumer on linux-x64 or macOS (arm64 or x64), I want the correct
   prebuilt native library selected automatically at runtime, so that I
   don't have to configure anything platform-specific myself.
3. As a maintainer, I want CI to build the native shim on every target
   platform in a matrix, so that a platform-specific build break is caught
   before publishing, not reported by a user after install.
4. As a maintainer, I want prebuilt binaries produced by CI but *not*
   committed into git history, so that the repository doesn't accumulate a
   binary diff on every `libmgba` version bump.
5. As a maintainer, I want a publish step that pulls the latest CI-built
   artifacts into `prebuilt/<platform>/` immediately before `npm publish`,
   so that the published tarball is self-contained while the git repo stays
   lean.
6. As a legal/compliance reviewer, I want a `LICENSE` (MPL-2.0) and a
   `NOTICE` file recording the exact vendored `libmgba` tag/commit and a
   link to its source, so that distributing mGBA's compiled code inside
   this package satisfies MPL-2.0's source-availability terms.
7. As a maintainer, I want the published npm package's file list restricted
   to `dist/`, `prebuilt/`, `LICENSE`, and `NOTICE`, so that native build
   artifacts, source, and CI scaffolding aren't shipped to consumers by
   accident.

## Implementation Decisions

- `.github/workflows/build-native.yml`: a matrix over linux-x64 and macOS
  (arm64 + x64) runners, each running the Milestone 1 build script and
  uploading the resulting shared library as a CI artifact.
- A separate publish workflow/script downloads those artifacts into
  `prebuilt/<platform>/` right before `npm publish` — this is the only time
  prebuilt binaries touch the working tree; they are not committed to git
  history.
- `src/ffi.ts` (from Milestone 2) selects the correct path under
  `prebuilt/` at runtime based on `process.platform`/`process.arch`.
- `package.json`'s `files` field is scoped to `dist/`, `prebuilt/`,
  `LICENSE`, `NOTICE` only.
- `LICENSE` is MPL-2.0 (matching mGBA's own license); `NOTICE` records the
  exact vendored mGBA tag/commit and a link to its upstream source.
- Windows and linux-arm64 targets are explicitly deferred, so the matrix and
  the `prebuilt/` directory only need linux-x64 and macOS (arm64 + x64) for
  v1.

## Testing Decisions

- `.github/workflows/ci.yml` runs lint, typecheck, and the unit/integration
  test suite from Milestones 2-3 on linux-x64 with no Xvfb, no display
  server, and no Qt/SDL packages installed on the runner — this is the
  concrete, automated proof of the project's "no X server / no Qt" headless
  requirement, not just a claim in documentation.
- CI matrix build success itself is the test for this milestone's native
  build reproducibility — no separate unit tests are needed for the CI
  configuration beyond "the matrix jobs complete and produce artifacts."
- Before the first real `npm publish`, a manual dry run (`npm pack` +
  install from the resulting tarball on a clean machine per target
  platform) verifies the packaging step actually produces an installable,
  self-contained package.

## Out of Scope

- Windows and Linux-arm64 CI jobs and prebuilt binaries.
- Automated `npm publish` on tag push (this milestone covers the build/
  package mechanics; release automation can follow later).
- Code signing/notarization of macOS binaries.

## Further Notes

This milestone depends on Milestones 1-4 being functionally complete (there
needs to be something real to build, test, and package), so it's sequenced
last even though the CI *scaffolding* for lint/typecheck could reasonably
start earlier alongside Milestone 2.
