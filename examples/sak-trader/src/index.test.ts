/**
 * Smoke test for the E2E-001 demo agent — verifies the allow/deny/allow cycle
 * works end-to-end at the JS layer with a mocked backend.
 *
 * This doesn't import index.ts directly (it's a script with side effects).
 * Instead it exercises the same wrapping pattern: MockSAK + withAltheia +
 * mocked fetch returning canned Decisions.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { withAltheia, PolicyDeniedError } from "@altheia/solana-agent-kit";

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
  reason: "over_per_tx_cap (5 > 1 USDC)",
  reason_code: "over_per_tx_cap",
  audit_event_id: AUDIT_ID,
  cached: false,
  evaluated_at: new Date().toISOString(),
};

class MockSAK {
  publicKey = "DemoAgentXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
  transferCalls: Array<unknown[]> = [];
  tradeCalls: Array<unknown[]> = [];

  async transfer(to: string, amount: number, mint?: string): Promise<string> {
    this.transferCalls.push([to, amount, mint]);
    return `mock-tx-${amount}`;
  }
  async trade(out: string, amount: number, inMint?: string): Promise<string> {
    this.tradeCalls.push([out, amount, inMint]);
    return `mock-swap-${amount}`;
  }
}

/**
 * Mock fetch that returns canned check responses in order. Each `guard()` call
 * fires two fetches (agent_check + fire-and-forget agent_report); we only
 * sequence the check responses and accept any report URL.
 */
function fetchSequence(...checkResponses: unknown[]) {
  let i = 0;
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith("/sdk/agent_check")) {
      const body = checkResponses[i++] ?? checkResponses[checkResponses.length - 1];
      return { ok: true, status: 200, json: async () => body };
    }
    // agent_report and any other endpoint: always accept
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

afterEach(() => vi.restoreAllMocks());

describe("E2E-001 demo agent — allow → deny → allow cycle", () => {
  it("step 1 (under-cap transfer) is allowed and SAK.transfer runs", async () => {
    globalThis.fetch = fetchSequence(allowed) as never;
    const sak = new MockSAK();
    const guarded = withAltheia(sak, { agentId: AGENT_ID, endpoint: "http://test" });

    const tx = await guarded.transfer("Recipient...", 0.5, "USDC");

    expect(tx).toMatch(/^mock-tx-/);
    expect(sak.transferCalls).toHaveLength(1);
    expect(sak.transferCalls[0]).toEqual(["Recipient...", 0.5, "USDC"]);
  });

  it("step 2 (over-cap swap) is denied and SAK.trade is NEVER called (kill-switch in soft form)", async () => {
    globalThis.fetch = fetchSequence(denied) as never;
    const sak = new MockSAK();
    const guarded = withAltheia(sak, { agentId: AGENT_ID, endpoint: "http://test" });

    await expect(
      guarded.trade("So111...", 5, "USDC"),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    // The critical assertion: SAK never executed. The agent's wallet never signed.
    expect(sak.tradeCalls).toHaveLength(0);
  });

  it("step 3 (under-cap swap after deny) succeeds — agent is still healthy", async () => {
    // Sequence: deny first call, allow second.
    globalThis.fetch = fetchSequence(denied, allowed) as never;
    const sak = new MockSAK();
    const guarded = withAltheia(sak, { agentId: AGENT_ID, endpoint: "http://test" });

    // The deny.
    await expect(guarded.trade("So111...", 5, "USDC")).rejects.toBeInstanceOf(PolicyDeniedError);
    expect(sak.tradeCalls).toHaveLength(0);

    // The recovery — agent still works after a denial.
    const tx = await guarded.trade("So111...", 0.5, "USDC");
    expect(tx).toMatch(/^mock-swap-/);
    expect(sak.tradeCalls).toHaveLength(1);
  });

  it("captures all three onAction events in order: allowed, denied, allowed", async () => {
    const events: Array<{ method: string; outcome: string }> = [];
    globalThis.fetch = fetchSequence(allowed, denied, allowed) as never;
    const sak = new MockSAK();
    const guarded = withAltheia(
      sak,
      { agentId: AGENT_ID, endpoint: "http://test" },
      { onAction: (e) => events.push({ method: e.method, outcome: e.outcome }) },
    );

    await guarded.transfer("R...", 0.5, "USDC");
    await guarded.trade("So111...", 5, "USDC").catch(() => undefined);
    await guarded.trade("So111...", 0.5, "USDC");

    expect(events).toEqual([
      { method: "transfer", outcome: "allowed" },
      { method: "trade", outcome: "denied" },
      { method: "trade", outcome: "allowed" },
    ]);
  });
});
