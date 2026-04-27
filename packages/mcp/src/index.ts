/**
 * @altheia/mcp — standalone MCP server.
 *
 * Exposes Altheia tools + resources to any MCP-aware client (Claude Desktop,
 * Cursor, ChatGPT). The LLM operates against your agent fleet through these
 * tools; every action goes through Altheia policy + audit.
 *
 * Tools:
 *   altheia_check       — pre-flight policy check
 *   altheia_guard       — wrap a tool call with policy
 *   altheia_report      — log an action to the audit trail
 *   altheia_policy      — inspect the current policy in scope
 *   altheia_audit_query — query recent audit events for the agent
 *
 * Resources:
 *   altheia://agent/<id>/policy
 *   altheia://agent/<id>/audit?limit=20
 *   altheia://agent/<id>
 */

import { Altheia } from "@altheia/sdk";

export interface AltheiaMcpConfig {
  apiKey: string;
  agentId: string;
  endpoint?: string;
}

export function createAltheiaMcpServer(config: AltheiaMcpConfig) {
  const _altheia = new Altheia(config);

  // TODO: instantiate @modelcontextprotocol/sdk Server
  // TODO: register tools (altheia_check, altheia_guard, altheia_report, altheia_policy, altheia_audit_query)
  // TODO: register resources (altheia://agent/<id>/policy, audit, metadata)
  // TODO: stdio + http transport

  return {
    start: async () => {
      throw new Error("not implemented");
    },
  };
}
