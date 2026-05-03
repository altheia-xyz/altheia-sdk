/**
 * E2E-001 — sample SAK agent gated by Altheia.
 *
 * This is the demo agent for the hackathon submission video. It runs a 3-step
 * allow → deny → allow cycle that proves:
 *
 *   1. Altheia.guard() lets safe actions through
 *   2. Over-cap actions are denied BEFORE the agent's wallet ever signs
 *      (the inner SAK method is not called — this is the kill-switch in soft form)
 *   3. The agent keeps working after a deny (denials are per-action, not fatal)
 *
 * The agent uses a MockSAK by default so the demo runs without devnet liquidity
 * dependencies. To run against real Solana Agent Kit + devnet, swap MockSAK for
 * `new SolanaAgentKit(privateKey, rpcUrl)` and uncomment the install line in
 * package.json.
 *
 * Usage:
 *   1. Operator registers an agent in the dashboard with policy:
 *        asset_caps: { USDC: { max_per_tx: 1.0 } }
 *      (so 0.5 USDC is allowed, 5 USDC is denied)
 *   2. Copy the agent_id from the dashboard URL
 *   3. ALTHEIA_AGENT_ID=<id> ALTHEIA_BACKEND=http://localhost:3001 pnpm demo
 *   4. Watch chronicle in dashboard — denied row appears within 1s.
 */

import { withAltheia, type AdapterEvent } from "@altheia/solana-agent-kit";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";

const AGENT_ID = process.env.ALTHEIA_AGENT_ID;
const BACKEND = process.env.ALTHEIA_BACKEND ?? "http://localhost:3001";

if (!AGENT_ID) {
  console.error("missing ALTHEIA_AGENT_ID env var");
  console.error("register an agent in the dashboard first, then re-run with:");
  console.error("  ALTHEIA_AGENT_ID=<uuid> pnpm demo");
  process.exit(1);
}

/**
 * MockSAK — a minimal fake of the SAK shape that logs to console instead of
 * actually signing transactions. Lets the demo prove the SDK plumbing without
 * requiring a funded devnet keypair or working Jupiter liquidity.
 *
 * For the real integration, swap in `import { SolanaAgentKit } from "solana-agent-kit"`.
 */
class MockSAK {
  publicKey = "DemoAgentXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

  // SAK signature: transfer(to, amount, mint?)
  async transfer(to: string, amount: number, mint?: string): Promise<string> {
    console.log(`    └─ MockSAK.transfer(${shorten(to)}, ${amount}, ${mint ?? "SOL"})`);
    return `mock-tx-${Date.now().toString(36)}`;
  }

  // SAK signature: trade(outputMint, inputAmount, inputMint?, slippageBps?)
  async trade(outputMint: string, inputAmount: number, inputMint?: string): Promise<string> {
    console.log(`    └─ MockSAK.trade(${shorten(outputMint)}, ${inputAmount}, ${inputMint ?? "SOL"})`);
    return `mock-swap-${Date.now().toString(36)}`;
  }
}

function shorten(s: string): string {
  return s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s;
}

function emit(e: AdapterEvent): void {
  if (e.outcome === "allowed") {
    const a = e.action;
    console.log(`  ✓ ${e.method} ALLOWED (${a.type} ${a.amount ?? "—"} ${shortenAsset(a.asset)})`);
  } else if (e.outcome === "denied") {
    const a = e.action;
    console.log(`  ✗ ${e.method} DENIED (${a.type} ${a.amount ?? "—"} ${shortenAsset(a.asset)}) ${e.reasonCode ? `[${e.reasonCode}]` : ""}`);
  } else if (e.outcome === "passthrough") {
    console.log(`  → ${e.method} passthrough (no policy mapping)`);
  } else {
    console.log(`  ! ${e.method} ERROR: ${e.error}`);
  }
}

function shortenAsset(asset: string | undefined): string {
  if (!asset) return "";
  if (asset === "SOL") return "SOL";
  if (asset === USDC_MINT) return "USDC";
  if (asset === SOL_MINT) return "SOL";
  return shorten(asset);
}

const sak = new MockSAK();
const guarded = withAltheia(
  sak,
  { agentId: AGENT_ID, endpoint: BACKEND },
  { onAction: emit },
);

async function step(label: string, fn: () => Promise<unknown>): Promise<void> {
  console.log(`\n${label}`);
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error && err.name === "PolicyDeniedError") {
      // Expected for the over-cap step; the onAction emitter already logged the denial.
      console.log(`    [agent caught PolicyDeniedError — action skipped, agent still healthy]`);
    } else {
      console.log(`    [unexpected error: ${err instanceof Error ? err.message : String(err)}]`);
    }
  }
}

async function main(): Promise<void> {
  console.log("┌──────────────────────────────────────────────────────────────");
  console.log("│  Altheia + Solana Agent Kit — E2E-001 demo");
  console.log("├──────────────────────────────────────────────────────────────");
  console.log(`│  agent_id : ${AGENT_ID}`);
  console.log(`│  backend  : ${BACKEND}`);
  console.log("│  policy   : USDC max_per_tx 1.0 (set this in the dashboard)");
  console.log("└──────────────────────────────────────────────────────────────");

  await step("[1] under-cap transfer (0.5 USDC) — should be ALLOWED:", () =>
    guarded.transfer("RecipientPubkey1111111111111111111111111111", 0.5, USDC_MINT),
  );

  await step("[2] over-cap swap (5 USDC → SOL) — should be DENIED, MockSAK never called:", () =>
    guarded.trade(SOL_MINT, 5, USDC_MINT),
  );

  await step("[3] under-cap swap (0.5 USDC → SOL) — agent still healthy after deny:", () =>
    guarded.trade(SOL_MINT, 0.5, USDC_MINT),
  );

  console.log("\n┌──────────────────────────────────────────────────────────────");
  console.log("│  done. check the chronicle in the dashboard:");
  console.log("│    - 1 action_denied row (from BE-016 on the over-cap swap)");
  console.log("│    - allowed actions logged on-chain via Helius webhook");
  console.log("│      (MockSAK doesn't go on-chain; for real on-chain audit,");
  console.log("│       swap MockSAK for SolanaAgentKit and provide a funded keypair)");
  console.log("└──────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
