/**
 * E2E-001 — sample SAK agent gated by Altheia.
 *
 * Demo cycle: allow → deny → allow. Proves:
 *   1. Altheia.guard() lets safe actions through
 *   2. Over-cap actions are denied BEFORE the agent's wallet ever signs
 *   3. The agent keeps working after a deny (per-action, not fatal)
 *
 * Backend resolution (env-driven envelope):
 *   ALTHEIA_USE_MOCKSAK=1 (default) → MockSAK, no devnet dependency
 *   ALTHEIA_USE_MOCKSAK=0           → real SolanaAgentKit when installed +
 *                                     ALTHEIA_DEMO_PRIVATE_KEY is set.
 *                                     On any init failure (package missing,
 *                                     bad RPC, bad key) falls back to MockSAK
 *                                     with a console warning so the demo
 *                                     never hard-fails on recording day.
 *
 * Usage:
 *   1. Register an agent in the dashboard with policy:
 *        asset_caps: { USDC: { max_per_tx: 1.0 } }
 *   2. Copy the agent_id from the dashboard URL
 *   3. ALTHEIA_AGENT_ID=<id> ALTHEIA_BACKEND=http://localhost:3001 pnpm demo
 *   4. (optional) ALTHEIA_USE_MOCKSAK=0 ALTHEIA_DEMO_PRIVATE_KEY=<hex> pnpm demo
 *      to exercise the real SAK path on devnet.
 *   5. Watch chronicle in dashboard — denied row appears within 1s.
 */

import { withAltheia, type AdapterEvent } from "@altheia/solana-agent-kit";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";

const AGENT_ID = process.env.ALTHEIA_AGENT_ID;
const BACKEND = process.env.ALTHEIA_BACKEND ?? "http://localhost:3001";

/**
 * MockSAK — a minimal fake of the SAK shape that logs to console instead of
 * actually signing transactions. Lets the demo prove the SDK plumbing without
 * requiring a funded devnet keypair or working Jupiter liquidity.
 *
 * For the real integration, swap in `import { SolanaAgentKit } from "solana-agent-kit"`.
 */
export class MockSAK {
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

interface SakLike {
  transfer(to: string, amount: number, mint?: string): Promise<string>;
  trade(outputMint: string, inputAmount: number, inputMint?: string): Promise<string>;
}

/**
 * Resolve the SAK backend per env. Returns MockSAK by default; tries real SAK
 * only when explicitly opted in. Any failure (package missing, missing key,
 * RPC error) falls back to MockSAK with a console warning.
 */
export async function resolveSak(env: NodeJS.ProcessEnv = process.env): Promise<{
  sak: SakLike;
  kind: "mock" | "real";
}> {
  const useMock = env.ALTHEIA_USE_MOCKSAK !== "0";
  if (useMock) return { sak: new MockSAK(), kind: "mock" };

  const privateKey = env.ALTHEIA_DEMO_PRIVATE_KEY;
  if (!privateKey) {
    console.warn(
      "[sak-trader] ALTHEIA_USE_MOCKSAK=0 but ALTHEIA_DEMO_PRIVATE_KEY missing — falling back to MockSAK",
    );
    return { sak: new MockSAK(), kind: "mock" };
  }

  const rpcUrl = env.ALTHEIA_DEMO_RPC_URL ?? "https://api.devnet.solana.com";
  try {
    // Dynamic import so the package isn't a hard dep — recording-day install:
    //   pnpm --filter @altheia/example-sak-trader add solana-agent-kit
    // @ts-expect-error — package is intentionally not in deps; resolved at runtime
    const mod = (await import("solana-agent-kit")) as {
      SolanaAgentKit: new (privateKey: string, rpcUrl: string, openAiKey?: string) => SakLike;
    };
    const real = new mod.SolanaAgentKit(privateKey, rpcUrl);
    return { sak: real, kind: "real" };
  } catch (err) {
    console.warn(
      `[sak-trader] real SAK init failed (${err instanceof Error ? err.message : String(err)}) — falling back to MockSAK`,
    );
    return { sak: new MockSAK(), kind: "mock" };
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
  if (!AGENT_ID) {
    console.error("missing ALTHEIA_AGENT_ID env var");
    console.error("register an agent in the dashboard first, then re-run with:");
    console.error("  ALTHEIA_AGENT_ID=<uuid> pnpm demo");
    process.exit(1);
  }
  const { sak, kind } = await resolveSak();
  const guarded = withAltheia(
    sak,
    { agentId: AGENT_ID!, endpoint: BACKEND },
    { onAction: emit },
  );

  console.log("┌──────────────────────────────────────────────────────────────");
  console.log("│  Altheia + Solana Agent Kit — E2E-001 demo");
  console.log("├──────────────────────────────────────────────────────────────");
  console.log(`│  agent_id : ${AGENT_ID}`);
  console.log(`│  backend  : ${BACKEND}`);
  console.log(`│  sak mode : ${kind === "real" ? "REAL devnet SAK" : "MockSAK (no devnet dep)"}`);
  console.log("│  policy   : USDC max_per_tx 1.0 (set this in the dashboard)");
  console.log("└──────────────────────────────────────────────────────────────");

  await step("[1] under-cap transfer (0.5 USDC) — should be ALLOWED:", () =>
    guarded.transfer("RecipientPubkey1111111111111111111111111111", 0.5, USDC_MINT),
  );

  await step("[2] over-cap swap (5 USDC → SOL) — should be DENIED, SAK never called:", () =>
    guarded.trade(SOL_MINT, 5, USDC_MINT),
  );

  await step("[3] under-cap swap (0.5 USDC → SOL) — agent still healthy after deny:", () =>
    guarded.trade(SOL_MINT, 0.5, USDC_MINT),
  );

  console.log("\n┌──────────────────────────────────────────────────────────────");
  console.log("│  done. check the chronicle in the dashboard:");
  console.log("│    - 1 action_denied row (from BE-016 on the over-cap swap)");
  console.log(`│    - allowed actions ${kind === "real" ? "land on devnet + audited via webhook" : "logged via MockSAK only"}`);
  console.log("└──────────────────────────────────────────────────────────────\n");
}

// Only run when executed directly, not when imported by tests.
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error("fatal:", err);
    process.exit(1);
  });
}
