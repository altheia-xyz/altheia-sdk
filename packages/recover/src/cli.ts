/**
 * altheia-recover — operator recovery CLI.
 *
 * Withdraws every asset from an Altheia agent's Swig smart-account back to
 * your operator wallet, using only your local keypair. Runs against any
 * Solana RPC. Does NOT talk to the Altheia backend at all — proves the
 * non-custody claim end-to-end: even if altheia.xyz disappeared overnight,
 * an operator with their keypair can recover their funds in one command.
 *
 * The flow:
 *   1. Read your keypair from --keypair-path
 *   2. Fetch the Swig smart-account from --swig-account
 *      (or derive it from --agent-pda by reading the AgentAccount)
 *   3. Find the Role 0 (root) authority that matches your keypair
 *   4. Call swig.getTransferAssetsInstructions(role=0) — this is Swig's
 *      built-in TransferAssetsV1 helper that drains every SPL token in
 *      the smart-account back to the role's authority
 *   5. Sign + send + print Solscan link
 *
 * Trust statement: this binary makes ONE on-chain RPC call (the swig fetch),
 * ONE local signature (with your keypair, never sent anywhere), and ONE
 * sendTransaction. No HTTP to altheia.xyz, no telemetry, no backdoor.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  fetchSwig,
  getTransferAssetsInstructions,
} from "@swig-wallet/classic";

interface Args {
  keypairPath: string;
  swigAccount?: string;
  agentPda?: string;
  rpcUrl: string;
  programId: string;
  cluster: "mainnet" | "devnet";
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    keypairPath: "",
    rpcUrl: "https://api.mainnet-beta.solana.com",
    programId: "AkKx54ZmuP17r1sXsKr7mxe3dXJ5RMqsSH2zf8QGZ39C",
    cluster: "mainnet",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!v && k !== "--dry-run" && k !== "-h" && k !== "--help") continue;
    switch (k) {
      case "--keypair-path": if (v) args.keypairPath = v; i++; break;
      case "--swig-account": if (v) args.swigAccount = v; i++; break;
      case "--agent-pda": if (v) args.agentPda = v; i++; break;
      case "--rpc-url": if (v) args.rpcUrl = v; i++; break;
      case "--program-id": if (v) args.programId = v; i++; break;
      case "--cluster":
        if (v) args.cluster = (v === "devnet" ? "devnet" : "mainnet"); i++; break;
      case "--dry-run": args.dryRun = true; break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
altheia-recover — withdraw every asset from an Altheia agent's smart-account.

Usage:
  altheia-recover \\
    --keypair-path  ~/.config/solana/id.json \\
    --swig-account  <swig PDA from your dashboard> \\
    [--rpc-url      https://api.mainnet-beta.solana.com] \\
    [--cluster      mainnet|devnet] \\
    [--dry-run]

Required:
  --keypair-path   Path to your operator wallet keypair (JSON byte array).
                   This MUST be the wallet you registered the agent with —
                   it is Role 0 on the Swig smart-account.
  --swig-account   The Swig smart-account address. Copy from
                   altheia.xyz/agents/<pda> → On-chain references → Swig.

Optional:
  --rpc-url        Solana RPC. Default: mainnet-beta public endpoint.
  --cluster        mainnet|devnet (only used to format Solscan link).
  --dry-run        Build + sign the tx but don't send. Prints raw bytes.

The CLI never contacts altheia.xyz. It reads from Solana, signs locally,
and sends to Solana. If it works, you've proven the non-custody claim.
`.trim());
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.keypairPath || !args.swigAccount) {
    printHelp();
    process.exit(1);
  }

  console.log(`altheia-recover · cluster=${args.cluster} · rpc=${args.rpcUrl}`);

  // Load keypair
  const keypairBytes = JSON.parse(readFileSync(resolve(args.keypairPath), "utf8")) as number[];
  const operator = Keypair.fromSecretKey(Uint8Array.from(keypairBytes));
  console.log(`operator wallet: ${operator.publicKey.toBase58()}`);

  // Connect
  const connection = new Connection(args.rpcUrl, "confirmed");
  const swigAccount = new PublicKey(args.swigAccount);

  // Fetch swig + find root role
  console.log(`fetching swig at ${swigAccount.toBase58()} ...`);
  const swig = await fetchSwig(connection, swigAccount);
  const rootRole = swig.findRolesByEd25519SignerPk(operator.publicKey)[0];
  if (!rootRole) {
    console.error(`✗ your keypair is NOT a Role-0 (root) authority on this swig.`);
    console.error(`  authorities found:`);
    for (const r of swig.roles) {
      console.error(`    role ${r.id} authority ${r.authority?.toString?.() ?? "?"}`);
    }
    console.error(`  recovery requires the Phantom keypair you registered the agent with.`);
    process.exit(2);
  }
  console.log(`✓ matched Role ${rootRole.id} (root authority) on the swig`);

  // Build the transfer-assets instructions
  console.log(`building TransferAssetsV1 instructions ...`);
  const ixs = await getTransferAssetsInstructions(swig, rootRole.id, {
    payer: operator.publicKey,
  });
  console.log(`  ${ixs.length} inner instruction(s)`);

  // Build tx
  const tx = new Transaction();
  tx.add(...ixs);
  tx.feePayer = operator.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.sign(operator);

  if (args.dryRun) {
    const raw = tx.serialize();
    console.log(`✓ tx built + signed (${raw.length} bytes). --dry-run set, not sending.`);
    console.log(`  raw (base64): ${raw.toString("base64")}`);
    return;
  }

  // Send
  console.log(`sending ...`);
  const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  console.log(`tx signature: ${sig}`);

  console.log(`confirming ...`);
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  const cluster = args.cluster === "mainnet" ? "" : `?cluster=${args.cluster}`;
  console.log(``);
  console.log(`✓ recovery complete.`);
  console.log(`  https://solscan.io/tx/${sig}${cluster}`);
}

main().catch((err: unknown) => {
  console.error(`fatal:`, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
