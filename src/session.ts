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
import * as ffi from "./ffi.js";
import { encodeRgbaToPng } from "./png.js";

export type SessionErrorCode = "NO_ROM_LOADED" | "LOAD_FAILED" | "OPERATION_FAILED";

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
