#!/usr/bin/env node
/**
 * mcp-mgba MCP server entrypoint: a headless GBA debugger exposed over the
 * stdio transport. Synchronous, single-session, pull-based end-to-end - see
 * docs/prd/triage/02-core-mcp-tools.md.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Session } from "./session.js";
import { registerRomTools } from "./tools/rom.js";
import { registerExecutionTools } from "./tools/execution.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerInputTools } from "./tools/input.js";
import { registerScreenshotTools } from "./tools/screenshot.js";
import { registerStateTools } from "./tools/state.js";
import { registerDebuggerTools } from "./tools/debugger.js";

const server = new McpServer({
	name: "mcp-mgba",
	version: "0.1.0",
});

const session = new Session();

registerRomTools(server, session);
registerExecutionTools(server, session);
registerMemoryTools(server, session);
registerInputTools(server, session);
registerScreenshotTools(server, session);
registerStateTools(server, session);
registerDebuggerTools(server, session);

const transport = new StdioServerTransport();
await server.connect(transport);
