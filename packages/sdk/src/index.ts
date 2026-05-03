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
  /** Identifier for this agent — must match the AgentObject.id from /agents register response. */
  agentId: string;
  /** Reserved for production auth. Optional in hackathon scope. */
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

  constructor(private readonly config: AltheiaConfig) {
    this.endpoint = stripTrailingSlash(config.endpoint ?? "https://api.altheia.xyz");
    this.failureMode = config.failureMode ?? "open";
    this.timeoutMs = config.timeoutMs ?? 1500;
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
    const url = `${this.endpoint}/sdk/agent_check`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ agent_id: this.config.agentId, action }),
        signal: controller.signal,
      });
      if (!res.ok) {
        return this.handleFailure(new AltheiaConnectionError(`backend returned ${res.status}`));
      }
      return (await res.json()) as Decision;
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      return this.handleFailure(new AltheiaConnectionError(cause.message, cause));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Report an outcome to the audit trail (post-execution). Best-effort. */
  async report(event: {
    action: ActionDescriptor;
    outcome: "success" | "failure";
    audit_event_id?: string;
    detail?: string;
  }): Promise<void> {
    const url = `${this.endpoint}/sdk/agent_report`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ agent_id: this.config.agentId, ...event }),
        signal: controller.signal,
      });
    } catch {
      // best-effort; swallow
    } finally {
      clearTimeout(timer);
    }
  }

  /** Send a heartbeat that the agent is alive. Best-effort. */
  async ping(status: { status: "healthy" | "degraded" | "down"; detail?: string } = { status: "healthy" }): Promise<void> {
    const url = `${this.endpoint}/sdk/heartbeat`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ agent_id: this.config.agentId, ...status }),
        signal: controller.signal,
      });
    } catch {
      // best-effort
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fetch the current policy in scope for this agent. */
  async policy(): Promise<PolicyObject> {
    const url = `${this.endpoint}/agents/${this.config.agentId}/policy`;
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
