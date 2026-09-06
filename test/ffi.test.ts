import { describe, expect, it } from "vitest";
import * as ffi from "../src/ffi.js";
import { FIXTURE_ROM_PATH } from "./fixtures.js";

// Tracer bullet: proves the koffi bindings in src/ffi.ts actually marshal
// correctly against the real compiled native shim (no mocking) before any
// higher-level session/tool code is layered on top.
describe("ffi", () => {
	it("loads the fixture ROM and steps through its known IWRAM write", () => {
		expect(ffi.isRomLoaded()).toBe(0);

		const rc = ffi.loadRom(FIXTURE_ROM_PATH);
		expect(rc).toBe(ffi.MCBAMGBA_OK);
		expect(ffi.isRomLoaded()).toBe(1);

		for (let i = 0; i < 4; i++) {
			expect(ffi.step()).toBe(ffi.MCBAMGBA_OK);
		}

		expect(ffi.busRead8(0x03000000)).toBe(0x42);

		ffi.unloadRom();
		expect(ffi.isRomLoaded()).toBe(0);
	});
});
