# Releasing

This package ships as a self-contained npm tarball: `npm install` needs no
compiler, no `node-gyp`, and no network fetch beyond npm itself, because
the native shim is prebuilt per-platform ahead of time rather than
compiled on install. Windows and linux-arm64 are explicitly out of scope
for now — only linux-x64 and macOS (arm64 + x64) are built and published.

Automated `npm publish` on tag push is out of scope for now — publishing
is a deliberate, manual step a maintainer runs:

1. Make sure [`.github/workflows/build-native.yml`](../.github/workflows/build-native.yml)
   has completed successfully for the commit being released (push to
   `master` triggers it, or trigger it manually — it also accepts
   `workflow_dispatch`), and note its run id
   (`gh run list --workflow=build-native.yml`).
2. Populate `prebuilt/<platform>/` from that run's artifacts. Either:
   - run [`scripts/prepare-publish.sh <run id>`](../scripts/prepare-publish.sh)
     locally (requires the `gh` CLI, authenticated against this repo), or
   - trigger [`.github/workflows/publish.yml`](../.github/workflows/publish.yml)
     (`workflow_dispatch`, `build_run_id` input) to do the same download
     plus `npm publish` in CI, gated behind a `dry_run` input (defaults to
     `true`, which runs `npm publish --dry-run` instead of a real publish).
3. `prebuilt/` is never committed to git (see `.gitignore`) — it exists
   only in the working tree for this one step, immediately before
   `npm publish`/`npm pack`. `package.json`'s `files` field scopes the
   published tarball to `dist/`, `prebuilt/`, `LICENSE`, and `NOTICE` only
   (verify with `npm pack --dry-run` before a real publish).

At runtime, `src/ffi.ts`'s `resolveShimPath()` picks up whichever
`prebuilt/<platform>/` shim matches `process.platform`/`process.arch`.
