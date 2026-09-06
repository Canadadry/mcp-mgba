import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Session } from "../session.js";
import { textResult, toolError } from "./util.js";

export function registerRomTools(server: McpServer, session: Session): void {
	server.registerTool(
		"load_rom",
		{
			title: "Load ROM",
			description:
				"Loads a GBA ROM file from an absolute path on disk, replacing any ROM already " +
				"loaded, and starts a new debugging session against it (reset to its entry point). " +
				"Every other tool requires a ROM to be loaded first.",
			inputSchema: {
				path: z.string().describe("Absolute path to the .gba ROM file to load."),
			},
		},
		({ path }) => {
			try {
				session.loadRom(path);
				return textResult(`Loaded ROM at '${path}'.`);
			} catch (err) {
				return toolError(err);
			}
		},
	);
}
