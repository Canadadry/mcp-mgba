import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Session } from "../src/session.js";
import { registerDebuggerTools } from "../src/tools/debugger.js";
import { registerExecutionTools } from "../src/tools/execution.js";
import { registerMemoryTools } from "../src/tools/memory.js";
import { registerRomTools } from "../src/tools/rom.js";
import { FIXTURE_ROM_PATH } from "./fixtures.js";

/**
 * Milestone 3 integration tests, per the PRD's Testing Decisions: drives the
 * real registered MCP debugger tools (through an in-process client<->server
 * pair, not mocked) against the real compiled native shim + libmgba, using
 * the fixture ROM's known code:
 *   0x080000C0: MOV R0, #0x03000000
 *   0x080000C4: MOV R1, #0x42
 *   0x080000C8: STR R1, [R0]      <- the known write
 *   0x080000CC: B $               <- loops forever
 */
describe("debugger tools (integration)", () => {
	let client: Client;
	let session: Session;

	beforeEach(async () => {
		const server = new McpServer({ name: "mcp-mgba-test", version: "0.0.0" });
		session = new Session();
		registerRomTools(server, session);
		registerExecutionTools(server, session);
		registerMemoryTools(server, session);
		registerDebuggerTools(server, session);

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		client = new Client({ name: "test-client", version: "0.0.0" });
		await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

		const load = await client.callTool({ name: "load_rom", arguments: { path: FIXTURE_ROM_PATH } });
		expect(load.isError).toBeFalsy();
	});

	afterEach(() => {
		session.unloadRom();
	});

	it("stops at a breakpoint on the known write instruction and reports matching PC/registers", async () => {
		const set = await client.callTool({
			name: "set_breakpoint",
			arguments: { address: 0x080000c8 },
		});
		expect(set.isError).toBeFalsy();
		const { id: breakpointId } = set.structuredContent as { id: number; address: number };

		const run = await client.callTool({ name: "run_until_breakpoint", arguments: {} });
		expect(run.isError).toBeFalsy();
		const runResult = run.structuredContent as {
			stop_reason: string;
			point_id: number | null;
			address: number;
			instructions_run: number;
			registers: Array<{ name: string; value: number }>;
		};
		expect(runResult.stop_reason).toBe("breakpoint");
		expect(runResult.point_id).toBe(breakpointId);
		expect(runResult.address).toBe(0x080000c8);
		expect(runResult.instructions_run).toBeGreaterThan(0);

		// A breakpoint fires just before its instruction executes. The "pc"
		// register reflects the CPU's pipelined fetch state at that point
		// (one instruction-width ahead of the breakpoint's own address, per
		// mGBA's ARM core - see mcbamgba_set_breakpoint's doc comment in
		// native/shim.h), and the write should not have happened yet.
		const pcRegister = runResult.registers.find((r) => r.name === "pc");
		expect(pcRegister?.value).toBe(0x080000c8 + 4);

		const beforeWrite = await client.callTool({
			name: "read_memory",
			arguments: { address: 0x03000000, length: 1 },
		});
		expect(beforeWrite.structuredContent).toMatchObject({ bytesHex: "00" });

		// Stepping once more should run the (now unblocked) write instruction.
		const step = await client.callTool({ name: "step", arguments: {} });
		expect(step.isError).toBeFalsy();
		const afterWrite = await client.callTool({
			name: "read_memory",
			arguments: { address: 0x03000000, length: 1 },
		});
		expect(afterWrite.structuredContent).toMatchObject({ bytesHex: "42" });

		const clear = await client.callTool({
			name: "clear_breakpoint",
			arguments: { id: breakpointId },
		});
		expect(clear.isError).toBeFalsy();

		const list = await client.callTool({ name: "list_breakpoints", arguments: {} });
		expect(list.structuredContent).toEqual({ breakpoints: [] });
	});

	it("stops for a watchpoint on the known write address rather than running past it", async () => {
		const set = await client.callTool({
			name: "set_watchpoint",
			arguments: { address: 0x03000000, kind: "write" },
		});
		expect(set.isError).toBeFalsy();
		const { id: watchpointId } = set.structuredContent as { id: number; address: number; kind: string };

		const run = await client.callTool({ name: "run_until_breakpoint", arguments: {} });
		expect(run.isError).toBeFalsy();
		const runResult = run.structuredContent as {
			stop_reason: string;
			point_id: number | null;
			address: number;
			new_value: number;
		};
		expect(runResult.stop_reason).toBe("watchpoint");
		expect(runResult.point_id).toBe(watchpointId);
		expect(runResult.address).toBe(0x03000000);
		expect(runResult.new_value).toBe(0x42);

		// The write itself happened (unlike a breakpoint, a watchpoint fires
		// as part of the access that triggers it) - execution stopped
		// immediately after, not several instructions later in the fixture's
		// infinite loop.
		const afterWrite = await client.callTool({
			name: "read_memory",
			arguments: { address: 0x03000000, length: 1 },
		});
		expect(afterWrite.structuredContent).toMatchObject({ bytesHex: "42" });

		const clear = await client.callTool({
			name: "clear_watchpoint",
			arguments: { id: watchpointId },
		});
		expect(clear.isError).toBeFalsy();
	});

	it("distinguishes a safety-cap timeout from a real breakpoint hit", async () => {
		const set = await client.callTool({
			name: "set_breakpoint",
			// An address the fixture's 4-instruction program + infinite loop
			// never reaches.
			arguments: { address: 0x08000200 },
		});
		expect(set.isError).toBeFalsy();

		const run = await client.callTool({
			name: "run_until_breakpoint",
			arguments: { max_instructions: 25 },
		});
		expect(run.isError).toBeFalsy();
		const runResult = run.structuredContent as {
			stop_reason: string;
			point_id: number | null;
			instructions_run: number;
		};
		expect(runResult.stop_reason).toBe("cap");
		expect(runResult.point_id).toBeNull();
		expect(runResult.instructions_run).toBe(25);
	});

	it("reads and writes CPU registers", async () => {
		const before = await client.callTool({ name: "get_registers", arguments: {} });
		expect(before.isError).toBeFalsy();
		const { registers } = before.structuredContent as {
			registers: Array<{ name: string; value: number }>;
		};
		expect(registers.some((r) => r.name === "pc")).toBe(true);

		const setReg = await client.callTool({
			name: "set_register",
			arguments: { name: "r5", value: 0x12345678 },
		});
		expect(setReg.isError).toBeFalsy();

		const after = await client.callTool({ name: "get_registers", arguments: {} });
		const { registers: registersAfter } = after.structuredContent as {
			registers: Array<{ name: string; value: number }>;
		};
		expect(registersAfter.find((r) => r.name === "r5")?.value).toBe(0x12345678);
	});

	it("disassembles the fixture's known instructions into matching mnemonics", async () => {
		const result = await client.callTool({
			name: "disassemble",
			arguments: { address: 0x080000c0, count: 4 },
		});
		expect(result.isError).toBeFalsy();
		const { instructions } = result.structuredContent as {
			instructions: Array<{ address: number; opcode: number; size: number; text: string }>;
		};
		expect(instructions).toHaveLength(4);
		expect(instructions.map((i) => i.address)).toEqual([
			0x080000c0, 0x080000c4, 0x080000c8, 0x080000cc,
		]);
		expect(instructions.every((i) => i.size === 4)).toBe(true);

		// Ties disassembly correctness back to the fixture's known assembly
		// source (see native/test/smoke_test.c's header comment), not just
		// an opaque binary.
		expect(instructions[0]!.text).toMatch(/mov\s+r0,\s*#/i);
		expect(instructions[1]!.text).toMatch(/mov\s+r1,\s*#66/i);
		expect(instructions[2]!.text).toMatch(/str\s+r1,\s*\[r0/i);
		expect(instructions[3]!.text).toMatch(/^b\s/i);
	});
});
