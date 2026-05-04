#!/usr/bin/env node
/**
 * altheia-mcp — entry point for `npx @altheia/mcp` and the MCP client config.
 *
 * Reads ALTHEIA_AGENT_ID (required), ALTHEIA_API_KEY (optional, for auth),
 * ALTHEIA_BACKEND (optional, defaults to https://api.altheia.xyz). Starts an
 * MCP server over stdio.
 *
 * Sample MCP client config (Claude Desktop / Cursor):
 *
 *   {
 *     "mcpServers": {
 *       "altheia": {
 *         "command": "npx",
 *         "args": ["-y", "@altheia/mcp"],
 *         "env": {
 *           "ALTHEIA_AGENT_ID": "<uuid from dashboard>",
 *           "ALTHEIA_BACKEND": "http://localhost:3001"
 *         }
 *       }
 *     }
 *   }
 */

import { createAltheiaMcpServer } from "./index.js";

const agentId = process.env.ALTHEIA_AGENT_ID;
const apiKey = process.env.ALTHEIA_API_KEY;
const endpoint = process.env.ALTHEIA_BACKEND;

if (!agentId) {
  console.error("[altheia-mcp] ALTHEIA_AGENT_ID env var is required.");
  console.error("[altheia-mcp] Register an agent in the dashboard, then set:");
  console.error("[altheia-mcp]   ALTHEIA_AGENT_ID=<uuid>");
  console.error("[altheia-mcp]   ALTHEIA_BACKEND=http://localhost:3001  # or your prod URL");
  process.exit(1);
}

const { start } = createAltheiaMcpServer({
  agentId,
  ...(apiKey ? { apiKey } : {}),
  ...(endpoint ? { endpoint } : {}),
});

start().catch((err) => {
  console.error("[altheia-mcp] fatal:", err);
  process.exit(1);
});
