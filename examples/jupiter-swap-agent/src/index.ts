/**
 * jupiter-swap-agent — mainnet Jupiter v6 swap wrapped by altheia.guard().
 *
 * Three actions in sequence prove the trust contract end-to-end:
 *   [1] under-cap swap   → ALLOWED, real on-chain swap, Solscan-linkable
 *   [2] over-cap swap    → DENIED before the wallet signs (policy enforcement)
 *   [3] under-cap swap   → ALLOWED again, agent stays healthy after a deny
 *
 * The denied step proves the kill-switch: PolicyDeniedError throws before
 * jupiter.swap() ever runs, so the keypair never signs and nothing lands.
 *
 * Setup (~5 min):
 *   1. Register an agent at altheia.xyz/dashboard with this policy:
 *        asset_caps:        { SOL: { max_per_tx: 0.01, max_per_day: 0.05 } }
 *        allowed_programs:  ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"]
 *      Copy the agentPda + apiKey from the registration modal.
 *   2. Generate a clean mainnet keypair, fund with ~0.05 SOL + a tiny bit
 *      of USDC for gas headroom.
 *   3. Run:
 *        ALTHEIA_AGENT_PDA=<pda> \
 *        ALTHEIA_API_KEY=<alth_sk_…> \
 *        ALTHEIA_DEMO_KEYPAIR=<base58 secret key> \
 *        SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<key> \
 *        pnpm demo
 *
 * Cost per run: ~0.012 SOL in actual swaps + 2× tx fees. ~$2.50 at $200/SOL.
 */

import { Altheia, PolicyDeniedError, type ActionDescriptor } from "@altheia-xyz/sdk";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const LAMPORTS_PER_SOL = 1_000_000_000;

// Invariant tracker: counts how many times jupiterSwap actually runs.
// Demo asserts at the end that this count matches expected (2 — steps 1 + 3).
// If a denied step's fn() runs, this catches the kill-switch failure visibly.
let jupiterSwapInvocationCount = 0;

const AGENT_PDA = process.env.ALTHEIA_AGENT_PDA;
const API_KEY = process.env.ALTHEIA_API_KEY;
const KEYPAIR_SECRET = process.env.ALTHEIA_DEMO_KEYPAIR;
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

interface JupQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  routePlan: unknown[];
}

interface JupSwap {
  swapTransaction: string;
  lastValidBlockHeight: number;
}

async function jupiterQuote(inputMint: string, outputMint: string, amount: number): Promise<JupQuote> {
  const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status}`);
  return (await res.json()) as JupQuote;
}

async function jupiterSwap(
  conn: Connection,
  payer: Keypair,
  inputMint: string,
  outputMint: string,
  lamports: number,
): Promise<string> {
  jupiterSwapInvocationCount += 1;
  const quote = await jupiterQuote(inputMint, outputMint, lamports);

  const swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: payer.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap-tx build failed: ${swapRes.status}`);
  const swap = (await swapRes.json()) as JupSwap;

  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
  tx.sign([payer]);
  const sig = await conn.sendTransaction(tx, { maxRetries: 3 });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n${label}`);
  try {
    await fn();
  } catch (err) {
    if (err instanceof PolicyDeniedError) {
      console.log(`  ✗ DENIED [${err.reasonCode ?? "policy"}] ${err.reason}`);
      console.log(`    └─ wallet never signed, nothing landed on chain`);
    } else {
      console.log(`  ! ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Pre-flight check that prints the policy decision before guard() runs.
 * If the actual decision doesn't match the expected outcome, return false so
 * the caller can abort the step. Without this, a backend bug that incorrectly
 * allows an over-cap action would silently land a real swap on chain — i.e.
 * the kill-switch demo would lie to the audience.
 */
async function preFlightCheck(
  altheia: Altheia,
  action: ActionDescriptor,
  expected: "allow" | "deny",
): Promise<boolean> {
  const decision = await altheia.check(action);
  const got = decision.allowed ? "allow" : "deny";
  const reasonCode = decision.reason_code ?? "—";
  console.log(`  pre-flight: decision=${got} [${reasonCode}] ${decision.reason ?? ""}`);
  if (got !== expected) {
    console.error(`  ⚠️  INVARIANT VIOLATED: expected ${expected}, got ${got}`);
    console.error(`  ⚠️  Aborting step — refusing to risk a silent demo failure.`);
    console.error(`  ⚠️  Investigate: backend policy eval, Swig scope sync, API key match.`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  if (!AGENT_PDA || !API_KEY || !KEYPAIR_SECRET) {
    console.error("missing env: ALTHEIA_AGENT_PDA, ALTHEIA_API_KEY, ALTHEIA_DEMO_KEYPAIR");
    console.error("see header comment for setup.");
    process.exit(1);
  }

  const payer = Keypair.fromSecretKey(bs58.decode(KEYPAIR_SECRET));
  const conn = new Connection(RPC_URL, "confirmed");
  const altheia = new Altheia({ agentPda: AGENT_PDA, apiKey: API_KEY });

  console.log("┌──────────────────────────────────────────────────────────────");
  console.log("│  Altheia + Jupiter v6 — mainnet swap demo");
  console.log("├──────────────────────────────────────────────────────────────");
  console.log(`│  agent  : ${AGENT_PDA.slice(0, 4)}…${AGENT_PDA.slice(-4)}`);
  console.log(`│  wallet : ${payer.publicKey.toBase58()}`);
  console.log(`│  rpc    : ${RPC_URL.split("?")[0]}`);
  console.log("│  policy : SOL max_per_tx 0.01, allowed_programs [JUP6Lk…]");
  console.log("└──────────────────────────────────────────────────────────────");

  const action1: ActionDescriptor = { type: "swap", amount: 0.005, asset: "SOL", target: JUPITER_V6 };
  const action2: ActionDescriptor = { type: "swap", amount: 0.05, asset: "SOL", target: JUPITER_V6 };

  // [1] Under-cap swap (0.005 SOL → USDC) — should be ALLOWED, real swap.
  await step("[1] swap 0.005 SOL → USDC (under cap) — should be ALLOWED:", async () => {
    if (!(await preFlightCheck(altheia, action1, "allow"))) return;
    const sig = await altheia.guard(action1, () =>
      jupiterSwap(conn, payer, SOL_MINT, USDC_MINT, 0.005 * LAMPORTS_PER_SOL),
    );
    console.log(`  ✓ ALLOWED — tx ${sig}`);
    console.log(`    https://solscan.io/tx/${sig}`);
  });

  // [2] Over-cap swap (0.05 SOL → USDC) — should be DENIED, no tx.
  await step("[2] swap 0.05 SOL → USDC (5× over cap) — should be DENIED:", async () => {
    if (!(await preFlightCheck(altheia, action2, "deny"))) return;
    await altheia.guard(action2, () =>
      jupiterSwap(conn, payer, SOL_MINT, USDC_MINT, 0.05 * LAMPORTS_PER_SOL),
    );
  });

  // [3] Under-cap swap again — agent still healthy after deny.
  await step("[3] swap 0.005 SOL → USDC again — agent stays healthy after deny:", async () => {
    if (!(await preFlightCheck(altheia, action1, "allow"))) return;
    const sig = await altheia.guard(action1, () =>
      jupiterSwap(conn, payer, SOL_MINT, USDC_MINT, 0.005 * LAMPORTS_PER_SOL),
    );
    console.log(`  ✓ ALLOWED — tx ${sig}`);
    console.log(`    https://solscan.io/tx/${sig}`);
  });

  // Kill-switch invariant: jupiterSwap should have run exactly twice (steps 1 + 3).
  // If it ran 3 times, step [2]'s fn() executed despite the deny — kill switch failed.
  // If it ran 0 or 1 times, the demo's allowed steps didn't actually swap on chain.
  console.log("\n┌──────────────────────────────────────────────────────────────");
  console.log("│  invariant check: jupiterSwap fn() was called " + jupiterSwapInvocationCount + " time(s)");
  if (jupiterSwapInvocationCount === 2) {
    console.log("│  ✓ kill-switch held: denied step's fn() did NOT run");
  } else {
    console.error("│  ⚠️  KILL-SWITCH INVARIANT VIOLATED: expected 2 calls, got " + jupiterSwapInvocationCount);
    console.error("│  ⚠️  Either a denied step ran fn(), or an allowed step didn't.");
    console.error("│  ⚠️  Do NOT publish this demo recording.");
    process.exitCode = 1;
  }
  console.log("├──────────────────────────────────────────────────────────────");
  console.log("│  open the chronicle:");
  console.log(`│    https://altheia.xyz/agents/${AGENT_PDA}`);
  console.log("│  expect: 2 action_allowed rows (with real sigs), 1 action_denied row");
  console.log("└──────────────────────────────────────────────────────────────\n");
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error("fatal:", err);
    process.exit(1);
  });
}
