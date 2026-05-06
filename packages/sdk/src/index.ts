/**
 * @altheia/sdk — gate AI agent actions with on-chain-enforced policy.
 *
 * Wrap your agent's actions with `altheia.guard()` and they're checked
 * against your operator policy (off-chain pre-flight via the Altheia
 * backend) AND enforced on-chain at the Swig session-key signing layer.
 *
 * Failure-mode contract (decision 2026-04-30):
 *   default `failureMode: "open"` — if the backend is unreachable, the SDK
 *   returns allowed and the agent proceeds. Swig's on-chain scope is the
 *   floor that catches over-cap actions regardless. Audit coverage is
 *   preserved by the backend's reconciliation cron + Helius webhook
 *   retries. Set `failureMode: "closed"` to harden if you want to halt
 *   on outage.
 */

import {
  type ActionDescriptor,
  type Decision,
  type PolicyObject,
  PolicyDeniedError,
  AltheiaConnectionError,
} from "@altheia/types";

export interface AltheiaConfig {
  /**
   * Canonical agent identifier — the AgentAccount PDA on the Identity Program.
   * Solscan-linkable, on-chain, deterministic. **Preferred over agentId.**
   *
   * Either `agentPda` or the legacy `agentId` (DB UUID) must be provided. If
   * both are set, `agentPda` wins.
   */
  agentPda?: string;
  /**
   * Legacy DB UUID. Kept for back-compat with code written before the
   * PDA-as-identity migration. Prefer `agentPda` for new integrations.
   */
  agentId?: string;
  /**
   * apiKey issued at agent registration (Bearer header for /sdk/agent_check).
   * Required in production — without it, the route rejects with 401.
   */
  apiKey?: string;
  /** Backend base URL. Defaults to https://api.altheia.xyz. */
  endpoint?: string;
  /** "open" (default): allow actions on backend outage. "closed": throw. */
  failureMode?: "closed" | "open";
  /** Pre-flight HTTP timeout in ms. Default 1500. */
  timeoutMs?: number;
  /** Cache TTL in seconds for repeat-action decisions. Default 0 (off). */
  cacheTTL?: number;
}

export class Altheia {
  private readonly endpoint: string;
  private readonly failureMode: "closed" | "open";
  private readonly timeoutMs: number;
  // Resolved canonical identifier: PDA if provided, else fall back to UUID.
  // Backend's /sdk/agent_check accepts both shapes; we send whichever the
  // operator gave us.
  private readonly agentRef: string;
  private readonly agentRefField: "agent_pda" | "agent_id";

  constructor(private readonly config: AltheiaConfig) {
    this.endpoint = stripTrailingSlash(config.endpoint ?? "https://api.altheia.xyz");
    this.failureMode = config.failureMode ?? "open";
    this.timeoutMs = config.timeoutMs ?? 1500;

    if (config.agentPda) {
      this.agentRef = config.agentPda;
      this.agentRefField = "agent_pda";
    } else if (config.agentId) {
      this.agentRef = config.agentId;
      this.agentRefField = "agent_id";
    } else {
      throw new Error("Altheia: either agentPda (preferred) or agentId is required");
    }
  }

  /**
   * Wrap an action: check policy, run if allowed, audit the result.
   * Throws PolicyDeniedError if denied; throws AltheiaConnectionError on
   * backend unreachable (only in 'closed' failure mode).
   */
  async guard<T>(action: ActionDescriptor, fn: () => Promise<T>): Promise<T> {
    const decision = await this.check(action);
    if (!decision.allowed) {
      throw new PolicyDeniedError(
        decision.reason ?? "denied",
        decision.reason_code,
        decision.audit_event_id,
      );
    }
    const result = await fn();
    // Best-effort outcome report. Failures are silent — the audit row was
    // created at check() time.
    void this.report({ action, outcome: "success", audit_event_id: decision.audit_event_id }).catch(() => undefined);
    return result;
  }

  /** Check whether an action would be allowed, without executing it. */
  async check(action: ActionDescriptor): Promise<Decision> {
    try {
      const res = await this.fetchWithTimeout(`${this.endpoint}/sdk/agent_check`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ [this.agentRefField]: this.agentRef, action }),
      });
      if (!res.ok) {
        return this.handleFailure(new AltheiaConnectionError(`backend returned ${res.status}`));
      }
      return (await res.json()) as Decision;
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      return this.handleFailure(new AltheiaConnectionError(cause.message, cause));
    }
  }

  /** Report an outcome to the audit trail (post-execution). Best-effort. */
  async report(event: {
    action: ActionDescriptor;
    outcome: "success" | "failure";
    audit_event_id?: string;
    detail?: string;
  }): Promise<void> {
    try {
      await this.fetchWithTimeout(`${this.endpoint}/sdk/agent_report`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ [this.agentRefField]: this.agentRef, ...event }),
      });
    } catch (err) {
      // best-effort; surface at warn level so users can see SDK-internal issues without crashing.
      console.warn("[altheia] report() failed:", err instanceof Error ? err.message : err);
    }
  }

  /** Send a heartbeat that the agent is alive. Best-effort. */
  async ping(status: { status: "healthy" | "degraded" | "down"; detail?: string } = { status: "healthy" }): Promise<void> {
    try {
      await this.fetchWithTimeout(`${this.endpoint}/sdk/heartbeat`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ [this.agentRefField]: this.agentRef, ...status }),
      });
    } catch (err) {
      console.warn("[altheia] ping() failed:", err instanceof Error ? err.message : err);
    }
  }

  /** Fetch the current policy in scope for this agent. */
  async policy(): Promise<PolicyObject> {
    const url = `${this.endpoint}/agents/${this.agentRef}/policy`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new AltheiaConnectionError(`backend returned ${res.status}`);
    const body = (await res.json()) as { policy: PolicyObject };
    return body.policy;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiKey) h["Authorization"] = `Bearer ${this.config.apiKey}`;
    return h;
  }

  /** Single source of truth for fetch + AbortController timeout (CQ-1). */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private handleFailure(err: AltheiaConnectionError): Decision {
    if (this.failureMode === "closed") throw err;
    // Fail-open: synthesize a permissive Decision so the action proceeds.
    return {
      allowed: true,
      reason: "sdk_unreachable_failopen",
      reason_code: "sdk_failopen",
      audit_event_id: ZERO_UUID,
      cached: false,
      evaluated_at: new Date().toISOString(),
    };
  }
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export type { ActionDescriptor, Decision, PolicyObject } from "@altheia/types";
export { PolicyDeniedError, AltheiaConnectionError } from "@altheia/types";
