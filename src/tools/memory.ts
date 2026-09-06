import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Session } from "../session.js";
import { hexDecode, hexEncode, textResult, toolError } from "./util.js";

const MAX_READ_LENGTH = 0x10000; // 64 KiB - generous for a debugging tool, cheap to enforce

export function registerMemoryTools(server: McpServer, session: Session): void {
	server.registerTool(
		"read_memory",
		{
			title: "Read memory",
			description:
				"Reads `length` bytes of GBA-mapped memory (IWRAM/EWRAM/ROM/palette/OAM/etc.) " +
				"starting at `address`, returned as a hex string (2 characters per byte, no " +
				"separators).",
			inputSchema: {
				address: z
					.number()
					.int()
					.min(0)
					.max(0xffffffff)
					.describe("GBA bus address to start reading from, e.g. 0x03000000 for IWRAM."),
				length: z
					.number()
					.int()
					.min(1)
					.max(MAX_READ_LENGTH)
					.describe(`Number of bytes to read (max ${MAX_READ_LENGTH}).`),
			},
			outputSchema: {
				address: z.number(),
				length: z.number(),
				bytesHex: z.string(),
			},
		},
		({ address, length }) => {
			try {
				const bytes = session.readMemory(address, length);
				const bytesHex = hexEncode(bytes);
				return {
					content: [
						{
							type: "text",
							text: `Read ${length} byte(s) at 0x${address.toString(16)}: ${bytesHex}`,
						},
					],
					structuredContent: { address, length, bytesHex },
				};
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"write_memory",
		{
			title: "Write memory",
			description:
				"Writes bytes into GBA-mapped memory starting at `address`, to patch state or test " +
				"hypotheses (e.g. force a flag, unlock a state).",
			inputSchema: {
				address: z
					.number()
					.int()
					.min(0)
					.max(0xffffffff)
					.describe("GBA bus address to start writing at."),
				bytesHex: z
					.string()
					.max(MAX_READ_LENGTH * 2)
					.describe("Bytes to write, as a hex string (2 characters per byte, no separators)."),
			},
		},
		({ address, bytesHex }) => {
			try {
				const bytes = hexDecode(bytesHex);
				session.writeMemory(address, bytes);
				return textResult(`Wrote ${bytes.length} byte(s) at 0x${address.toString(16)}.`);
			} catch (err) {
				return toolError(err);
			}
		},
	);
}
