import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Session } from "../session.js";
import { toolError } from "./util.js";

export function registerScreenshotTools(server: McpServer, session: Session): void {
	server.registerTool(
		"screenshot",
		{
			title: "Screenshot",
			description: "Captures the current frame (240x160) as a PNG image.",
		},
		() => {
			try {
				const png = session.screenshot();
				return {
					content: [
						{
							type: "image",
							data: png.toString("base64"),
							mimeType: "image/png",
						},
					],
				};
			} catch (err) {
				return toolError(err);
			}
		},
	);
}
