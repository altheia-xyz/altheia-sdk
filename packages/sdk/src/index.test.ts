import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Altheia, PolicyDeniedError, AltheiaConnectionError } from "./index.js";

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

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Altheia.guard()", () => {
  it("runs the wrapped fn when backend allows", async () => {
    globalThis.fetch = mockFetchOnce(allowed) as never;
    const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
    const fn = vi.fn().mockResolvedValue("done");
    const result = await altheia.guard({ type: "transfer", asset: "USDC", amount: 50 }, fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe("done");
  });

  it("throws PolicyDeniedError when backend denies", async () => {
    globalThis.fetch = mockFetchOnce(denied) as never;
    const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
    const fn = vi.fn();
    await expect(
      altheia.guard({ type: "transfer", asset: "USDC", amount: 1200 }, fn),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("PolicyDeniedError carries reason_code and audit id", async () => {
    globalThis.fetch = mockFetchOnce(denied) as never;
    const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
    try {
      await altheia.guard({ type: "transfer", asset: "USDC", amount: 1200 }, vi.fn());
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyDeniedError);
      const e = err as PolicyDeniedError;
      expect(e.reasonCode).toBe("over_per_tx_cap");
      expect(e.auditEventId).toBe(AUDIT_ID);
    }
  });

  it("fails open by default: backend down → action runs", async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")) as never;
    const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
    const fn = vi.fn().mockResolvedValue("done");
    const result = await altheia.guard({ type: "transfer", asset: "USDC", amount: 50 }, fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe("done");
  });

  it("fails closed when configured: backend down → throws", async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")) as never;
    const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test", failureMode: "closed" });
    const fn = vi.fn();
    await expect(
      altheia.guard({ type: "transfer", asset: "USDC", amount: 50 }, fn),
    ).rejects.toBeInstanceOf(AltheiaConnectionError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("fail-closed treats 5xx as connection error", async () => {
    globalThis.fetch = mockFetchOnce({ error: "boom" }, false, 500) as never;
    const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test", failureMode: "closed" });
    await expect(
      altheia.guard({ type: "transfer" }, vi.fn()),
    ).rejects.toBeInstanceOf(AltheiaConnectionError);
  });

  it("fail-open treats 5xx as allow", async () => {
    globalThis.fetch = mockFetchOnce({ error: "boom" }, false, 500) as never;
    const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
    const fn = vi.fn().mockResolvedValue("ran");
    const result = await altheia.guard({ type: "transfer" }, fn);
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe("ran");
  });

  it("strips trailing slash from endpoint", async () => {
    const fetchSpy = mockFetchOnce(allowed);
    globalThis.fetch = fetchSpy as never;
    const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test/" });
    await altheia.guard({ type: "transfer" }, vi.fn().mockResolvedValue(null));
    expect(fetchSpy).toHaveBeenCalledWith("http://test/sdk/agent_check", expect.any(Object));
  });
});

describe("Altheia.check()", () => {
  it("posts agent_id + action body to /sdk/agent_check", async () => {
    const fetchSpy = mockFetchOnce(allowed);
    globalThis.fetch = fetchSpy as never;
    const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test" });
    await altheia.check({ type: "swap", asset: "USDC", amount: 50 });
    const [, opts] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.agent_id).toBe(AGENT_ID);
    expect(body.action).toEqual({ type: "swap", asset: "USDC", amount: 50 });
  });

  it("includes Bearer apiKey when provided", async () => {
    const fetchSpy = mockFetchOnce(allowed);
    globalThis.fetch = fetchSpy as never;
    const altheia = new Altheia({ agentId: AGENT_ID, endpoint: "http://test", apiKey: "secret-key" });
    await altheia.check({ type: "transfer" });
    const [, opts] = fetchSpy.mock.calls[0]!;
    const headers = (opts as { headers: Record<string, string> }).headers;
    expect(headers["Authorization"]).toBe("Bearer secret-key");
  });
});
