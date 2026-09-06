import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as ffi from "../ffi.js";
import { MAX_DISASSEMBLE_COUNT, type Session } from "../session.js";
import { textResult, toolError } from "./util.js";

const WATCHPOINT_KINDS = ["write", "read", "rw", "change", "write_change"] as const;
type WatchpointKind = (typeof WATCHPOINT_KINDS)[number];

const WATCHPOINT_KIND_TO_TYPE: Record<WatchpointKind, number> = {
	write: ffi.MCBAMGBA_WATCHPOINT_WRITE,
	read: ffi.MCBAMGBA_WATCHPOINT_READ,
	rw: ffi.MCBAMGBA_WATCHPOINT_RW,
	change: ffi.MCBAMGBA_WATCHPOINT_CHANGE,
	write_change: ffi.MCBAMGBA_WATCHPOINT_WRITE_CHANGE,
};

const WATCHPOINT_TYPE_TO_KIND: Record<number, WatchpointKind> = {
	[ffi.MCBAMGBA_WATCHPOINT_WRITE]: "write",
	[ffi.MCBAMGBA_WATCHPOINT_READ]: "read",
	[ffi.MCBAMGBA_WATCHPOINT_RW]: "rw",
	[ffi.MCBAMGBA_WATCHPOINT_CHANGE]: "change",
	[ffi.MCBAMGBA_WATCHPOINT_WRITE_CHANGE]: "write_change",
};

const addressSchema = z
	.number()
	.int()
	.min(0)
	.max(0xffffffff)
	.describe("GBA bus address, e.g. 0x08000000 for the start of ROM.");

export function registerDebuggerTools(server: McpServer, session: Session): void {
	server.registerTool(
		"set_breakpoint",
		{
			title: "Set breakpoint",
			description:
				"Sets a hardware breakpoint at `address`. It fires just before the instruction at " +
				"that address executes (checked by run_until_breakpoint), so when it fires that " +
				"instruction's effects haven't happened yet.",
			inputSchema: { address: addressSchema },
			outputSchema: { id: z.number(), address: z.number() },
		},
		({ address }) => {
			try {
				const id = session.setBreakpoint(address);
				return {
					content: [
						{ type: "text", text: `Breakpoint ${id} set at 0x${address.toString(16)}.` },
					],
					structuredContent: { id, address },
				};
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"clear_breakpoint",
		{
			title: "Clear breakpoint",
			description: "Removes the breakpoint with the given id.",
			inputSchema: { id: z.number().int().describe("The breakpoint id returned by set_breakpoint.") },
		},
		({ id }) => {
			try {
				session.clearBreakpoint(id);
				return textResult(`Breakpoint ${id} cleared.`);
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"list_breakpoints",
		{
			title: "List breakpoints",
			description: "Lists every breakpoint currently set.",
			outputSchema: {
				breakpoints: z.array(z.object({ id: z.number(), address: z.number() })),
			},
		},
		() => {
			try {
				const breakpoints = session.listBreakpoints();
				return {
					content: [
						{
							type: "text",
							text:
								breakpoints.length === 0
									? "No breakpoints set."
									: breakpoints
											.map((bp) => `#${bp.id} @ 0x${bp.address.toString(16)}`)
											.join(", "),
						},
					],
					structuredContent: { breakpoints },
				};
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"set_watchpoint",
		{
			title: "Set watchpoint",
			description:
				"Sets a watchpoint at `address` that fires on the given kind of memory access: " +
				"'write' (default), 'read', 'rw' (either), 'change' (value differs from before), or " +
				"'write_change' (a write that changes the value).",
			inputSchema: {
				address: addressSchema,
				kind: z.enum(WATCHPOINT_KINDS).default("write").describe("Which access(es) to watch for."),
			},
			outputSchema: { id: z.number(), address: z.number(), kind: z.enum(WATCHPOINT_KINDS) },
		},
		({ address, kind }) => {
			try {
				const id = session.setWatchpoint(address, WATCHPOINT_KIND_TO_TYPE[kind]);
				return {
					content: [
						{
							type: "text",
							text: `Watchpoint ${id} set at 0x${address.toString(16)} (${kind}).`,
						},
					],
					structuredContent: { id, address, kind },
				};
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"clear_watchpoint",
		{
			title: "Clear watchpoint",
			description: "Removes the watchpoint with the given id.",
			inputSchema: { id: z.number().int().describe("The watchpoint id returned by set_watchpoint.") },
		},
		({ id }) => {
			try {
				session.clearWatchpoint(id);
				return textResult(`Watchpoint ${id} cleared.`);
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"list_watchpoints",
		{
			title: "List watchpoints",
			description: "Lists every watchpoint currently set.",
			outputSchema: {
				watchpoints: z.array(
					z.object({ id: z.number(), address: z.number(), kind: z.enum(WATCHPOINT_KINDS) }),
				),
			},
		},
		() => {
			try {
				const watchpoints = session.listWatchpoints().map((wp) => ({
					id: wp.id,
					address: wp.address,
					kind: WATCHPOINT_TYPE_TO_KIND[wp.type] ?? "write",
				}));
				return {
					content: [
						{
							type: "text",
							text:
								watchpoints.length === 0
									? "No watchpoints set."
									: watchpoints
											.map((wp) => `#${wp.id} @ 0x${wp.address.toString(16)} (${wp.kind})`)
											.join(", "),
						},
					],
					structuredContent: { watchpoints },
				};
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"get_registers",
		{
			title: "Get registers",
			description: "Reads the full CPU register set (r0-r15, cpsr, ...) at the current point in execution.",
			outputSchema: {
				registers: z.array(z.object({ name: z.string(), value: z.number() })),
			},
		},
		() => {
			try {
				const registers = session.getRegisters();
				return {
					content: [
						{
							type: "text",
							text: registers
								.map((r) => `${r.name}=0x${r.value.toString(16)}`)
								.join(" "),
						},
					],
					structuredContent: { registers },
				};
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"set_register",
		{
			title: "Set register",
			description:
				"Writes a single register by name (e.g. 'r0', 'pc', 'sp', 'lr', 'cpsr'), to mutate " +
				"CPU state and test a hypothesis about program behavior.",
			inputSchema: {
				name: z.string().describe("Register name, e.g. 'r0', 'pc', 'sp', 'lr', 'cpsr'."),
				value: z.number().int().min(0).max(0xffffffff).describe("New 32-bit register value."),
			},
		},
		({ name, value }) => {
			try {
				session.setRegister(name, value);
				return textResult(`${name} set to 0x${value.toString(16)}.`);
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"run_until_breakpoint",
		{
			title: "Run until breakpoint",
			description:
				"Runs forward (single-stepping internally, one blocking call, no polling) until a " +
				"breakpoint or watchpoint fires, or until `max_instructions` instructions have run " +
				"without one firing (a safety cap so a condition that never triggers can't hang this " +
				"call). The response's `stop_reason` distinguishes a real hit ('breakpoint' / " +
				"'watchpoint') from a timeout ('cap') - always check it rather than assuming a hit.",
			inputSchema: {
				max_instructions: z
					.number()
					.int()
					.min(1)
					.optional()
					.describe(
						`Safety cap on instructions to execute before giving up (default ${ffi.MCBAMGBA_DEFAULT_MAX_INSTRUCTIONS}).`,
					),
			},
			outputSchema: {
				stop_reason: z.enum(["breakpoint", "watchpoint", "cap"]),
				point_id: z.number().nullable(),
				address: z.number(),
				watch_type: z.number().optional(),
				old_value: z.number().optional(),
				new_value: z.number().optional(),
				instructions_run: z.number(),
				registers: z.array(z.object({ name: z.string(), value: z.number() })),
			},
		},
		({ max_instructions }) => {
			try {
				const result = session.runUntilBreakpoint(max_instructions);
				const registers = session.getRegisters();
				const structuredContent = {
					stop_reason: result.stopReason,
					point_id: result.pointId,
					address: result.address,
					watch_type: result.watchType,
					old_value: result.oldValue,
					new_value: result.newValue,
					instructions_run: result.instructionsRun,
					registers,
				};
				const summary =
					result.stopReason === "cap"
						? `Hit the ${result.instructionsRun}-instruction safety cap with no breakpoint/watchpoint firing (not a real stop) - PC is at 0x${result.address.toString(16)}.`
						: `Stopped for ${result.stopReason} #${result.pointId} at 0x${result.address.toString(16)} after ${result.instructionsRun} instruction(s).`;
				return {
					content: [{ type: "text", text: summary }],
					structuredContent,
				};
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"disassemble",
		{
			title: "Disassemble",
			description:
				"Decodes `count` instructions starting at `address` into ARM/THUMB mnemonics, using " +
				"the CPU's current execution mode (ARM or Thumb) for the whole range - no ELF/symbol " +
				"table is loaded, so branch/load targets are raw addresses, not symbol names.",
			inputSchema: {
				address: addressSchema,
				count: z
					.number()
					.int()
					.min(1)
					.max(MAX_DISASSEMBLE_COUNT)
					.describe(`Number of instructions to decode (max ${MAX_DISASSEMBLE_COUNT}).`),
			},
			outputSchema: {
				instructions: z.array(
					z.object({
						address: z.number(),
						opcode: z.number(),
						size: z.number(),
						text: z.string(),
					}),
				),
			},
		},
		({ address, count }) => {
			try {
				const instructions = session.disassemble(address, count);
				const text = instructions
					.map((insn) => `0x${insn.address.toString(16)}: ${insn.text}`)
					.join("\n");
				return {
					content: [{ type: "text", text }],
					structuredContent: { instructions },
				};
			} catch (err) {
				return toolError(err);
			}
		},
	);
}
