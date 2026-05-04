/**
 * @altheia/mcp — standalone MCP server.
 *
 * Exposes Altheia tools + resources to any MCP-aware client (Claude Desktop,
 * Cursor, ChatGPT). The LLM operates against your agent fleet through these
 * tools; every action goes through Altheia policy + audit.
 *
 * Tools:
 *   altheia_check       — pre-flight policy check (no execution)
 *   altheia_guard       — pre-flight + audit hint; returns the Decision so the
 *                         calling client can short-circuit on deny
 *   altheia_report      — log an action outcome to the audit trail
 *   altheia_policy      — fetch the current policy in scope
 *   altheia_audit_query — query recent audit events for the agent
 *
 * Resources (read-only):
 *   altheia://agent/<id>/policy
 *   altheia://agent/<id>/audit?limit=N
 *   altheia://agent/<id>            — agent metadata + status
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { Altheia, PolicyDeniedError, type AltheiaConfig } from "@altheia/sdk";
import type { AgentObject } from "@altheia/types";

export interface AltheiaMcpConfig extends AltheiaConfig {
  /** Optional override for the underlying Altheia HTTP client (for tests). */
  altheia?: Altheia;
}

const SERVER_INFO = {
  name: "altheia-mcp",
  version: "0.0.1",
};

/**
 * Build (but don't start) an MCP server wired to an Altheia client.
 * Caller chooses transport (`server.connect(transport)`) — typically
 * `StdioServerTransport()` for `npx @altheia/mcp` use, or an in-memory pair
 * for tests.
 */
export function createAltheiaMcpServer(config: AltheiaMcpConfig): {
  server: McpServer;
  altheia: Altheia;
  start: (transport?: Transport) => Promise<void>;
} {
  const altheia = config.altheia ?? new Altheia(config);
  const endpoint = config.endpoint ?? "https://api.altheia.xyz";
  const agentId = config.agentId;

  const server = new McpServer(SERVER_INFO, {
    capabilities: {
      tools: {},
      resources: {},
    },
  });

  // ─── Tools ───────────────────────────────────────────────────────────
  registerTools(server, altheia, agentId, endpoint, config.apiKey);

  // ─── Resources ───────────────────────────────────────────────────────
  registerResources(server, agentId, endpoint, config.apiKey);

  return {
    server,
    altheia,
    start: async (transport?: Transport) => {
      const t = transport ?? new StdioServerTransport();
      await server.connect(t);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────

function registerTools(
  server: McpServer,
  altheia: Altheia,
  agentId: string,
  endpoint: string,
  apiKey: string | undefined,
): void {
  const actionShape = {
    type: z
      .enum(["transfer", "swap", "sign", "invoke", "inference", "custom"])
      .describe("Action type"),
    amount: z.number().nonnegative().optional().describe("Optional numeric amount"),
    asset: z.string().optional().describe("SPL mint pubkey or 'SOL'"),
    target: z.string().optional().describe("Destination pubkey or program id"),
    metadata: z.record(z.unknown()).optional(),
  };

  // altheia_check — synchronous policy decision; no side effects.
  server.registerTool(
    "altheia_check",
    {
      description:
        "Check whether an agent action would be allowed by the operator's policy. Returns the Altheia Decision (allowed, reason, audit_event_id) without executing the action. Use before invoking any sensitive tool.",
      inputSchema: actionShape,
    },
    async (action) => {
      const decision = await altheia.check(action);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(decision, null, 2),
          },
        ],
      };
    },
  );

  // altheia_guard — hint to the calling LLM. We can't actually run an arbitrary
  // tool from the MCP server side, so this returns the Decision the LLM should
  // act on. If denied, the LLM must abort the action; if allowed, proceed and
  // call altheia_report afterward.
  server.registerTool(
    "altheia_guard",
    {
      description:
        "Pre-flight gate: returns whether the proposed action is allowed. If allowed=false, the LLM MUST abort. If allowed=true, the LLM may proceed and SHOULD call altheia_report afterward with the outcome.",
      inputSchema: actionShape,
    },
    async (action) => {
      const decision = await altheia.check(action);
      const verdict = decision.allowed ? "ALLOWED" : "DENIED";
      const summary = decision.allowed
        ? `Action allowed. Proceed, then call altheia_report({ action, outcome: "success", audit_event_id: "${decision.audit_event_id}" }).`
        : `Action denied (${decision.reason_code ?? "policy"}): ${decision.reason ?? "no reason given"}. ABORT and inform the operator.`;
      return {
        content: [
          { type: "text", text: `${verdict}: ${summary}` },
          { type: "text", text: JSON.stringify(decision, null, 2) },
        ],
        ...(decision.allowed ? {} : { isError: true }),
      };
    },
  );

  // altheia_report — log an action outcome to the audit trail.
  server.registerTool(
    "altheia_report",
    {
      description:
        "Report the outcome of an action to the Altheia audit trail. Best-effort; failures are silent.",
      inputSchema: {
        action: z.object(actionShape),
        outcome: z.enum(["success", "failure"]),
        audit_event_id: z.string().uuid().optional().describe("Audit event id from a prior altheia_check / altheia_guard"),
        detail: z.string().optional(),
      },
    },
    async (input) => {
      await altheia.report(input);
      return {
        content: [{ type: "text", text: "Reported." }],
      };
    },
  );

  // altheia_policy — fetch current policy.
  server.registerTool(
    "altheia_policy",
    {
      description: "Fetch the current policy in scope for this agent (per-asset caps, allowed programs, etc).",
      inputSchema: {},
    },
    async () => {
      try {
        const policy = await altheia.policy();
        return {
          content: [{ type: "text", text: JSON.stringify(policy, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to fetch policy: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // altheia_audit_query — query recent audit events. Calls the BE-014 endpoint
  // directly via fetch since the SDK doesn't expose audit queries (read-only,
  // no policy gating needed).
  server.registerTool(
    "altheia_audit_query",
    {
      description:
        "Query recent audit events for this agent. Returns chronological list of allowed/denied actions inscribed by Altheia.",
      inputSchema: {
        filter: z.enum(["all", "allowed", "denied"]).optional().describe("Default: all"),
        limit: z.number().int().min(1).max(100).optional().describe("Default: 20"),
      },
    },
    async (input) => {
      const filter = input.filter ?? "all";
      const limit = input.limit ?? 20;
      const events = await fetchAuditEventsRaw(endpoint, agentId, filter, limit, apiKey);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ events }, null, 2),
          },
        ],
      };
    },
  );

  // Surface PolicyDeniedError to the caller as an MCP error so the LLM can
  // discriminate from connection failures. Wrap the check tool in a defensive
  // catch — we already covered guard above, but check should also propagate
  // the raw Decision.
  void PolicyDeniedError; // referenced for clarity even though unused directly
}

// ─────────────────────────────────────────────────────────────────────
// Resources
// ─────────────────────────────────────────────────────────────────────

function registerResources(
  server: McpServer,
  agentId: string,
  endpoint: string,
  apiKey: string | undefined,
): void {
  // altheia://agent/<id>/policy
  server.registerResource(
    "policy",
    `altheia://agent/${agentId}/policy`,
    {
      title: "Agent Policy",
      description: "The on-chain operator policy in scope for this agent.",
      mimeType: "application/json",
    },
    async (uri) => {
      const res = await fetch(`${endpoint}/agents/${agentId}`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) {
        throw new Error(`backend returned ${res.status}`);
      }
      const body = (await res.json()) as { agent: AgentObject };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body.agent.policy, null, 2),
          },
        ],
      };
    },
  );

  // altheia://agent/<id>/audit
  server.registerResource(
    "audit",
    `altheia://agent/${agentId}/audit`,
    {
      title: "Agent Audit Trail",
      description: "Recent audit events for this agent (most recent first).",
      mimeType: "application/json",
    },
    async (uri) => {
      const events = await fetchAuditEventsRaw(endpoint, agentId, "all", 50, apiKey);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ events }, null, 2),
          },
        ],
      };
    },
  );

  // altheia://agent/<id>
  server.registerResource(
    "agent",
    `altheia://agent/${agentId}`,
    {
      title: "Agent Metadata",
      description: "Agent identity + status + on-chain references.",
      mimeType: "application/json",
    },
    async (uri) => {
      const res = await fetch(`${endpoint}/agents/${agentId}`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) {
        throw new Error(`backend returned ${res.status}`);
      }
      const body = (await res.json()) as { agent: AgentObject };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(body.agent, null, 2),
          },
        ],
      };
    },
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function fetchAuditEventsRaw(
  endpoint: string,
  agentId: string,
  filter: "all" | "allowed" | "denied",
  limit: number,
  apiKey: string | undefined,
): Promise<unknown[]> {
  const url = new URL(`${endpoint.replace(/\/$/, "")}/agents/${agentId}/audit`);
  url.searchParams.set("filter", filter);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!res.ok) {
    throw new Error(`audit fetch: backend returned ${res.status}`);
  }
  const body = (await res.json()) as { events: unknown[] };
  return body.events;
}

export { Altheia, PolicyDeniedError } from "@altheia/sdk";
export type { AltheiaConfig } from "@altheia/sdk";
