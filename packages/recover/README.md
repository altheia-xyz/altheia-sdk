# `@altheia-xyz/recover`

**AI agents you can fire — operator recovery CLI.**

Withdraws every asset from an Altheia agent's Swig smart-account back to your operator wallet, **using only your local keypair**. Does NOT talk to the Altheia backend at all. Proves the non-custody claim end-to-end: even if `altheia.xyz` disappeared overnight, an operator with their keypair can recover their funds in one command.

## Use

```bash
npx -y @altheia-xyz/recover \
  --keypair-path ~/.config/solana/id.json \
  --swig-account <Swig PDA from your dashboard> \
  --cluster mainnet
```

What it does, in order:

1. Reads your keypair from `--keypair-path`
2. Connects to your `--rpc-url` (default: mainnet public RPC)
3. Fetches the Swig smart-account on-chain
4. Finds the **Role 0** (root) authority that matches your keypair
5. Calls Swig's built-in `getTransferAssetsInstructions(role=0)` (the `TransferAssetsV1` helper) — this transfers every SPL token in the smart-account back to the role's authority, which is your wallet
6. Signs locally with your keypair, sends to Solana, prints the Solscan link

Total HTTP calls to non-Solana hosts: **zero.** No `altheia.xyz`, no telemetry, no backdoor.

## Where the inputs come from

| Argument | Where to find it |
|---|---|
| `--keypair-path` | Your operator Phantom wallet, exported as a Solana CLI keypair JSON (`solana-keygen export-from-phantom` or write the byte array yourself). This MUST be the wallet you registered the agent with — it's Role 0 on the Swig smart-account. |
| `--swig-account` | `altheia.xyz/agents/<pda>` → On-chain references → "Swig smart-account" address. Or: `agent.substrate_account_pubkey` from the API. |
| `--rpc-url` | Any Solana RPC. Helius, Triton, or the public default. |

## Why this exists

The Altheia trust pitch is "AI agents you can fire." The implicit promise: **you can always get your money back, regardless of what happens to us.** This CLI is the proof. If you're an operator evaluating Altheia and the question "can they hold me hostage?" matters to you, this binary is your answer.

Run it as a dry-run first to confirm the tx shape:

```bash
npx -y @altheia-xyz/recover --keypair-path ~/.config/solana/id.json --swig-account <addr> --dry-run
```

## What it can NOT do

- Recover SOL held by the Swig PDA itself (account rent). For that you'd close the swig entirely via `getCloseSwigInstructions` — separate operation, distinct from "withdraw all assets."
- Recover funds from sub-accounts. Sub-accounts have their own withdraw helpers (`getWithdrawFromSubAccount*Instructions`).
- Help if your operator wallet keypair is lost. There is no recovery from a lost root authority — that's how Solana wallets work.

## Status

`v0.0.1` — alpha. Same trust model as `@altheia-xyz/sdk`.

## License

Apache-2.0.
