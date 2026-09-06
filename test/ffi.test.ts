import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as ffi from "../src/ffi.js";
import { FIXTURE_ROM_PATH } from "./fixtures.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Matches src/ffi.ts's resolveShimPath() platform-directory naming.
const platformDir = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch}`;
const shimFilename = `libmcbamgba_shim.${process.platform === "darwin" ? "dylib" : "so"}`;
const localBuildPath = path.join(projectRoot, "native", "build", platformDir, shimFilename);
const prebuiltDir = path.join(projectRoot, "prebuilt", platformDir);
const prebuiltPath = path.join(prebuiltDir, shimFilename);

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

// Milestone 5: resolveShimPath() must prefer, in order, (1) an explicit
// MCBAMGBA_SHIM_PATH override, (2) a prebuilt/<platform>/ shim (populated
// only in a published npm tarball), (3) a native/build/<platform>/ shim
// (this repo's own local build, which is what keeps this test suite green
// without prebuilt/ ever being populated in the git checkout).
describe("resolveShimPath", () => {
	afterEach(() => {
		delete process.env.MCBAMGBA_SHIM_PATH;
		rmSync(path.join(projectRoot, "prebuilt"), { recursive: true, force: true });
	});

	it("returns the MCBAMGBA_SHIM_PATH override without checking existence", () => {
		const fakePath = path.join(mkdtempSync(path.join(tmpdir(), "mcbamgba-")), "does-not-exist.so");
		process.env.MCBAMGBA_SHIM_PATH = fakePath;
		expect(ffi.resolveShimPath()).toBe(fakePath);
	});

	it("falls back to native/build/<platform>/ when prebuilt/ is absent", () => {
		expect(ffi.resolveShimPath()).toBe(localBuildPath);
	});

	it("prefers prebuilt/<platform>/ over native/build/<platform>/ when both exist", () => {
		mkdirSync(prebuiltDir, { recursive: true });
		writeFileSync(prebuiltPath, "not a real shared library, just needs to exist");

		expect(ffi.resolveShimPath()).toBe(prebuiltPath);
	});

	it("throws a clear error naming both candidate paths when neither exists", () => {
		const hiddenBuildPath = `${localBuildPath}.hidden-for-test`;
		rmSync(hiddenBuildPath, { force: true });
		renameSync(localBuildPath, hiddenBuildPath);
		try {
			expect(() => ffi.resolveShimPath()).toThrow(/native shim not found/);
		} finally {
			renameSync(hiddenBuildPath, localBuildPath);
		}
	});
});
