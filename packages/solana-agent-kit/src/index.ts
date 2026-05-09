/**
 * @altheia-xyz/solana-agent-kit — gate every Solana Agent Kit (SAK) action through Altheia.
 *
 * Wraps a SAK instance so action methods (transfer, trade, etc.) go through
 * `altheia.guard()` — pre-flight policy check + audit emission + on-chain
 * enforcement (via Swig session-key scope). Read methods (get*, fetch*, list*)
 * pass through without guard. Unknown methods pass through with an optional
 * `onAction` callback so consumers can log/inspect them.
 *
 * Usage:
 *
 *   import { SolanaAgentKit } from "solana-agent-kit";
 *   import { withAltheia } from "@altheia-xyz/solana-agent-kit";
 *
 *   const sak = new SolanaAgentKit(privateKey, rpcUrl);
 *   const agent = withAltheia(sak, { agentId: process.env.ALTHEIA_AGENT_ID! });
 *
 *   // Now gated:
 *   await agent.transfer(toPubkey, 50, USDC_MINT);
 *   await agent.trade(SOL_MINT, 0.5, USDC_MINT);
 */

import {
  Altheia,
  type AltheiaConfig,
  type ActionDescriptor,
  PolicyDeniedError,
} from "@altheia-xyz/sdk";

type ActionMapper = (args: unknown[]) => ActionDescriptor | null;

export interface WithAltheiaOptions {
  /** Custom action mappers, keyed by SAK method name. Merged over defaults. */
  actionMap?: Record<string, ActionMapper>;
  /** Predicate for methods that should bypass guard. Default: get/fetch/list prefixes. */
  passthrough?: (methodName: string) => boolean;
  /** Per-call event hook — useful for demo voice-over logging. */
  onAction?: (event: AdapterEvent) => void;
}

export type AdapterEvent =
  | { method: string; action: ActionDescriptor; outcome: "allowed"; auditEventId?: string }
  | { method: string; action: ActionDescriptor; outcome: "denied"; reason: string; reasonCode?: string }
  | { method: string; outcome: "passthrough" }
  | { method: string; action: ActionDescriptor; outcome: "error"; error: string };

const DEFAULT_PASSTHROUGH = (m: string) =>
  m.startsWith("get") ||
  m.startsWith("fetch") ||
  m.startsWith("list") ||
  m === "wallet" ||
  m === "connection" ||
  m === "publicKey";

const DEFAULT_ACTION_MAP: Record<string, ActionMapper> = {
  // SAK transfer(to, amount, mint?) → Altheia transfer
  transfer: (args) => {
    const [to, amount, mint] = args as [string?, number?, string?];
    if (typeof amount !== "number") return null;
    return {
      type: "transfer",
      amount,
      ...(mint ? { asset: mint } : { asset: "SOL" }),
      ...(to ? { target: to } : {}),
    };
  },
  // SAK trade(outputMint, inputAmount, inputMint?, slippageBps?) → Altheia swap
  // target is the Jupiter aggregator program (always Jupiter v6 in SAK).
  trade: (args) => {
    const [outputMint, inputAmount, inputMint] = args as [string?, number?, string?, number?];
    if (typeof inputAmount !== "number") return null;
    return {
      type: "swap",
      amount: inputAmount,
      ...(inputMint ? { asset: inputMint } : { asset: "SOL" }),
      ...(outputMint
        ? { target: outputMint, metadata: { aggregator: "jupiter-v6" } }
        : { metadata: { aggregator: "jupiter-v6" } }),
    };
  },
  // Add more SAK methods via opts.actionMap.
  // ActionDescriptor.type is restricted to: transfer | swap | sign | invoke | inference | custom.
};

/**
 * Wrap a SAK instance so action methods route through `altheia.guard()`.
 *
 * @param sak                   Any SAK-shaped object.
 * @param altheiaOrConfig       An existing Altheia instance OR an AltheiaConfig.
 * @param opts                  Custom mappers, passthrough rules, event hook.
 */
export function withAltheia<T extends object>(
  sak: T,
  altheiaOrConfig: Altheia | AltheiaConfig,
  opts: WithAltheiaOptions = {},
): T {
  const altheia =
    altheiaOrConfig instanceof Altheia
      ? altheiaOrConfig
      : new Altheia(altheiaOrConfig);
  const actionMap = { ...DEFAULT_ACTION_MAP, ...(opts.actionMap ?? {}) };
  const passthrough = opts.passthrough ?? DEFAULT_PASSTHROUGH;
  const emit = opts.onAction ?? (() => undefined);

  // CQ-3 + CQ-5: cache wrapped methods so `guarded.transfer === guarded.transfer`
  // (identity-stable) and we don't allocate a fresh closure on every property access.
  const wrapperCache = new Map<string, (...args: unknown[]) => unknown>();

  function buildWrapper(methodName: string, fn: Function): (...args: unknown[]) => unknown {
    if (passthrough(methodName)) {
      return fn.bind(sak) as (...args: unknown[]) => unknown;
    }
    const mapper = actionMap[methodName];
    if (!mapper) {
      return (...args: unknown[]) => {
        emit({ method: methodName, outcome: "passthrough" });
        return fn.apply(sak, args);
      };
    }
    return async (...args: unknown[]) => {
      const action = mapper(args);
      if (!action) {
        emit({ method: methodName, outcome: "passthrough" });
        return fn.apply(sak, args);
      }
      try {
        const result = await altheia.guard(action, () => fn.apply(sak, args));
        emit({ method: methodName, action, outcome: "allowed" });
        return result;
      } catch (err) {
        if (err instanceof PolicyDeniedError) {
          emit({
            method: methodName,
            action,
            outcome: "denied",
            reason: err.reason,
            ...(err.reasonCode ? { reasonCode: err.reasonCode } : {}),
          });
        } else {
          const message = err instanceof Error ? err.message : String(err);
          emit({ method: methodName, action, outcome: "error", error: message });
        }
        throw err;
      }
    };
  }

  return new Proxy(sak, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const methodName = String(prop);
      const cached = wrapperCache.get(methodName);
      if (cached) return cached;
      const wrapped = buildWrapper(methodName, value as Function);
      wrapperCache.set(methodName, wrapped);
      return wrapped;
    },
  });
}

export { Altheia, PolicyDeniedError } from "@altheia-xyz/sdk";
export type { AltheiaConfig, ActionDescriptor } from "@altheia-xyz/sdk";
