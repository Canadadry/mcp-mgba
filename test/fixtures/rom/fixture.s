@ mcp-mgba test fixture ROM (Milestone 4 - docs/prd/triage/04-test-fixture-rom.md)
@
@ A tiny, from-scratch homebrew GBA ROM. This is the ONLY thing committed to
@ git for this fixture: assembly source, no binary. It is assembled into a
@ loadable .gba file at test time by test/fixtures/rom/build.sh (invoked by
@ both `npm test`'s "pretest" script and `native/build.sh --test`), and the
@ built binary is gitignored (test/fixtures/rom/build/).
@
@ Known behavior, depended on by native/test/smoke_test.c,
@ test/session.test.ts, test/integration.test.ts, and test/debugger.test.ts:
@ four instructions starting at 0x080000C0 (right after the 192-byte GBA
@ header) that write a known constant to a known IWRAM address, then loop
@ forever:
@
@   0x080000C0: mov  r0, #0x03000000   @ r0 = start of IWRAM
@   0x080000C4: mov  r1, #0x42         @ r1 = the known constant
@   0x080000C8: str  r1, [r0]          @ the known write: IWRAM[0x03000000] = 0x42
@   0x080000CC: b    loop              @ infinite loop (branches to itself)
@
@ --- ROM header (offsets 0x00-0xBF) ---
@
@ A standard 192-byte GBA cartridge header. libmgba's loader
@ (native/vendor/mgba/src/gba/gba.c's GBAIsROM(), used both to pick the GBA
@ core for this file and to actually open it - see mCoreFind/mCoreLoadFile
@ in native/vendor/mgba/src/core/core.c) checks exactly two bytes: offset
@ 0x03 must be 0xEA (the fixed top byte of any unconditional ARM branch
@ opcode - i.e. the entry-point instruction just needs to *be* a branch,
@ which "b main" already guarantees) and offset 0xB2 must be 0x96 (the
@ header's "fixed value" byte). It does NOT check the Nintendo logo bitmap
@ or the header checksum for a ROM load in this shim: this shim always
@ forces core->opts.skipBios = true (see native/shim.c), so the one place
@ libmgba would look at the logo (deciding whether to skip the BIOS intro)
@ is never reached. The logo bitmap below is therefore left zero-filled.
@ The header complement checksum at offset 0xBD is nonetheless computed
@ correctly and patched in by build.sh after assembly (not because
@ anything here validates it, but so this is a fully spec-valid GBA header,
@ not just one that happens to satisfy this one loader).

	.syntax unified
	.arm
	.section .text
	.global _start

_start:
	b	main			@ 0x00: entry point (top opcode byte = 0xEA)

	.space	156, 0			@ 0x04-0x9F: Nintendo logo (unused by this loader, zero-filled)

	.ascii	"MCPMGBAFIX00"		@ 0xA0-0xAB: game title (12 bytes)
	.ascii	"MCPM"			@ 0xAC-0xAF: game code (4 bytes)
	.space	2, 0			@ 0xB0-0xB1: maker code
	.byte	0x96			@ 0xB2: fixed value (checked by GBAIsROM)
	.byte	0x00			@ 0xB3: main unit code
	.byte	0x00			@ 0xB4: device type
	.space	7, 0			@ 0xB5-0xBB: reserved
	.byte	0x00			@ 0xBC: software version
	.byte	0x00			@ 0xBD: header checksum (placeholder, patched by build.sh)
	.space	2, 0			@ 0xBE-0xBF: reserved

main:					@ 0xC0: cartridge code starts here
	mov	r0, #0x03000000
	mov	r1, #0x42
	str	r1, [r0]
loop:
	b	loop
