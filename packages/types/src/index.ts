/**
 * @altheia-xyz/types — shared TypeScript types + zod schemas for the Altheia trust layer.
 *
 * Consumed by @altheia-xyz/sdk, @altheia-xyz/mcp, @altheia-xyz/solana-agent-kit,
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

// ─── Operator ─────────────────────────────────────────────────────

export const PlanTierSchema = z.enum(["free", "starter", "pro", "enterprise"]);
export type PlanTier = z.infer<typeof PlanTierSchema>;

export const OperatorStatusSchema = z.enum(["active", "suspended", "deleted"]);
export type OperatorStatus = z.infer<typeof OperatorStatusSchema>;

export const OperatorObjectSchema = z.object({
  id: z.string().uuid(),
  wallet_pubkey: z.string(),
  display_name: z.string().nullable(),
  email: z.string().email().nullable(),
  plan_tier: PlanTierSchema,
  status: OperatorStatusSchema,
  alert_webhook_url: z.string().url().nullable(),
  alert_slack_webhook: z.string().url().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type OperatorObject = z.infer<typeof OperatorObjectSchema>;

// ─── Audit ────────────────────────────────────────────────────────

export const AuditEventTypeSchema = z.enum([
  // Identity Program events
  "agent_registered",
  "policy_updated",
  "agent_paused",
  "agent_unpaused",
  "agent_revoked",
  "agent_archived",
  "audit_root_committed",
  // SDK pre-flight events
  "action_allowed",
  "action_denied",
  // Substrate (Swig) on-chain events
  "transfer_allowed",
  "transfer_denied",
  "session_key_created",
  "session_key_revoked",
  "scope_violation_on_chain",
  // SDK telemetry
  "sdk_heartbeat",
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const DecisionLabelSchema = z.enum(["allowed", "denied", "n/a"]);
export type DecisionLabel = z.infer<typeof DecisionLabelSchema>;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  operator_id: z.string().uuid(),
  agent_id: z.string().uuid().nullable(),
  event_type: AuditEventTypeSchema,
  action_descriptor: ActionDescriptorSchema.nullable(),
  decision: DecisionLabelSchema.nullable(),
  reason_code: z.string().nullable(),
  reason_detail: z.string().nullable(),
  tx_signature: z.string().nullable(),
  log_index: z.number().int().nullable(),
  slot: z.number().int().nullable(),
  block_time: z.string().datetime().nullable(),
  amount_lamports: z.number().int().nullable(),
  amount_token: z.number().int().nullable(),
  asset_mint: z.string().nullable(),
  source: z.string().nullable(),
  destination: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  merkle_root_committed: z.string().nullable(),
  created_at: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// ─── HTTP DTOs ────────────────────────────────────────────────────

// Auth: POST /auth/challenge
export const AuthChallengeRequestSchema = z.object({
  wallet: z.string(),
});
export type AuthChallengeRequest = z.infer<typeof AuthChallengeRequestSchema>;

export const AuthChallengeResponseSchema = z.object({
  challenge: z.string(),
  expires_at: z.number().int(),
});
export type AuthChallengeResponse = z.infer<typeof AuthChallengeResponseSchema>;

// Auth: POST /auth/verify
export const AuthVerifyRequestSchema = z.object({
  wallet: z.string(),
  challenge: z.string(),
  signature: z.string(),
});
export type AuthVerifyRequest = z.infer<typeof AuthVerifyRequestSchema>;

export const AuthVerifyResponseSchema = z.object({
  token: z.string(),
  expires_at: z.number().int(),
  operator: OperatorObjectSchema,
});
export type AuthVerifyResponse = z.infer<typeof AuthVerifyResponseSchema>;

// Agents: POST /agents
export const RegisterAgentRequestSchema = z.object({
  name: z.string().min(1).max(64),
  framework: FrameworkSchema,
  model_commitment: z.string().regex(/^[0-9a-f]{64}$/),
  policy: PolicyObjectSchema,
  substrate: SubstrateSchema.optional(),
  // Session-key custody: the operator generates a Keypair client-side and
  // sends ONLY the pubkey. The backend never sees the secret. The pubkey
  // gets registered as a Swig authority; the operator holds the secret.
  session_key_pubkey: z.string().min(32).max(44),
});
export type RegisterAgentRequest = z.infer<typeof RegisterAgentRequestSchema>;

// Backend no longer returns the session-key secret — it doesn't have it.
// The shape is kept slim; if a caller needs the pubkey it's already on the
// embedded AgentObject.
export const RegisterAgentResponseSchema = z.object({
  agent: AgentObjectSchema,
});
export type RegisterAgentResponse = z.infer<typeof RegisterAgentResponseSchema>;

// Agents: PATCH /agents/:id
export const UpdateAgentRequestSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  policy: PolicyObjectSchema.optional(),
});
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequestSchema>;

// Agents: POST /agents/:id/revoke
export const RevokeAgentRequestSchema = z.object({
  reason_code: z.string().min(1).max(64),
  reason_detail: z.string().max(512).optional(),
});
export type RevokeAgentRequest = z.infer<typeof RevokeAgentRequestSchema>;

// SDK: POST /sdk/agent_check
export const SdkAgentCheckRequestSchema = z.object({
  agent_id: z.string().uuid(),
  action: ActionDescriptorSchema,
  context: z.record(z.unknown()).optional(),
});
export type SdkAgentCheckRequest = z.infer<typeof SdkAgentCheckRequestSchema>;

export const SdkAgentCheckResponseSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  reason_code: z.string().optional(),
  audit_event_id: z.string().uuid(),
});
export type SdkAgentCheckResponse = z.infer<typeof SdkAgentCheckResponseSchema>;

// SDK: POST /sdk/heartbeat
export const SdkHeartbeatRequestSchema = z.object({
  agent_id: z.string().uuid(),
  status: z.enum(["healthy", "degraded", "stopped"]),
  metrics: z.record(z.unknown()).optional(),
});
export type SdkHeartbeatRequest = z.infer<typeof SdkHeartbeatRequestSchema>;

// Generic error envelope returned by all routes on 4xx/5xx
export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  detail: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

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
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "AltheiaConnectionError";
  }
}
