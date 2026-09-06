import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		// Single-session native shim under the hood (one global loaded core,
		// see native/shim.c) - tests that load a ROM must not run concurrently
		// against each other.
		fileParallelism: false,
	},
});
