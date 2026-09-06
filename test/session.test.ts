import { afterEach, describe, expect, it } from "vitest";
import { Session, SessionError } from "../src/session.js";
import { FIXTURE_ROM_PATH } from "./fixtures.js";

describe("Session", () => {
	const session = new Session();

	afterEach(() => {
		session.unloadRom();
	});

	describe("no ROM loaded", () => {
		it("rejects reset() with a structured NO_ROM_LOADED error", () => {
			expect(() => session.reset()).toThrow(SessionError);
			try {
				session.reset();
				expect.unreachable();
			} catch (err) {
				expect(err).toBeInstanceOf(SessionError);
				expect((err as SessionError).code).toBe("NO_ROM_LOADED");
			}
		});

		it("rejects step(), readMemory(), writeMemory(), pressButton(), screenshot(), saveState(), loadState(), and every debugger tool the same way", () => {
			const calls: Array<[string, () => unknown]> = [
				["step", () => session.step()],
				["runFrames", () => session.runFrames(1)],
				["readMemory", () => session.readMemory(0, 1)],
				["writeMemory", () => session.writeMemory(0, Buffer.from([1]))],
				["pressButton", () => session.pressButton(1, 1)],
				["screenshot", () => session.screenshot()],
				["saveState", () => session.saveState()],
				["loadState", () => session.loadState(Buffer.from([1]))],
				["setBreakpoint", () => session.setBreakpoint(0)],
				["clearBreakpoint", () => session.clearBreakpoint(1)],
				["listBreakpoints", () => session.listBreakpoints()],
				["setWatchpoint", () => session.setWatchpoint(0, 1)],
				["clearWatchpoint", () => session.clearWatchpoint(1)],
				["listWatchpoints", () => session.listWatchpoints()],
				["getRegisters", () => session.getRegisters()],
				["setRegister", () => session.setRegister("r0", 0)],
				["runUntilBreakpoint", () => session.runUntilBreakpoint()],
				["disassemble", () => session.disassemble(0, 1)],
			];
			for (const [name, call] of calls) {
				expect(call, name).toThrow(SessionError);
			}
		});
	});

	describe("once a ROM is loaded", () => {
		it("no longer throws NO_ROM_LOADED", () => {
			session.loadRom(FIXTURE_ROM_PATH);
			expect(() => session.step()).not.toThrow();
		});
	});
});
