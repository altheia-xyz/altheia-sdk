#!/usr/bin/env node
/**
 * altheia-mcp — entry point for `npx @altheia/mcp` and the MCP client config.
 *
 * Reads ALTHEIA_API_KEY and ALTHEIA_AGENT_ID from env, starts an MCP
 * server over stdio.
 */

import { createAltheiaMcpServer } from "./index.js";

const apiKey = process.env.ALTHEIA_API_KEY;
const agentId = process.env.ALTHEIA_AGENT_ID;

if (!apiKey || !agentId) {
  console.error("ALTHEIA_API_KEY and ALTHEIA_AGENT_ID must be set");
  process.exit(1);
}

const server = createAltheiaMcpServer({ apiKey, agentId });

server.start().catch((err) => {
  console.error(err);
  process.exit(1);
});
