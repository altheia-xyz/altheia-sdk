import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withAltheia, type AdapterEvent } from "./index.js";
import { Altheia, PolicyDeniedError } from "@altheia/sdk";

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

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

class FakeSAK {
  publicKey = "FakeWalletPubkey...";
  wallet = { publicKey: "FakeWalletPubkey..." };
  transferCalls: Array<unknown[]> = [];
  tradeCalls: Array<unknown[]> = [];

  async transfer(to: string, amount: number, mint?: string): Promise<string> {
    this.transferCalls.push([to, amount, mint]);
    return `tx-${amount}-${to.slice(0, 6)}`;
  }
  async trade(outputMint: string, inputAmount: number, inputMint?: string, _slippage?: number): Promise<string> {
    this.tradeCalls.push([outputMint, inputAmount, inputMint, _slippage]);
    return `swap-${inputAmount}-${outputMint.slice(0, 6)}`;
  }
  async getBalance(): Promise<number> {
    return 100;
  }
  async fetchPrice(_mint: string): Promise<number> {
    return 1.0;
  }
  async customAction(payload: unknown): Promise<string> {
    return `custom-${JSON.stringify(payload)}`;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withAltheia (SAK adapter)", () => {
  describe("transfer mapping", () => {
    it("wraps transfer in guard, allows under-cap", async () => {
      const fetchSpy = mockFetch(allowed);
      globalThis.fetch = fetchSpy as never;
      const sak = new FakeSAK();
      const guarded = withAltheia(sak, { agentId: AGENT_ID, endpoint: "http://test" });

      const tx = await guarded.transfer("RecipientPubkey...", 50, "USDC");

      expect(tx).toMatch(/^tx-50/);
      expect(sak.transferCalls).toHaveLength(1);
      expect(fetchSpy.mock.calls[0]![0]).toBe("http://test/sdk/agent_check");
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as { body: string }).body);
      expect(body.action).toMatchObject({
        type: "transfer",
        amount: 50,
        asset: "USDC",
        target: "RecipientPubkey...",
      });
    });

    it("blocks transfer when policy denies — SAK never called", async () => {
      globalThis.fetch = mockFetch(denied) as never;
      const sak = new FakeSAK();
      const guarded = withAltheia(sak, { agentId: AGENT_ID, endpoint: "http://test" });

      await expect(
        guarded.transfer("RecipientPubkey...", 1200, "USDC"),
      ).rejects.toBeInstanceOf(PolicyDeniedError);
      expect(sak.transferCalls).toHaveLength(0);
    });

    it("defaults asset to SOL when mint not provided", async () => {
      const fetchSpy = mockFetch(allowed);
      globalThis.fetch = fetchSpy as never;
      const sak = new FakeSAK();
      const guarded = withAltheia(sak, { agentId: AGENT_ID, endpoint: "http://test" });

      await guarded.transfer("RecipientPubkey...", 0.5);

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as { body: string }).body);
      expect(body.action.asset).toBe("SOL");
    });
  });

  describe("trade mapping (Jupiter swap)", () => {
    it("wraps trade in guard with target=outputMint + jupiter metadata", async () => {
      const fetchSpy = mockFetch(allowed);
      globalThis.fetch = fetchSpy as never;
      const sak = new FakeSAK();
      const guarded = withAltheia(sak, { agentId: AGENT_ID, endpoint: "http://test" });

      await guarded.trade("So111...", 0.5, "USDC", 50);

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as { body: string }).body);
      expect(body.action).toMatchObject({
        type: "swap",
        amount: 0.5,
        asset: "USDC",
        target: "So111...",
        metadata: { aggregator: "jupiter-v6" },
      });
    });
  });

  describe("passthrough behavior", () => {
    it("getBalance bypasses guard (read method)", async () => {
      const fetchSpy = mockFetch(allowed);
      globalThis.fetch = fetchSpy as never;
      const sak = new FakeSAK();
      const guarded = withAltheia(sak, { agentId: AGENT_ID, endpoint: "http://test" });

      const bal = await guarded.getBalance();

      expect(bal).toBe(100);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fetchPrice bypasses guard (read method)", async () => {
      const fetchSpy = mockFetch(allowed);
      globalThis.fetch = fetchSpy as never;
      const sak = new FakeSAK();
      const guarded = withAltheia(sak, { agentId: AGENT_ID, endpoint: "http://test" });

      await guarded.fetchPrice("USDC");

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("unknown action method passes through with passthrough event", async () => {
      const fetchSpy = mockFetch(allowed);
      globalThis.fetch = fetchSpy as never;
      const events: AdapterEvent[] = [];
      const sak = new FakeSAK();
      const guarded = withAltheia(
        sak,
        { agentId: AGENT_ID, endpoint: "http://test" },
        { onAction: (e) => events.push(e) },
      );

      const result = await guarded.customAction({ foo: "bar" });

      expect(result).toMatch(/^custom-/);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(events).toEqual([{ method: "customAction", outcome: "passthrough" }]);
    });

    it("non-function properties returned as-is", () => {
      const sak = new FakeSAK();
      const guarded = withAltheia(sak, { agentId: AGENT_ID, endpoint: "http://test" });

      expect(guarded.publicKey).toBe("FakeWalletPubkey...");
      expect(guarded.wallet.publicKey).toBe("FakeWalletPubkey...");
    });
  });

  describe("onAction event hook", () => {
    it("emits 'allowed' event on successful guarded action", async () => {
      globalThis.fetch = mockFetch(allowed) as never;
      const events: AdapterEvent[] = [];
      const sak = new FakeSAK();
      const guarded = withAltheia(
        sak,
        { agentId: AGENT_ID, endpoint: "http://test" },
        { onAction: (e) => events.push(e) },
      );

      await guarded.transfer("R...", 50, "USDC");

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        method: "transfer",
        outcome: "allowed",
        action: { type: "transfer", amount: 50 },
      });
    });

    it("emits 'denied' event with reason on PolicyDeniedError", async () => {
      globalThis.fetch = mockFetch(denied) as never;
      const events: AdapterEvent[] = [];
      const sak = new FakeSAK();
      const guarded = withAltheia(
        sak,
        { agentId: AGENT_ID, endpoint: "http://test" },
        { onAction: (e) => events.push(e) },
      );

      await expect(guarded.transfer("R...", 1200, "USDC")).rejects.toBeInstanceOf(PolicyDeniedError);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        method: "transfer",
        outcome: "denied",
        reasonCode: "over_per_tx_cap",
      });
    });
  });

  describe("config flexibility", () => {
    it("accepts a pre-built Altheia instance", async () => {
      globalThis.fetch = mockFetch(allowed) as never;
      const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
      const sak = new FakeSAK();
      const guarded = withAltheia(sak, altheia);

      await guarded.transfer("R...", 50, "USDC");

      expect(sak.transferCalls).toHaveLength(1);
    });

    it("custom actionMap entry overrides default", async () => {
      const fetchSpy = mockFetch(allowed);
      globalThis.fetch = fetchSpy as never;
      const sak = new FakeSAK();
      const guarded = withAltheia(
        sak,
        { agentId: AGENT_ID, endpoint: "http://test" },
        {
          actionMap: {
            customAction: (args) => ({
              type: "invoke",
              metadata: { payload: args[0] as Record<string, unknown> },
            }),
          },
        },
      );

      await guarded.customAction({ foo: "bar" });

      expect(fetchSpy.mock.calls[0]![0]).toBe("http://test/sdk/agent_check");
      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as { body: string }).body);
      expect(body.action.type).toBe("invoke");
      expect(body.action.metadata).toEqual({ payload: { foo: "bar" } });
    });

    it("custom passthrough predicate skips unwanted methods", async () => {
      const fetchSpy = mockFetch(allowed);
      globalThis.fetch = fetchSpy as never;
      const sak = new FakeSAK();
      const guarded = withAltheia(
        sak,
        { agentId: AGENT_ID, endpoint: "http://test" },
        { passthrough: (m) => m === "transfer" },
      );

      await guarded.transfer("R...", 50, "USDC");

      expect(sak.transferCalls).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
