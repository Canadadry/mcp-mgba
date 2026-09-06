import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Session } from "../session.js";
import { toolError } from "./util.js";

export function registerStateTools(server: McpServer, session: Session): void {
	server.registerTool(
		"save_state",
		{
			title: "Save state",
			description:
				"Snapshots the current point in execution as an opaque, base64-encoded binary blob, " +
				"so you can return to it later with load_state without replaying input. The server " +
				"never interprets the blob's contents.",
			outputSchema: {
				sizeBytes: z.number(),
				dataBase64: z.string(),
			},
		},
		() => {
			try {
				const blob = session.saveState();
				const dataBase64 = blob.toString("base64");
				return {
					content: [{ type: "text", text: dataBase64 }],
					structuredContent: { sizeBytes: blob.length, dataBase64 },
				};
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"load_state",
		{
			title: "Load state",
			description:
				"Restores emulator state from a base64-encoded blob previously returned by " +
				"save_state for a core loaded from the same ROM.",
			inputSchema: {
				dataBase64: z.string().describe("The base64-encoded blob returned by save_state."),
			},
		},
		({ dataBase64 }) => {
			try {
				const blob = Buffer.from(dataBase64, "base64");
				session.loadState(blob);
				return { content: [{ type: "text" as const, text: "State loaded." }] };
			} catch (err) {
				return toolError(err);
			}
		},
	);
}
