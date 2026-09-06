import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Session } from "../src/session.js";
import { registerExecutionTools } from "../src/tools/execution.js";
import { registerInputTools } from "../src/tools/input.js";
import { registerMemoryTools } from "../src/tools/memory.js";
import { registerRomTools } from "../src/tools/rom.js";
import { registerScreenshotTools } from "../src/tools/screenshot.js";
import { registerStateTools } from "../src/tools/state.js";
import { FIXTURE_ROM_PATH } from "./fixtures.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * End-to-end integration test per the PRD's Testing Decisions: drives the
 * real MCP tool surface (through an in-process client<->server pair, not
 * mocked) against the real compiled native shim + libmgba, loading the
 * Milestone 4 placeholder fixture ROM.
 */
describe("MCP tool surface (integration)", () => {
	let client: Client;
	let session: Session;

	beforeEach(async () => {
		const server = new McpServer({ name: "mcp-mgba-test", version: "0.0.0" });
		session = new Session();
		registerRomTools(server, session);
		registerExecutionTools(server, session);
		registerMemoryTools(server, session);
		registerInputTools(server, session);
		registerScreenshotTools(server, session);
		registerStateTools(server, session);

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		client = new Client({ name: "test-client", version: "0.0.0" });
		await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
	});

	afterEach(() => {
		session.unloadRom();
	});

	it("rejects a tool call before any ROM is loaded with a structured NO_ROM_LOADED error", async () => {
		const result = await client.callTool({ name: "step", arguments: {} });
		expect(result.isError).toBe(true);
		const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text;
		expect(text).toContain("NO_ROM_LOADED");
	});

	it("loads the fixture ROM, steps, reads memory, runs frames, screenshots, and round-trips a save state", async () => {
		const load = await client.callTool({
			name: "load_rom",
			arguments: { path: FIXTURE_ROM_PATH },
		});
		expect(load.isError).toBeFalsy();

		// Step past the fixture's four instructions (branch over header +
		// MOV/MOV/STR) so its known write has happened.
		for (let i = 0; i < 4; i++) {
			const stepResult = await client.callTool({ name: "step", arguments: {} });
			expect(stepResult.isError).toBeFalsy();
		}

		const afterStep = await client.callTool({
			name: "read_memory",
			arguments: { address: 0x03000000, length: 1 },
		});
		expect(afterStep.isError).toBeFalsy();
		expect(afterStep.structuredContent).toEqual({
			address: 0x03000000,
			length: 1,
			bytesHex: "42",
		});

		// run_frames(n): the fixture loops forever, so this just proves
		// multi-frame stepping works without disturbing the known value.
		const runFrames = await client.callTool({
			name: "run_frames",
			arguments: { count: 3 },
		});
		expect(runFrames.isError).toBeFalsy();

		const afterFrames = await client.callTool({
			name: "read_memory",
			arguments: { address: 0x03000000, length: 1 },
		});
		expect(afterFrames.structuredContent).toMatchObject({ bytesHex: "42" });

		// press_button: the fixture never reads input, so this is a
		// not-crash + reacts-as-designed check per the PRD user story.
		const press = await client.callTool({
			name: "press_button",
			arguments: { buttons: ["A", "UP"], frames: 2 },
		});
		expect(press.isError).toBeFalsy();

		// screenshot: PNG bytes for the current (240x160) frame.
		const shot = await client.callTool({ name: "screenshot", arguments: {} });
		expect(shot.isError).toBeFalsy();
		const image = (shot.content as Array<{ type: string; data?: string; mimeType?: string }>)[0]!;
		expect(image.type).toBe("image");
		expect(image.mimeType).toBe("image/png");
		const pngBytes = Buffer.from(image.data!, "base64");
		expect(pngBytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

		// Save state round-trip: save, mutate further, load, confirm memory
		// matches the saved point (not the mutation).
		const saved = await client.callTool({ name: "save_state", arguments: {} });
		expect(saved.isError).toBeFalsy();
		const { dataBase64 } = saved.structuredContent as { dataBase64: string; sizeBytes: number };
		expect(typeof dataBase64).toBe("string");
		expect(dataBase64.length).toBeGreaterThan(0);

		const mutate = await client.callTool({
			name: "write_memory",
			arguments: { address: 0x03000000, bytesHex: "99" },
		});
		expect(mutate.isError).toBeFalsy();

		const afterMutate = await client.callTool({
			name: "read_memory",
			arguments: { address: 0x03000000, length: 1 },
		});
		expect(afterMutate.structuredContent).toMatchObject({ bytesHex: "99" });

		const loaded = await client.callTool({
			name: "load_state",
			arguments: { dataBase64 },
		});
		expect(loaded.isError).toBeFalsy();

		const afterLoad = await client.callTool({
			name: "read_memory",
			arguments: { address: 0x03000000, length: 1 },
		});
		expect(afterLoad.structuredContent).toMatchObject({ bytesHex: "42" });
	});
});
