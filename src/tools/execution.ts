import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Session } from "../session.js";
import { textResult, toolError } from "./util.js";

export function registerExecutionTools(server: McpServer, session: Session): void {
	server.registerTool(
		"reset",
		{
			title: "Reset",
			description: "Resets the currently loaded ROM back to its entry point.",
		},
		() => {
			try {
				session.reset();
				return textResult("Reset to entry point.");
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"step",
		{
			title: "Step instruction",
			description: "Executes a single CPU instruction and returns.",
		},
		() => {
			try {
				session.step();
				return textResult("Stepped one instruction.");
			} catch (err) {
				return toolError(err);
			}
		},
	);

	server.registerTool(
		"run_frames",
		{
			title: "Run frames",
			description:
				"Advances execution by whole video frames (240x160 GBA frames, ~60/second), for " +
				"when single-instruction stepping is too slow.",
			inputSchema: {
				count: z
					.number()
					.int()
					.min(1)
					.describe("Number of whole video frames to run forward."),
			},
		},
		({ count }) => {
			try {
				session.runFrames(count);
				return textResult(`Ran ${count} frame(s).`);
			} catch (err) {
				return toolError(err);
			}
		},
	);
}
