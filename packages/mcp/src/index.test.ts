/**
 * MCP server end-to-end tests using an in-memory client/server pair.
 *
 * Verifies:
 *   - All 5 tools are registered and discoverable
 *   - All 3 resources are registered and discoverable
 *   - altheia_check returns Decision via the underlying Altheia.check()
 *   - altheia_guard surfaces deny as MCP isError + structured Decision
 *   - altheia_audit_query hits the BE-014 endpoint with the right URL + auth header
 *   - altheia://agent/<id>/policy reads agent + extracts .policy
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Altheia } from "@altheia/sdk";
import { createAltheiaMcpServer } from "./index.js";

const AGENT_ID = "11111111-1111-1111-1111-111111111111";
const AUDIT_ID = "22222222-2222-2222-2222-222222222222";

const allowed = {
  allowed: true,
  audit_event_id: AUDIT_ID,
  cached: false,
  evaluated_at: new Date().toISOString(),
};
const denied = {
  allowed: false,
  reason: "over_per_tx_cap (1200 > 100 USDC)",
  reason_code: "over_per_tx_cap",
  audit_event_id: AUDIT_ID,
  cached: false,
  evaluated_at: new Date().toISOString(),
};

type FetchFn = (url: string | URL, init?: { headers?: Record<string, string>; method?: string; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function mockFetch(routes: Record<string, unknown>, captured?: Array<{ url: string; init?: unknown }>): FetchFn {
  return (async (url, init) => {
    const urlStr = url.toString();
    captured?.push({ url: urlStr, init });
    for (const [pattern, body] of Object.entries(routes)) {
      if (urlStr.includes(pattern)) {
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
  }) as FetchFn;
}

async function makeClientServerPair(altheia: Altheia, apiKey?: string) {
  const { server, start } = createAltheiaMcpServer({
    agentId: AGENT_ID,
    altheia,
    endpoint: "http://test",
    ...(apiKey ? { apiKey } : {}),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await start(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  return { client, server };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("@altheia/mcp server", () => {
  describe("tool discovery", () => {
    it("registers all 5 tools", async () => {
      globalThis.fetch = mockFetch({}) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia);

      const result = await client.listTools();
      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual([
        "altheia_audit_query",
        "altheia_check",
        "altheia_guard",
        "altheia_policy",
        "altheia_report",
      ]);
    });

    it("each tool has a description", async () => {
      globalThis.fetch = mockFetch({}) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia);

      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.description, `${tool.name} should have description`).toBeTruthy();
        expect(tool.description!.length).toBeGreaterThan(20);
      }
    });
  });

  describe("altheia_check tool", () => {
    it("returns the Altheia Decision when allowed", async () => {
      globalThis.fetch = mockFetch({ "/sdk/agent_check": allowed }) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia);

      const result = await client.callTool({
        name: "altheia_check",
        arguments: { type: "transfer", asset: "USDC", amount: 50 },
      });

      const text = (result.content as Array<{ text: string }>)[0]!.text;
      const decision = JSON.parse(text);
      expect(decision.allowed).toBe(true);
      expect(decision.audit_event_id).toBe(AUDIT_ID);
    });

    it("returns the deny Decision when denied", async () => {
      globalThis.fetch = mockFetch({ "/sdk/agent_check": denied }) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia);

      const result = await client.callTool({
        name: "altheia_check",
        arguments: { type: "transfer", asset: "USDC", amount: 1200 },
      });

      const text = (result.content as Array<{ text: string }>)[0]!.text;
      const decision = JSON.parse(text);
      expect(decision.allowed).toBe(false);
      expect(decision.reason_code).toBe("over_per_tx_cap");
    });
  });

  describe("altheia_guard tool", () => {
    it("returns ALLOWED summary on allow", async () => {
      globalThis.fetch = mockFetch({ "/sdk/agent_check": allowed }) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia);

      const result = await client.callTool({
        name: "altheia_guard",
        arguments: { type: "transfer", asset: "USDC", amount: 50 },
      });

      const firstText = (result.content as Array<{ text: string }>)[0]!.text;
      expect(firstText).toMatch(/^ALLOWED:/);
      expect(result.isError).not.toBe(true);
    });

    it("returns DENIED summary AND isError flag on deny", async () => {
      globalThis.fetch = mockFetch({ "/sdk/agent_check": denied }) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia);

      const result = await client.callTool({
        name: "altheia_guard",
        arguments: { type: "transfer", asset: "USDC", amount: 1200 },
      });

      const firstText = (result.content as Array<{ text: string }>)[0]!.text;
      expect(firstText).toMatch(/^DENIED:/);
      expect(firstText).toContain("over_per_tx_cap");
      expect(result.isError).toBe(true);
    });
  });

  describe("altheia_audit_query tool", () => {
    it("calls /agents/:id/audit with filter + limit query params", async () => {
      const captured: Array<{ url: string; init?: unknown }> = [];
      const fakeEvents = [
        { id: "evt-1", decision: "denied", event_type: "action_denied" },
      ];
      globalThis.fetch = mockFetch({ "/agents/": { events: fakeEvents } }, captured) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia, "test-bearer");

      const result = await client.callTool({
        name: "altheia_audit_query",
        arguments: { filter: "denied", limit: 5 },
      });

      // The audit fetch was made
      const auditCall = captured.find((c) => c.url.includes("/audit"));
      expect(auditCall).toBeTruthy();
      expect(auditCall!.url).toContain("filter=denied");
      expect(auditCall!.url).toContain("limit=5");
      // Bearer header propagated from apiKey
      const headers = (auditCall!.init as { headers?: Record<string, string> })?.headers ?? {};
      expect(headers["Authorization"]).toBe("Bearer test-bearer");

      // Response carries the events
      const text = (result.content as Array<{ text: string }>)[0]!.text;
      expect(JSON.parse(text)).toEqual({ events: fakeEvents });
    });

    it("defaults to filter=all + limit=20 when omitted", async () => {
      const captured: Array<{ url: string; init?: unknown }> = [];
      globalThis.fetch = mockFetch({ "/agents/": { events: [] } }, captured) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia);

      await client.callTool({
        name: "altheia_audit_query",
        arguments: {},
      });

      const auditCall = captured.find((c) => c.url.includes("/audit"));
      expect(auditCall!.url).toContain("filter=all");
      expect(auditCall!.url).toContain("limit=20");
    });
  });

  describe("altheia_policy tool", () => {
    it("returns the policy JSON when policy() succeeds", async () => {
      const policyBody = { policy: { asset_caps: { USDC: { max_per_tx: 100 } } } };
      globalThis.fetch = mockFetch({ "/policy": policyBody }) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia);

      const result = await client.callTool({
        name: "altheia_policy",
        arguments: {},
      });

      const text = (result.content as Array<{ text: string }>)[0]!.text;
      expect(JSON.parse(text)).toEqual(policyBody.policy);
    });

    it("returns isError=true when backend errors", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia);

      const result = await client.callTool({
        name: "altheia_policy",
        arguments: {},
      });

      expect(result.isError).toBe(true);
    });
  });

  describe("resources", () => {
    it("registers all 3 static resources", async () => {
      globalThis.fetch = mockFetch({}) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia);

      const result = await client.listResources();
      const uris = result.resources.map((r) => r.uri).sort();
      expect(uris).toEqual([
        `altheia://agent/${AGENT_ID}`,
        `altheia://agent/${AGENT_ID}/audit`,
        `altheia://agent/${AGENT_ID}/policy`,
      ]);
    });

    it("agent metadata resource returns the full agent object", async () => {
      const agentObj = { id: AGENT_ID, name: "test-agent", status: "active" };
      globalThis.fetch = mockFetch({ "/agents/": { agent: agentObj } }) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const { client } = await makeClientServerPair(altheia);

      const result = await client.readResource({ uri: `altheia://agent/${AGENT_ID}` });
      const text = (result.contents[0]! as { text: string }).text;
      expect(JSON.parse(text)).toEqual(agentObj);
    });
  });
});
