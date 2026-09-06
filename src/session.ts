/**
 * Owns the single loaded-core handle for the process's lifetime.
 *
 * Every tool handler goes through a `Session` instance rather than calling
 * `src/ffi.ts` directly. Its main job is enforcing one rule in one place:
 * any operation other than `loadRom`/`unloadRom` made while no ROM is
 * loaded raises a clean, structured `SessionError` - several of the
 * underlying shim calls (bus reads/writes in particular) silently no-op
 * instead of erroring when no core is loaded, so this check can't be
 * pushed down into the native layer alone.
 *
 * Single-session model: one `Session` instance per process, matching the
 * shim's single global core handle (see native/shim.c).
 */
import koffi from "koffi";
import * as ffi from "./ffi.js";
import { encodeRgbaToPng } from "./png.js";

export type SessionErrorCode = "NO_ROM_LOADED" | "LOAD_FAILED" | "OPERATION_FAILED" | "NOT_FOUND";

export interface Breakpoint {
	id: number;
	address: number;
}

export interface Watchpoint {
	id: number;
	address: number;
	/** One of ffi.MCBAMGBA_WATCHPOINT_*. */
	type: number;
}

export interface RegisterValue {
	name: string;
	value: number;
}

export type StopReason = "breakpoint" | "watchpoint" | "cap";

export interface RunUntilBreakpointResult {
	/** "cap" means the safety instruction cap was reached with nothing
	 * firing - a timeout, not a hit. Always check this before trusting
	 * pointId/address/watch* as a real stop. */
	stopReason: StopReason;
	/** The id of the breakpoint/watchpoint that fired, or null for a "cap"
	 * stop (nothing fired). */
	pointId: number | null;
	/** "breakpoint": the breakpoint's address. "watchpoint": the accessed
	 * address. "cap": the current PC when the cap was hit. */
	address: number;
	/** Populated only for stopReason === "watchpoint". */
	watchType?: number;
	oldValue?: number;
	newValue?: number;
	/** Number of instructions this call actually executed. */
	instructionsRun: number;
}

export interface DisassembledInstruction {
	address: number;
	/** The raw opcode: the full ARM word, or a Thumb halfword (see size). */
	opcode: number;
	/** Instruction size in bytes: 4 for ARM, 2 for Thumb. */
	size: number;
	/** Decoded mnemonic + operands, e.g. "str r1, [r0]". */
	text: string;
}

// Generous fixed caps for the list_* out-buffers below - the debugger tools
// are for interactive/LLM use, not scripted bulk dumps, so a session
// realistically never approaches these.
const MAX_BREAKPOINTS = 256;
const MAX_WATCHPOINTS = 256;
const MAX_REGISTERS = 64;
/** Exported so tools/debugger.ts's input schema enforces the same bound
 * before it ever reaches this class. */
export const MAX_DISASSEMBLE_COUNT = 256;

/** Structured error raised for any session misuse - primarily calling a
 * tool before `load_rom`, per the PRD's "clear, structured error" user
 * story. `code` is stable and meant to be machine-checked; `message` is
 * for humans/LLMs. */
export class SessionError extends Error {
	constructor(
		public readonly code: SessionErrorCode,
		message: string,
	) {
		super(message);
		this.name = "SessionError";
	}
}

export class Session {
	/** Throws SessionError('NO_ROM_LOADED') unless a ROM is currently
	 * loaded. Call at the top of every method below except
	 * loadRom/unloadRom/isRomLoaded. */
	private ensureRomLoaded(): void {
		if (ffi.isRomLoaded() === 0) {
			throw new SessionError(
				"NO_ROM_LOADED",
				"No ROM is loaded. Call load_rom before any other tool.",
			);
		}
	}

	isRomLoaded(): boolean {
		return ffi.isRomLoaded() !== 0;
	}

	loadRom(path: string): void {
		const rc = ffi.loadRom(path);
		if (rc !== ffi.MCBAMGBA_OK) {
			throw new SessionError(
				"LOAD_FAILED",
				`Failed to load ROM at '${path}' (shim returned error code ${rc}).`,
			);
		}
	}

	unloadRom(): void {
		ffi.unloadRom();
	}

	reset(): void {
		this.ensureRomLoaded();
		ffi.reset();
	}

	step(): void {
		this.ensureRomLoaded();
		ffi.step();
	}

	runFrames(count: number): void {
		this.ensureRomLoaded();
		for (let i = 0; i < count; i++) {
			ffi.runFrame();
		}
	}

	readMemory(address: number, length: number): Buffer {
		this.ensureRomLoaded();
		const out = Buffer.alloc(length);
		for (let i = 0; i < length; i++) {
			out[i] = ffi.busRead8(address + i);
		}
		return out;
	}

	writeMemory(address: number, bytes: Uint8Array): void {
		this.ensureRomLoaded();
		for (let i = 0; i < bytes.length; i++) {
			ffi.busWrite8(address + i, bytes[i]!);
		}
	}

	/** Sets a hardware breakpoint at `address`. Returns its id. Fires just
	 * before the instruction at `address` executes - see runUntilBreakpoint. */
	setBreakpoint(address: number): number {
		this.ensureRomLoaded();
		const id = ffi.setBreakpoint(address);
		if (id < 1) {
			throw new SessionError(
				"OPERATION_FAILED",
				`Failed to set a breakpoint at 0x${address.toString(16)} (shim returned ${id}).`,
			);
		}
		return Number(id);
	}

	/** Clears the breakpoint with the given id. */
	clearBreakpoint(id: number): void {
		this.ensureRomLoaded();
		const rc = ffi.clearBreakpoint(id);
		if (rc !== ffi.MCBAMGBA_OK) {
			throw new SessionError("NOT_FOUND", `No breakpoint with id ${id} exists.`);
		}
	}

	/** Lists every currently-set breakpoint. */
	listBreakpoints(): Breakpoint[] {
		this.ensureRomLoaded();
		const buf = Buffer.alloc(MAX_BREAKPOINTS * koffi.sizeof(ffi.mcbamgba_breakpoint_t));
		const count = ffi.listBreakpoints(buf, MAX_BREAKPOINTS);
		if (count < 0) {
			throw new SessionError(
				"OPERATION_FAILED",
				`Failed to list breakpoints (shim returned ${count}).`,
			);
		}
		if (count === 0) {
			return [];
		}
		const decoded = koffi.decode(buf, koffi.array(ffi.mcbamgba_breakpoint_t, count)) as Array<{
			id: number;
			address: number;
		}>;
		return decoded.map((bp) => ({ id: Number(bp.id), address: bp.address }));
	}

	/** Sets a watchpoint of the given MCBAMGBA_WATCHPOINT_* type at
	 * `address`. Returns its id. */
	setWatchpoint(address: number, type: number): number {
		this.ensureRomLoaded();
		const id = ffi.setWatchpoint(address, type);
		if (id < 1) {
			throw new SessionError(
				"OPERATION_FAILED",
				`Failed to set a watchpoint at 0x${address.toString(16)} (shim returned ${id}).`,
			);
		}
		return Number(id);
	}

	/** Clears the watchpoint with the given id. */
	clearWatchpoint(id: number): void {
		this.ensureRomLoaded();
		const rc = ffi.clearWatchpoint(id);
		if (rc !== ffi.MCBAMGBA_OK) {
			throw new SessionError("NOT_FOUND", `No watchpoint with id ${id} exists.`);
		}
	}

	/** Lists every currently-set watchpoint. */
	listWatchpoints(): Watchpoint[] {
		this.ensureRomLoaded();
		const buf = Buffer.alloc(MAX_WATCHPOINTS * koffi.sizeof(ffi.mcbamgba_watchpoint_t));
		const count = ffi.listWatchpoints(buf, MAX_WATCHPOINTS);
		if (count < 0) {
			throw new SessionError(
				"OPERATION_FAILED",
				`Failed to list watchpoints (shim returned ${count}).`,
			);
		}
		if (count === 0) {
			return [];
		}
		const decoded = koffi.decode(buf, koffi.array(ffi.mcbamgba_watchpoint_t, count)) as Array<{
			id: number;
			address: number;
			type: number;
		}>;
		return decoded.map((wp) => ({ id: Number(wp.id), address: wp.address, type: wp.type }));
	}

	/** Reads the full register set (r0-r15, cpsr, ...). */
	getRegisters(): RegisterValue[] {
		this.ensureRomLoaded();
		const buf = Buffer.alloc(MAX_REGISTERS * koffi.sizeof(ffi.mcbamgba_register_t));
		const count = ffi.listRegisters(buf, MAX_REGISTERS);
		if (count < 0) {
			throw new SessionError(
				"OPERATION_FAILED",
				`Failed to list registers (shim returned ${count}).`,
			);
		}
		const decoded = koffi.decode(buf, koffi.array(ffi.mcbamgba_register_t, count)) as Array<{
			name: string;
			value: number;
		}>;
		return decoded.map((reg) => ({ name: reg.name, value: reg.value }));
	}

	/** Writes a single register by name (e.g. "r0", "pc", "sp", "lr", "cpsr"). */
	setRegister(name: string, value: number): void {
		this.ensureRomLoaded();
		const rc = ffi.writeRegister(name, value);
		if (rc !== ffi.MCBAMGBA_OK) {
			throw new SessionError("NOT_FOUND", `No register named '${name}' exists.`);
		}
	}

	/** Runs until a breakpoint/watchpoint fires or `maxInstructions`
	 * instructions have executed without one firing (an internal loop in
	 * the native shim - a single blocking call, no polling). Always check
	 * the result's stopReason: "cap" means nothing fired before the safety
	 * cap was reached. */
	runUntilBreakpoint(maxInstructions?: number): RunUntilBreakpointResult {
		this.ensureRomLoaded();
		const out: {
			stop_reason: number;
			point_id: number;
			address: number;
			watch_type: number;
			old_value: number;
			new_value: number;
			instructions_run: number;
		} = {
			stop_reason: 0,
			point_id: 0,
			address: 0,
			watch_type: 0,
			old_value: 0,
			new_value: 0,
			instructions_run: 0,
		};
		const rc = ffi.runUntilBreakpoint(maxInstructions ?? 0, out);
		if (rc !== ffi.MCBAMGBA_OK) {
			throw new SessionError(
				"OPERATION_FAILED",
				`run_until_breakpoint failed (shim returned ${rc}).`,
			);
		}

		if (out.stop_reason === ffi.MCBAMGBA_STOP_BREAKPOINT) {
			return {
				stopReason: "breakpoint",
				pointId: Number(out.point_id),
				address: out.address,
				instructionsRun: Number(out.instructions_run),
			};
		}
		if (out.stop_reason === ffi.MCBAMGBA_STOP_WATCHPOINT) {
			return {
				stopReason: "watchpoint",
				pointId: Number(out.point_id),
				address: out.address,
				watchType: out.watch_type,
				oldValue: out.old_value,
				newValue: out.new_value,
				instructionsRun: Number(out.instructions_run),
			};
		}
		return {
			stopReason: "cap",
			pointId: null,
			address: out.address,
			instructionsRun: Number(out.instructions_run),
		};
	}

	/** Decodes `count` instructions starting at `address`, using the CPU's
	 * current execution mode (ARM or Thumb) for the whole range. */
	disassemble(address: number, count: number): DisassembledInstruction[] {
		this.ensureRomLoaded();
		if (count < 1 || count > MAX_DISASSEMBLE_COUNT) {
			throw new SessionError(
				"OPERATION_FAILED",
				`count must be between 1 and ${MAX_DISASSEMBLE_COUNT} (got ${count}).`,
			);
		}
		const buf = Buffer.alloc(count * koffi.sizeof(ffi.mcbamgba_instruction_t));
		const written = ffi.disassemble(address, count, buf);
		if (written < 0) {
			throw new SessionError("OPERATION_FAILED", `disassemble failed (shim returned ${written}).`);
		}
		const decoded = koffi.decode(buf, koffi.array(ffi.mcbamgba_instruction_t, written)) as Array<{
			address: number;
			opcode: number;
			size: number;
			text: string;
		}>;
		return decoded.map((insn) => ({
			address: insn.address,
			opcode: insn.opcode,
			size: insn.size,
			text: insn.text,
		}));
	}

	/** Holds `keys` (an OR of MCBAMGBA_KEY_* bits) down for `frameCount`
	 * whole video frames, then releases everything. */
	pressButton(keys: number, frameCount: number): void {
		this.ensureRomLoaded();
		ffi.setKeys(keys);
		try {
			for (let i = 0; i < frameCount; i++) {
				ffi.runFrame();
			}
		} finally {
			ffi.setKeys(0);
		}
	}

	/** Returns the current frame as PNG-encoded bytes. */
	screenshot(): Buffer {
		this.ensureRomLoaded();
		const raw = Buffer.alloc(ffi.MCBAMGBA_FRAMEBUFFER_BYTES);
		const rc = ffi.getFramebuffer(raw, raw.length);
		if (rc !== ffi.MCBAMGBA_OK) {
			throw new SessionError(
				"OPERATION_FAILED",
				`Failed to read the framebuffer (shim returned error code ${rc}).`,
			);
		}
		return encodeRgbaToPng(raw, ffi.MCBAMGBA_SCREEN_WIDTH, ffi.MCBAMGBA_SCREEN_HEIGHT);
	}

	/** Serializes the current emulator state into an opaque binary blob. */
	saveState(): Buffer {
		this.ensureRomLoaded();
		const size = ffi.stateSize();
		if (size <= 0) {
			throw new SessionError(
				"OPERATION_FAILED",
				`Failed to determine save-state size (shim returned ${size}).`,
			);
		}
		const out = Buffer.alloc(size);
		const rc = ffi.saveState(out, out.length);
		if (rc !== ffi.MCBAMGBA_OK) {
			throw new SessionError(
				"OPERATION_FAILED",
				`Failed to save state (shim returned error code ${rc}).`,
			);
		}
		return out;
	}

	/** Restores emulator state from a blob previously returned by
	 * `saveState()` for a core loaded from the same ROM. */
	loadState(blob: Uint8Array): void {
		this.ensureRomLoaded();
		const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
		const rc = ffi.loadState(buf, buf.length);
		if (rc !== ffi.MCBAMGBA_OK) {
			throw new SessionError(
				"OPERATION_FAILED",
				`Failed to load state (shim returned error code ${rc}). The blob may be malformed ` +
					"or from a different ROM.",
			);
		}
	}
}
