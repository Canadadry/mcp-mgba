#!/usr/bin/env bash
# Builds the native shim (libmcbamgba_shim.{so,dylib}) against a headless,
# shared-library build of libmgba, for the current platform.
#
# Usage:
#   native/build.sh              # configure + build
#   native/build.sh --test       # configure + build + run the smoke test
#   native/build.sh --clean      # remove this platform's build directory first
#
# Output goes to native/build/<platform>/, e.g.
# native/build/linux-x64/libmcbamgba_shim.so
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_DIR="$SCRIPT_DIR"
MGBA_DIR="$NATIVE_DIR/vendor/mgba"
PATCH_FILE="$NATIVE_DIR/patches/0001-libmgba-only-shared.patch"
PATCH_MARKER="mcp-mgba: upstream forces a static-only build"

RUN_TEST=0
CLEAN=0
for arg in "$@"; do
	case "$arg" in
	--test) RUN_TEST=1 ;;
	--clean) CLEAN=1 ;;
	*)
		echo "unknown argument: $arg" >&2
		exit 1
		;;
	esac
done

# --- Resolve the platform directory name (linux-x64, darwin-arm64, ...) ---
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
Linux) platform_os="linux" ;;
Darwin) platform_os="darwin" ;;
*)
	echo "unsupported OS: $os" >&2
	exit 1
	;;
esac
case "$arch" in
x86_64 | amd64) platform_arch="x64" ;;
arm64 | aarch64) platform_arch="arm64" ;;
*)
	echo "unsupported architecture: $arch" >&2
	exit 1
	;;
esac
PLATFORM="${platform_os}-${platform_arch}"
BUILD_DIR="$NATIVE_DIR/build/$PLATFORM"

if [ ! -f "$MGBA_DIR/CMakeLists.txt" ]; then
	echo "libmgba submodule is missing at native/vendor/mgba." >&2
	echo "Run: git submodule update --init --recursive" >&2
	exit 1
fi

# --- Work around libmgba's CMakeLists.txt forcing a static-only build ---
# under LIBMGBA_ONLY (see native/CMakeLists.txt and
# native/patches/0001-libmgba-only-shared.patch for the full explanation).
# Applied idempotently to the vendored checkout so a plain `cmake` re-run
# (or a fresh submodule checkout) always ends up patched exactly once.
if ! grep -q "$PATCH_MARKER" "$MGBA_DIR/CMakeLists.txt"; then
	echo "Patching vendored libmgba CMakeLists.txt to honor BUILD_SHARED under LIBMGBA_ONLY..."
	git -C "$MGBA_DIR" apply "$PATCH_FILE"
fi

if [ "$CLEAN" -eq 1 ]; then
	rm -rf "$BUILD_DIR"
fi

mkdir -p "$BUILD_DIR"

cmake -S "$NATIVE_DIR" -B "$BUILD_DIR" \
	-DCMAKE_BUILD_TYPE=Release \
	-DLIBMGBA_ONLY=ON \
	-DBUILD_SHARED=ON \
	-DBUILD_STATIC=OFF

cmake --build "$BUILD_DIR" --parallel "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"

SHIM_LIB=$(find "$BUILD_DIR" -maxdepth 1 -name "libmcbamgba_shim.*" -print -quit)
if [ -z "$SHIM_LIB" ]; then
	echo "build finished but no libmcbamgba_shim.{so,dylib} was found in $BUILD_DIR" >&2
	exit 1
fi
echo "built: $SHIM_LIB"

if [ "$RUN_TEST" -eq 1 ]; then
	ctest --test-dir "$BUILD_DIR" --output-on-failure
fi
