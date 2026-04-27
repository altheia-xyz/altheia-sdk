/**
 * @altheia/types — shared TypeScript types + zod schemas for the Altheia trust layer.
 *
 * Consumed by @altheia/sdk, @altheia/mcp, @altheia/solana-agent-kit,
 * and the (closed-source) altheia-backend.
 */

import { z } from "zod";

// ─── Action descriptor ────────────────────────────────────────────

export const ActionTypeSchema = z.enum([
  "transfer",
  "swap",
  "sign",
  "invoke",
  "inference",
  "custom",
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionDescriptorSchema = z.object({
  type: ActionTypeSchema,
  amount: z.number().nonnegative().optional(),
  asset: z.string().optional(),
  target: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type ActionDescriptor = z.infer<typeof ActionDescriptorSchema>;

// ─── Policy ───────────────────────────────────────────────────────

export const PolicyObjectSchema = z.object({
  // USD-denominated cross-asset caps
  max_per_tx_usd: z.number().nonnegative().optional(),
  max_per_day_usd: z.number().nonnegative().optional(),
  max_per_week_usd: z.number().nonnegative().optional(),

  // Per-mint caps (mapped to Swig TokenRecurringLimit / TokenLimit)
  asset_caps: z
    .record(
      z.object({
        max_per_tx: z.number().nonnegative().optional(),
        max_per_day: z.number().nonnegative().optional(),
        max_per_week: z.number().nonnegative().optional(),
        max_per_month: z.number().nonnegative().optional(),
      })
    )
    .optional(),

  // Per-asset destination filters (mapped to Swig TokenDestinationLimit)
  asset_destinations: z.record(z.array(z.string())).optional(),

  // Allowed/blocked programs (mapped to Swig Program / ProgramScope)
  allowed_programs: z.array(z.string()).optional(),
  blocked_programs: z.array(z.string()).optional(),

  // Allowed/blocked destinations (cross-asset)
  allowed_destinations: z.array(z.string()).optional(),
  blocked_destinations: z.array(z.string()).optional(),

  // Rate limits (off-chain SDK pre-flight only)
  max_actions_per_minute: z.number().int().positive().optional(),
  max_actions_per_hour: z.number().int().positive().optional(),

  // Lifecycle
  expires_at: z.string().datetime().optional(),
});
export type PolicyObject = z.infer<typeof PolicyObjectSchema>;

// ─── Decision ─────────────────────────────────────────────────────

export const DecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  reason_code: z.string().optional(),
  audit_event_id: z.string().uuid(),
  cached: z.boolean(),
  evaluated_at: z.string().datetime(),
});
export type Decision = z.infer<typeof DecisionSchema>;

// ─── Agent ────────────────────────────────────────────────────────

export const FrameworkSchema = z.enum([
  "eliza",
  "virtuals",
  "griffain",
  "sak",
  "mcp",
  "custom",
]);
export type Framework = z.infer<typeof FrameworkSchema>;

export const AgentStatusSchema = z.enum([
  "active",
  "paused",
  "revoked",
  "archived",
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const SubstrateSchema = z.enum([
  "swig",
  "squads",
  "privy",
  "turnkey",
  "lit",
]);
export type Substrate = z.infer<typeof SubstrateSchema>;

export const AgentObjectSchema = z.object({
  id: z.string().uuid(),
  operator_id: z.string().uuid(),
  on_chain_pubkey: z.string(),
  name: z.string(),
  framework: FrameworkSchema,
  status: AgentStatusSchema,
  policy: PolicyObjectSchema,
  policy_commitment: z.string(),
  model_commitment: z.string(),
  substrate: SubstrateSchema,
  substrate_account_pubkey: z.string(),
  session_key_pubkey: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type AgentObject = z.infer<typeof AgentObjectSchema>;

// ─── Errors ───────────────────────────────────────────────────────

export class PolicyDeniedError extends Error {
  constructor(
    public readonly reason: string,
    public readonly reasonCode: string | undefined,
    public readonly auditEventId: string
  ) {
    super(`Altheia policy denied: ${reason}`);
    this.name = "PolicyDeniedError";
  }
}

export class AltheiaConnectionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AltheiaConnectionError";
  }
}
