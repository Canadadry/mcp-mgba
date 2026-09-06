/** Shared helpers for tool handlers - not a tool itself. Tool handlers stay
 * thin (parse MCP input -> call session -> format MCP output) per the
 * PRD's testing decisions; this is where that formatting boilerplate
 * lives so it isn't repeated in every tools/*.ts file. */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SessionError } from "../session.js";

/** Converts a thrown error (typically a SessionError, e.g. "no ROM
 * loaded") into an MCP tool error result, so every tool handler can just
 * `catch (err) { return toolError(err); }` without repeating this logic. */
export function toolError(err: unknown): CallToolResult {
	if (err instanceof SessionError) {
		return {
			content: [{ type: "text", text: `[${err.code}] ${err.message}` }],
			isError: true,
		};
	}
	const message = err instanceof Error ? err.message : String(err);
	return { content: [{ type: "text", text: message }], isError: true };
}

export function textResult(text: string): CallToolResult {
	return { content: [{ type: "text", text }] };
}

export function hexEncode(buf: Uint8Array): string {
	return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString("hex");
}

export function hexDecode(hex: string): Buffer {
	const normalized = hex.trim().replace(/^0x/i, "");
	if (!/^[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0) {
		throw new Error(`Invalid hex byte string: '${hex}'`);
	}
	return Buffer.from(normalized, "hex");
}
