#!/usr/bin/env bash
# Populates prebuilt/<platform>/ from a completed build-native.yml CI run,
# immediately before `npm publish` - the only time prebuilt binaries touch
# the working tree (they are never committed to git; see .gitignore and
# docs/prd/triage/05-packaging-ci-licensing.md).
#
# Usage:
#   scripts/prepare-publish.sh <build-native.yml run id>
#
# Requires the GitHub CLI (`gh`), authenticated against this repo, since it
# downloads workflow-run artifacts via `gh run download`. Find a run id with:
#   gh run list --workflow=build-native.yml --limit 5
#
# After this script finishes, `prebuilt/` is laid out to match
# src/ffi.ts's resolveShimPath():
#   prebuilt/linux-x64/libmcbamgba_shim.so
#   prebuilt/darwin-arm64/libmcbamgba_shim.dylib
#   prebuilt/darwin-x64/libmcbamgba_shim.dylib
#
# Then `npm publish` picks up prebuilt/ via package.json's "files" field.
set -euo pipefail

if [ $# -ne 1 ]; then
	echo "usage: $0 <build-native.yml run id>" >&2
	exit 1
fi
RUN_ID="$1"

if ! command -v gh >/dev/null 2>&1; then
	echo "error: GitHub CLI ('gh') not found on PATH - see https://cli.github.com/" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PREBUILT_DIR="$REPO_ROOT/prebuilt"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# artifact name -> prebuilt/<platform> dir + expected library filename,
# mirroring build-native.yml's matrix and src/ffi.ts's resolveShimPath().
declare -A PLATFORM_DIR=(
	[shim-linux-x64]="linux-x64"
	[shim-darwin-arm64]="darwin-arm64"
	[shim-darwin-x64]="darwin-x64"
)
declare -A PLATFORM_LIB=(
	[shim-linux-x64]="libmcbamgba_shim.so"
	[shim-darwin-arm64]="libmcbamgba_shim.dylib"
	[shim-darwin-x64]="libmcbamgba_shim.dylib"
)

echo "Downloading build-native.yml artifacts from run $RUN_ID..."
gh run download "$RUN_ID" --dir "$WORK_DIR"

rm -rf "$PREBUILT_DIR"
for artifact in "${!PLATFORM_DIR[@]}"; do
	platform="${PLATFORM_DIR[$artifact]}"
	lib="${PLATFORM_LIB[$artifact]}"
	src="$WORK_DIR/$artifact/$lib"
	if [ ! -f "$src" ]; then
		echo "error: expected artifact file not found: $src" >&2
		echo "       (did run $RUN_ID actually build every matrix leg?)" >&2
		exit 1
	fi
	dest_dir="$PREBUILT_DIR/$platform"
	mkdir -p "$dest_dir"
	cp "$src" "$dest_dir/$lib"
	chmod +x "$dest_dir/$lib"
	echo "  prebuilt/$platform/$lib"
done

echo "Done. prebuilt/ is ready - inspect it, then run 'npm pack' or 'npm publish'."
