import { describe, it, expect } from "vitest";
import {
  ActionDescriptorSchema,
  PolicyObjectSchema,
  AgentObjectSchema,
  OperatorObjectSchema,
  AuditEventSchema,
  AuditEventTypeSchema,
  AuthChallengeRequestSchema,
  AuthVerifyRequestSchema,
  AuthVerifyResponseSchema,
  RegisterAgentRequestSchema,
  RegisterAgentResponseSchema,
  UpdateAgentRequestSchema,
  RevokeAgentRequestSchema,
  SdkAgentCheckRequestSchema,
  SdkAgentCheckResponseSchema,
  SdkHeartbeatRequestSchema,
  ApiErrorSchema,
  PolicyDeniedError,
  AltheiaConnectionError,
} from "./index.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const SHA256 = "a".repeat(64);
const UUID = "11111111-2222-3333-4444-555555555555";
const NOW = new Date().toISOString();

describe("@altheia/types", () => {
  describe("ActionDescriptor", () => {
    it("parses a minimal transfer action", () => {
      const r = ActionDescriptorSchema.parse({ type: "transfer", amount: 100 });
      expect(r.type).toBe("transfer");
    });
    it("rejects unknown action type", () => {
      expect(() => ActionDescriptorSchema.parse({ type: "fly" })).toThrow();
    });
  });

  describe("PolicyObject", () => {
    it("accepts asset_caps + allowed_programs", () => {
      const r = PolicyObjectSchema.parse({
        asset_caps: { [USDC]: { max_per_tx: 100, max_per_day: 500 } },
        allowed_programs: [JUPITER],
      });
      expect(r.allowed_programs).toEqual([JUPITER]);
    });
    it("rejects negative caps", () => {
      expect(() =>
        PolicyObjectSchema.parse({ max_per_tx_usd: -1 }),
      ).toThrow();
    });
  });

  describe("AgentObject", () => {
    it("round-trips a fully-populated agent", () => {
      const agent = {
        id: UUID,
        operator_id: UUID,
        on_chain_pubkey: "AgEnt".padEnd(44, "1"),
        name: "trader-1",
        framework: "sak" as const,
        status: "active" as const,
        policy: { asset_caps: { [USDC]: { max_per_tx: 50 } } },
        policy_commitment: SHA256,
        model_commitment: SHA256,
        substrate: "swig" as const,
        substrate_account_pubkey: "SwIg".padEnd(44, "1"),
        session_key_pubkey: "SsK".padEnd(44, "1"),
        created_at: NOW,
        updated_at: NOW,
      };
      expect(AgentObjectSchema.parse(agent).name).toBe("trader-1");
    });
  });

  describe("OperatorObject", () => {
    it("accepts nullable email/webhook fields", () => {
      const op = {
        id: UUID,
        wallet_pubkey: "WaLLeT".padEnd(44, "1"),
        display_name: null,
        email: null,
        plan_tier: "free" as const,
        status: "active" as const,
        alert_webhook_url: null,
        alert_slack_webhook: null,
        created_at: NOW,
        updated_at: NOW,
      };
      expect(OperatorObjectSchema.parse(op).plan_tier).toBe("free");
    });
  });

  describe("AuditEvent", () => {
    it("accepts an SDK denied event with no on-chain fields", () => {
      const evt = {
        id: UUID,
        operator_id: UUID,
        agent_id: UUID,
        event_type: "action_denied" as const,
        action_descriptor: { type: "transfer" as const, amount: 700 },
        decision: "denied" as const,
        reason_code: "over_per_tx_cap",
        reason_detail: null,
        tx_signature: null,
        log_index: null,
        slot: null,
        block_time: null,
        amount_lamports: null,
        amount_token: null,
        asset_mint: null,
        source: null,
        destination: null,
        metadata: null,
        merkle_root_committed: null,
        created_at: NOW,
      };
      expect(AuditEventSchema.parse(evt).reason_code).toBe("over_per_tx_cap");
    });
  });

  describe("AuditEventType enum", () => {
    it("includes both Identity Program and Swig event types", () => {
      const all = AuditEventTypeSchema.options;
      expect(all).toContain("agent_registered");
      expect(all).toContain("scope_violation_on_chain");
      expect(all).toContain("session_key_revoked");
    });
  });

  describe("Auth DTOs", () => {
    it("AuthChallengeRequest requires wallet", () => {
      expect(() => AuthChallengeRequestSchema.parse({})).toThrow();
    });
    it("AuthVerifyRequest requires wallet + challenge + signature", () => {
      expect(() =>
        AuthVerifyRequestSchema.parse({ wallet: "x", challenge: "c" }),
      ).toThrow();
    });
    it("AuthVerifyResponse parses with operator + token", () => {
      const op = OperatorObjectSchema.parse({
        id: UUID,
        wallet_pubkey: "x",
        display_name: null,
        email: null,
        plan_tier: "free",
        status: "active",
        alert_webhook_url: null,
        alert_slack_webhook: null,
        created_at: NOW,
        updated_at: NOW,
      });
      const r = AuthVerifyResponseSchema.parse({
        token: "jwt.here",
        expires_at: 1234567890,
        operator: op,
      });
      expect(r.token).toBe("jwt.here");
    });
  });

  describe("Agent CRUD DTOs", () => {
    it("RegisterAgentRequest enforces 64-hex commitment", () => {
      expect(() =>
        RegisterAgentRequestSchema.parse({
          name: "x",
          framework: "sak",
          model_commitment: "tooshort",
          policy: {},
        }),
      ).toThrow();
    });
    it("RegisterAgentRequest happy path", () => {
      const r = RegisterAgentRequestSchema.parse({
        name: "agent-1",
        framework: "sak",
        model_commitment: SHA256,
        policy: { asset_caps: { [USDC]: { max_per_tx: 100 } } },
        session_key_pubkey: "11111111111111111111111111111111",
      });
      expect(r.framework).toBe("sak");
    });
    it("UpdateAgentRequest accepts partial updates", () => {
      const r = UpdateAgentRequestSchema.parse({ name: "renamed" });
      expect(r.policy).toBeUndefined();
    });
    it("RevokeAgentRequest requires reason_code", () => {
      expect(() => RevokeAgentRequestSchema.parse({})).toThrow();
      const r = RevokeAgentRequestSchema.parse({ reason_code: "compromised" });
      expect(r.reason_code).toBe("compromised");
    });
  });

  describe("SDK DTOs", () => {
    it("SdkAgentCheckRequest needs UUID + action", () => {
      const r = SdkAgentCheckRequestSchema.parse({
        agent_id: UUID,
        action: { type: "transfer", amount: 50 },
      });
      expect(r.agent_id).toBe(UUID);
    });
    it("SdkAgentCheckResponse parses allow + deny shapes", () => {
      expect(
        SdkAgentCheckResponseSchema.parse({
          allowed: true,
          audit_event_id: UUID,
        }).allowed,
      ).toBe(true);
      expect(
        SdkAgentCheckResponseSchema.parse({
          allowed: false,
          reason: "over cap",
          reason_code: "over_per_tx_cap",
          audit_event_id: UUID,
        }).allowed,
      ).toBe(false);
    });
    it("SdkHeartbeatRequest enforces status enum", () => {
      expect(() =>
        SdkHeartbeatRequestSchema.parse({ agent_id: UUID, status: "weird" }),
      ).toThrow();
    });
  });

  describe("ApiError", () => {
    it("requires error message, optional code/detail", () => {
      expect(ApiErrorSchema.parse({ error: "boom" }).error).toBe("boom");
      expect(() => ApiErrorSchema.parse({})).toThrow();
    });
  });

  describe("Error classes", () => {
    it("PolicyDeniedError carries reason + audit id", () => {
      const e = new PolicyDeniedError("over cap", "over_per_tx_cap", UUID);
      expect(e.message).toContain("over cap");
      expect(e.auditEventId).toBe(UUID);
    });
    it("AltheiaConnectionError preserves cause", () => {
      const cause = new Error("ECONNREFUSED");
      const e = new AltheiaConnectionError("backend down", cause);
      expect(e.cause).toBe(cause);
    });
  });
});
