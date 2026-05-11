/**
 * orca-swap-agent — devnet Orca Whirlpools swap wrapped by altheia.guard().
 *
 * Six actions in sequence prove the full operator-control loop end-to-end:
 *   [1] over-cap swap        → DENIED (cap enforcement)
 *   [2] wrong-program swap   → DENIED (program filter)
 *   [3] under-cap Orca swap  → ALLOWED, real on-chain swap on devnet
 *   [4] operator pauses, retry → DENIED [agent_paused]
 *   [5] operator unpauses, retry → ALLOWED, second real on-chain swap
 *   [6] operator revokes, retry → DENIED [agent_revoked] (permanent kill)
 *
 * Every denied step is the kill switch: PolicyDeniedError throws before the
 * Orca swap helper ever runs, so the keypair never signs and nothing lands.
 * The SDK runs with failureMode: "closed" — denials halt; no fail-open.
 *
 * Operator/agent split (no operator secrets in this script):
 *   Operator does register + revoke in the dashboard (Phantom signs).
 *   Agent (this script) does agent_check + the real on-chain Orca swap.
 *   Scenario 4 pauses for the operator to click Revoke in the UI, then
 *   continues. Zero operator credentials touch the process env.
 *
 * Setup (~5 min):
 *   1. Register an agent at altheia.xyz/dashboard (or http://localhost:5173)
 *      with this policy:
 *        asset_caps:        { SOL: { max_per_tx: 0.2, max_per_day: 1.0 },
 *                             USDC: { max_per_tx: 100, max_per_day: 500 } }
 *        allowed_programs:  ["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
 *                            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"]
 *        blocked_destinations: []
 *      Copy agentPda + apiKey from the registration reveal modal.
 *   2. From the reveal modal, ALSO copy the `sessionKeyBase58` — that's the
 *      agent's wallet keypair. The script signs the swap with it. Airdrop
 *      ~1 SOL to its pubkey (visible in the modal too):
 *        solana airdrop 1 <sessionKeyPubkey> --url devnet
 *   3. Fill .env (copy from .env.example), then:
 *        pnpm demo
 *
 * Cost per run: ~0.05 SOL devnet (one real swap + tx fees). Airdroppable.
 */

import { Altheia, PolicyDeniedError, type ActionDescriptor } from "@altheia-xyz/sdk";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  buildDefaultAccountFetcher,
  PDAUtil,
  swapQuoteByInputToken,
  WhirlpoolContext,
  buildWhirlpoolClient,
} from "@orca-so/whirlpools-sdk";
import { Percentage } from "@orca-so/common-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import bs58 from "bs58";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEV_USDC_MINT = "BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k";
const ORCA_WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const LAMPORTS_PER_SOL = 1_000_000_000;

// Invariant tracker: counts how many times orcaSwap actually runs.
// Demo asserts at the end that this count matches expected (1 — only step 3).
// If a denied step's fn() runs, this catches the kill-switch failure visibly.
let orcaSwapInvocationCount = 0;

const AGENT_PDA = process.env.ALTHEIA_AGENT_PDA;
const API_KEY = process.env.ALTHEIA_API_KEY;
const KEYPAIR_SECRET = process.env.ALTHEIA_SESSION_KEY;
const BACKEND = process.env.ALTHEIA_BACKEND ?? "http://localhost:3001";
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const WHIRLPOOL_ADDRESS = process.env.WHIRLPOOL_ADDRESS;

async function orcaSwap(
  conn: Connection,
  payer: Keypair,
  inputMint: PublicKey,
  lamports: number,
): Promise<string> {
  orcaSwapInvocationCount += 1;

  // Whirlpools 0.13's whirlpool.swap() handles native SOL wrap/unwrap internally;
  // no pre-wrap needed. The session-key wallet just needs native SOL.
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });
  const ctx = WhirlpoolContext.withProvider(provider, new PublicKey(ORCA_WHIRLPOOL_PROGRAM));
  const fetcher = buildDefaultAccountFetcher(conn);
  const client = buildWhirlpoolClient(ctx);

  // Pool discovery: prefer explicit WHIRLPOOL_ADDRESS (devnet pools rotate).
  // Fallback to PDAUtil derivation at tickSpacing=64 for SOL/devUSDC.
  let poolAddress: PublicKey;
  if (WHIRLPOOL_ADDRESS) {
    poolAddress = new PublicKey(WHIRLPOOL_ADDRESS);
  } else {
    poolAddress = PDAUtil.getWhirlpool(
      new PublicKey(ORCA_WHIRLPOOL_PROGRAM),
      // Orca devnet config; if this fails set WHIRLPOOL_ADDRESS explicitly.
      new PublicKey("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR"),
      new PublicKey(SOL_MINT),
      new PublicKey(DEV_USDC_MINT),
      64,
    ).publicKey;
  }

  const whirlpool = await client.getPool(poolAddress);

  const quote = await swapQuoteByInputToken(
    whirlpool,
    inputMint,
    new BN(lamports),
    Percentage.fromFraction(50, 10_000), // 50 bps
    ctx.program.programId,
    fetcher,
  );

  const tx = await whirlpool.swap(quote);
  const sig = await tx.buildAndExecute();
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

/** Pause for the operator to perform a dashboard action (pause / unpause / revoke). */
async function waitForOperatorAction(actionLabel: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  console.log(`  → ${actionLabel} the agent in the dashboard now:`);
  console.log(`    http://localhost:5173/agents/${AGENT_PDA}`);
  console.log(`    Click '${actionLabel}', sign with Phantom, wait for confirmation.`);
  await rl.question(`    Press Enter when ${actionLabel.toLowerCase()} has landed on chain… `);
  rl.close();
}

/** Pause between scenarios so the operator can narrate / collect themselves. */
async function pressEnterToContinue(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  await rl.question(`\n→ ${prompt} ⏎ `);
  rl.close();
}

async function main(): Promise<void> {
  if (!AGENT_PDA || !API_KEY || !KEYPAIR_SECRET) {
    console.error("missing env: ALTHEIA_AGENT_PDA, ALTHEIA_API_KEY, ALTHEIA_SESSION_KEY");
    console.error("see header comment for setup.");
    process.exit(1);
  }

  const payer = Keypair.fromSecretKey(bs58.decode(KEYPAIR_SECRET));
  const conn = new Connection(RPC_URL, "confirmed");
  const altheia = new Altheia({
    agentPda: AGENT_PDA,
    apiKey: API_KEY,
    endpoint: BACKEND,
    failureMode: "closed",
    timeoutMs: 5000,
  });

  console.log("┌──────────────────────────────────────────────────────────────");
  console.log("│  Altheia + Orca Whirlpools — devnet swap demo");
  console.log("├──────────────────────────────────────────────────────────────");
  console.log(`│  agent  : ${AGENT_PDA.slice(0, 4)}…${AGENT_PDA.slice(-4)}`);
  console.log(`│  wallet : ${payer.publicKey.toBase58()}`);
  console.log(`│  rpc    : ${RPC_URL.split("?")[0]}`);
  console.log("│  policy : SOL max_per_tx 0.2, allowed_programs [whirLb…, Tokenkeg…]");
  console.log("│  mode   : failureMode=closed (denials halt, no fail-open)");
  console.log("└──────────────────────────────────────────────────────────────");

  const overCap: ActionDescriptor = { type: "swap", amount: 0.5, asset: "SOL", target: ORCA_WHIRLPOOL_PROGRAM };
  const wrongProgram: ActionDescriptor = { type: "swap", amount: 0.1, asset: "SOL", target: JUPITER_V6 };
  const allowed: ActionDescriptor = { type: "swap", amount: 0.05, asset: "SOL", target: ORCA_WHIRLPOOL_PROGRAM };

  // [1] Over-cap swap (0.5 SOL on Orca) — should be DENIED, no tx.
  await pressEnterToContinue("Press Enter to run [1] over-cap swap (expect DENIED)…");
  await step("[1] swap 0.5 SOL on Orca (2.5× over cap) — should be DENIED:", async () => {
    await altheia.guard(overCap, () =>
      orcaSwap(conn, payer, new PublicKey(SOL_MINT), 0.5 * LAMPORTS_PER_SOL),
    );
  });

  // [2] Wrong-program swap (Jupiter v6) — should be DENIED, never built.
  await pressEnterToContinue("Press Enter to run [2] wrong-program swap (expect DENIED)…");
  await step("[2] swap 0.1 SOL on Jupiter v6 (program not allowed) — should be DENIED:", async () => {
    await altheia.guard(wrongProgram, async () => {
      // Never reached; the script never builds a Jupiter tx.
      throw new Error("unreachable: Jupiter path is policy-denied");
    });
  });

  // [3] Under-cap Orca swap (0.05 SOL → devUSDC) — should be ALLOWED, real swap.
  await pressEnterToContinue("Press Enter to run [3] valid swap (expect ALLOWED + real on-chain tx)…");
  await step("[3] swap 0.05 SOL on Orca (under cap, allowed program) — should be ALLOWED:", async () => {
    const sig = await altheia.guard(allowed, () =>
      orcaSwap(conn, payer, new PublicKey(SOL_MINT), 0.05 * LAMPORTS_PER_SOL),
    );
    console.log(`  ✓ ALLOWED — tx ${sig}`);
    console.log(`    https://solscan.io/tx/${sig}?cluster=devnet`);
  });

  // [4] Operator pauses the agent → retry → DENIED [agent_paused].
  console.log("\n[4] operator pauses via dashboard + retry — should be DENIED [agent_paused]:");
  await waitForOperatorAction("Pause");

  await step("    retry the same 0.05 SOL swap on Orca:", async () => {
    await altheia.guard(allowed, () =>
      orcaSwap(conn, payer, new PublicKey(SOL_MINT), 0.05 * LAMPORTS_PER_SOL),
    );
  });

  // [5] Operator unpauses the agent → retry → ALLOWED, second real swap.
  console.log("\n[5] operator unpauses via dashboard + retry — should be ALLOWED (back to life):");
  await waitForOperatorAction("Unpause");

  await step("    retry the same 0.05 SOL swap on Orca:", async () => {
    const sig = await altheia.guard(allowed, () =>
      orcaSwap(conn, payer, new PublicKey(SOL_MINT), 0.05 * LAMPORTS_PER_SOL),
    );
    console.log(`  ✓ ALLOWED — tx ${sig}`);
    console.log(`    https://solscan.io/tx/${sig}?cluster=devnet`);
  });

  // [6] Operator revokes the agent → retry → DENIED [agent_revoked]. Permanent kill.
  console.log("\n[6] operator revokes via dashboard + retry — should be DENIED [agent_revoked]:");
  await waitForOperatorAction("Revoke");

  await step("    retry the same 0.05 SOL swap on Orca:", async () => {
    await altheia.guard(allowed, () =>
      orcaSwap(conn, payer, new PublicKey(SOL_MINT), 0.05 * LAMPORTS_PER_SOL),
    );
  });

  // Kill-switch invariant: orcaSwap should have run exactly TWICE — once at
  // step [3] (initial allow), once at step [5] (post-unpause allow). The three
  // denied steps ([1] over-cap, [2] wrong-program, [4] paused, [6] revoked)
  // must never reach fn().
  console.log("\n┌──────────────────────────────────────────────────────────────");
  console.log("│  invariant check: orcaSwap fn() was called " + orcaSwapInvocationCount + " time(s)");
  if (orcaSwapInvocationCount === 2) {
    console.log("│  ✓ kill-switch held: 4 denied steps' fn() did NOT run, 2 allowed steps did");
  } else {
    console.error("│  ⚠️  KILL-SWITCH INVARIANT VIOLATED: expected 2 calls, got " + orcaSwapInvocationCount);
    console.error("│  ⚠️  Either a denied step ran fn(), or an allowed step didn't.");
    console.error("│  ⚠️  Do NOT publish this demo recording.");
    process.exitCode = 1;
  }
  console.log("├──────────────────────────────────────────────────────────────");
  console.log("│  open the chronicle:");
  console.log(`│    http://localhost:5173/agents/${AGENT_PDA}`);
  console.log("│  expect: 2 action_allowed rows (real sigs), 4 action_denied rows,");
  console.log("│          plus agent_paused / agent_unpaused / agent_revoked lifecycle rows");
  console.log("└──────────────────────────────────────────────────────────────\n");
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((err) => {
    console.error("fatal:", err);
    process.exit(1);
  });
}
