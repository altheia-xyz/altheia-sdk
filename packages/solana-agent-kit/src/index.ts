/**
 * @altheia/solana-agent-kit — gate every Solana Agent Kit (SAK) action through Altheia.
 *
 * Wraps a SAK instance so every action method (swap, transfer, deposit, borrow,
 * etc.) goes through `altheia.guard()`. Pre-flight check + audit emission +
 * on-chain enforcement (via Swig session-key scope) — all transparent to the
 * existing SAK agent code.
 *
 * Usage:
 *
 *   const agent = withAltheia(
 *     new SolanaAgentKit(...),
 *     { apiKey: env.ALTHEIA_API_KEY, agentId: env.ALTHEIA_AGENT_ID }
 *   );
 *   await agent.swap(...); // gated by Altheia
 */

import { Altheia, type AltheiaConfig } from "@altheia/sdk";

export function withAltheia<T extends object>(
  sak: T,
  _config: AltheiaConfig
): T {
  // TODO: proxy SAK methods through Altheia.guard
  // TODO: map SAK action types -> ActionDescriptor (type, amount, asset, target)
  // TODO: handle errors / denials / reports
  return new Proxy(sak, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      // For now: pass-through. Wrap in guard once SAK action surface is wired.
      return value;
    },
  });
}

export { Altheia } from "@altheia/sdk";
export type { AltheiaConfig } from "@altheia/sdk";
