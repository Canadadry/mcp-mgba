#!/usr/bin/env bash
# Assembles test/fixtures/rom/fixture.s into a loadable .gba fixture ROM,
# from source, every time this script runs. The output is never committed
# (see .gitignore) - only the assembly source and this script are tracked
# in git, per the project's no-committed-binary-ROM policy (see
# docs/prd/triage/04-test-fixture-rom.md).
#
# Shared by both:
#   - `npm test` (wired in as the "pretest" npm script)
#   - `native/build.sh --test` (runs this before the CTest smoke test)
# so the fixture-assembly logic lives in exactly one place.
#
# Toolchain prerequisite (OS-installed, not npm-installed): a bare ARM
# cross binutils providing arm-none-eabi-as/-ld/-objcopy. This is NOT the
# full devkitARM toolchain - just its assembler/linker/objcopy, e.g.
# Debian/Ubuntu's `binutils-arm-none-eabi` package (~3MB). See README.md
# for details.
#
# Usage: test/fixtures/rom/build.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/fixture.s"
BUILD_DIR="$SCRIPT_DIR/build"
OUT="$BUILD_DIR/fixture.gba"

AS=arm-none-eabi-as
LD=arm-none-eabi-ld
OBJCOPY=arm-none-eabi-objcopy

for tool in "$AS" "$LD" "$OBJCOPY"; do
	if ! command -v "$tool" >/dev/null 2>&1; then
		cat >&2 <<EOF
error: required toolchain binary '$tool' not found on PATH.

This project assembles its test fixture ROM from source
(test/fixtures/rom/fixture.s) at test time instead of committing a
prebuilt binary. That needs a bare ARM cross-assembler/linker - NOT the
full devkitARM toolchain, just its binutils.

On Debian/Ubuntu:
    sudo apt-get install binutils-arm-none-eabi

On macOS (Homebrew):
    brew install --cask gcc-arm-embedded
  (or any package that puts arm-none-eabi-as/-ld/-objcopy on PATH)

See README.md's "Test fixture ROM" section for details.
EOF
		exit 1
	fi
done

mkdir -p "$BUILD_DIR"

"$AS" -mcpu=arm7tdmi -o "$BUILD_DIR/fixture.o" "$SRC"
"$LD" -Ttext=0x08000000 -e _start -o "$BUILD_DIR/fixture.elf" "$BUILD_DIR/fixture.o"
"$OBJCOPY" -O binary "$BUILD_DIR/fixture.elf" "$OUT"

# --- Patch the header complement checksum (offset 0xBD) --------------------
# GBA header checksum = -(sum of bytes 0xA0..0xBC) - 0x19, mod 256. Not
# actually read anywhere in this project's loading path (see fixture.s's
# header comment for why), but computed and patched in anyway so the
# fixture is a fully spec-valid GBA header, not just one that happens to
# satisfy this one loader's two magic-byte checks.
sum=0
while read -r byte; do
	[ -n "$byte" ] || continue
	sum=$((sum + byte))
done < <(od -An -tu1 -j $((0xA0)) -N 29 "$OUT" | tr -s ' ' '\n')
checksum=$(( (0 - sum - 0x19) & 0xFF ))
printf "$(printf '\\x%02x' "$checksum")" | dd of="$OUT" bs=1 seek=$((0xBD)) count=1 conv=notrunc status=none

echo "built: $OUT"
