import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as ffi from "../ffi.js";
import type { Session } from "../session.js";
import { textResult, toolError } from "./util.js";

/** GBA's 10 physical buttons, mapped to the shim's MCBAMGBA_KEY_* bits. */
const BUTTON_BITS: Record<string, number> = {
	A: ffi.MCBAMGBA_KEY_A,
	B: ffi.MCBAMGBA_KEY_B,
	SELECT: ffi.MCBAMGBA_KEY_SELECT,
	START: ffi.MCBAMGBA_KEY_START,
	RIGHT: ffi.MCBAMGBA_KEY_RIGHT,
	LEFT: ffi.MCBAMGBA_KEY_LEFT,
	UP: ffi.MCBAMGBA_KEY_UP,
	DOWN: ffi.MCBAMGBA_KEY_DOWN,
	R: ffi.MCBAMGBA_KEY_R,
	L: ffi.MCBAMGBA_KEY_L,
};
const BUTTON_NAMES = Object.keys(BUTTON_BITS) as [string, ...string[]];

export function registerInputTools(server: McpServer, session: Session): void {
	server.registerTool(
		"press_button",
		{
			title: "Press button",
			description:
				"Holds one or more GBA buttons down for `frames` whole video frames, then releases " +
				"them, so you can simulate player input and observe how the game reacts.",
			inputSchema: {
				buttons: z
					.array(z.enum(BUTTON_NAMES))
					.min(1)
					.describe("Buttons to hold simultaneously (e.g. [\"A\"], [\"UP\", \"A\"])."),
				frames: z
					.number()
					.int()
					.min(1)
					.describe("Number of whole video frames to hold the buttons down for."),
			},
		},
		({ buttons, frames }) => {
			try {
				const mask = buttons.reduce((acc, name) => acc | BUTTON_BITS[name]!, 0);
				session.pressButton(mask, frames);
				return textResult(`Held [${buttons.join(", ")}] for ${frames} frame(s).`);
			} catch (err) {
				return toolError(err);
			}
		},
	);
}
