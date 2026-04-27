/**
 * @altheia/sdk — gate AI agent actions with on-chain-enforced policy.
 *
 * The SDK is the developer's entry point. Wrap your agent's actions with
 * `altheia.guard()` and they're checked against your operator policy
 * (off-chain pre-flight) AND enforced on-chain at the Swig session-key
 * signing layer.
 */

import type {
  ActionDescriptor,
  Decision,
  PolicyObject,
} from "@altheia/types";
import {
  PolicyDeniedError,
  AltheiaConnectionError,
} from "@altheia/types";

export interface AltheiaConfig {
  apiKey: string;
  agentId: string;
  endpoint?: string;
  failureMode?: "closed" | "open";
  cacheTTL?: number;
}

export class Altheia {
  private readonly endpoint: string;
  private readonly failureMode: "closed" | "open";
  private readonly cacheTTL: number;

  constructor(private readonly config: AltheiaConfig) {
    this.endpoint = config.endpoint ?? "https://api.altheia.xyz";
    this.failureMode = config.failureMode ?? "closed";
    this.cacheTTL = config.cacheTTL ?? 60;
  }

  /**
   * Wrap an action: check policy, run if allowed, audit the result.
   * Throws PolicyDeniedError if denied; throws AltheiaConnectionError on
   * backend unreachable (in 'closed' failure mode, the default).
   */
  async guard<T>(
    action: ActionDescriptor,
    fn: () => Promise<T>
  ): Promise<T> {
    const decision = await this.check(action);
    if (!decision.allowed) {
      throw new PolicyDeniedError(
        decision.reason ?? "denied",
        decision.reason_code,
        decision.audit_event_id
      );
    }
    const result = await fn();
    await this.report({ ...action, outcome: "success" });
    return result;
  }

  /** Check whether an action would be allowed, without executing it. */
  async check(_action: ActionDescriptor): Promise<Decision> {
    // TODO: cache layer + HTTPS POST to /sdk/agent_check
    throw new Error("not implemented");
  }

  /** Log an arbitrary action to the audit trail. */
  async report(_event: Record<string, unknown>): Promise<void> {
    // TODO: HTTPS POST to /sdk/agent_check (report variant) or /sdk/heartbeat
  }

  /** Send a heartbeat that the agent is alive. */
  async ping(_status: { status: "healthy" | "degraded" | "down" }): Promise<void> {
    // TODO
  }

  /** Fetch the current policy in scope for this agent. */
  async policy(): Promise<PolicyObject> {
    // TODO
    throw new Error("not implemented");
  }
}

export type { ActionDescriptor, Decision, PolicyObject } from "@altheia/types";
export { PolicyDeniedError, AltheiaConnectionError } from "@altheia/types";
