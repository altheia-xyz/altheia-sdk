# jupiter-swap-agent — AI agent you can fire (mainnet)

Mainnet Jupiter v6 swap, wrapped by `altheia.guard()`. Three actions in sequence prove the trust contract end-to-end:

```
[1] under-cap swap (0.005 SOL → USDC)  → ALLOWED, real on-chain swap
[2] over-cap swap  (0.05 SOL → USDC)   → DENIED before the wallet signs
[3] under-cap swap (0.005 SOL → USDC)  → ALLOWED again, agent stays healthy
```

The denied step is the kill switch: `PolicyDeniedError` throws **before** Jupiter ever runs, so the keypair never signs and nothing lands on chain.

## Cost per run

~0.012 SOL (two real swaps + small slippage + fees). At $200/SOL ≈ **$2.50**.

## Setup

### 1. Register an agent at [altheia.xyz/dashboard](https://altheia.xyz/dashboard)

Use this policy:

| Field | Value |
|---|---|
| `asset_caps` | `{ SOL: { max_per_tx: 0.01, max_per_day: 0.05 } }` |
| `allowed_programs` | `["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"]` |

Copy `agentPda` + `apiKey` from the registration reveal modal.

### 2. Generate a fresh mainnet keypair + fund

```bash
solana-keygen new -o ~/.config/solana/altheia-demo.json --no-bip39-passphrase
solana config set --keypair ~/.config/solana/altheia-demo.json --url mainnet-beta
solana address                # send ~0.05 SOL to this from Phantom/exchange
solana balance                # confirm

# Get the base58 secret key for the env var
solana-keygen pubkey ~/.config/solana/altheia-demo.json     # sanity: matches address?
node -e "console.log(require('bs58').encode(require('fs').readFileSync(process.argv[1])))" \
  $(realpath ~/.config/solana/altheia-demo.json)
# ↑ that base58 string is your ALTHEIA_DEMO_KEYPAIR env value
```

### 3. Run the demo

```bash
cd altheia-sdk/examples/jupiter-swap-agent
pnpm install

ALTHEIA_AGENT_PDA=<pda from step 1> \
ALTHEIA_API_KEY=<alth_sk_… from step 1> \
ALTHEIA_DEMO_KEYPAIR=<base58 secret key from step 2> \
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<your helius key> \
  pnpm demo
```

## Expected output

```
┌──────────────────────────────────────────────────────────────
│  Altheia + Jupiter v6 — mainnet swap demo
├──────────────────────────────────────────────────────────────
│  agent  : 6Af2…Eii6
│  wallet : 9xKj…2pQR
│  rpc    : https://mainnet.helius-rpc.com/
│  policy : SOL max_per_tx 0.01, allowed_programs [JUP6Lk…]
└──────────────────────────────────────────────────────────────

[1] swap 0.005 SOL → USDC (under cap) — should be ALLOWED:
  ✓ ALLOWED — tx 4xK9…Pq2L
    https://solscan.io/tx/4xK9…Pq2L

[2] swap 0.05 SOL → USDC (5× over cap) — should be DENIED:
  ✗ DENIED [over_per_tx_cap] amount 0.05 exceeds SOL per-tx cap 0.01
    └─ wallet never signed, nothing landed on chain

[3] swap 0.005 SOL → USDC again — agent stays healthy after deny:
  ✓ ALLOWED — tx 7zR4…Mn8K
    https://solscan.io/tx/7zR4…Mn8K
```

Then open the agent's chronicle: 2 `action_allowed` rows with real signatures, 1 `action_denied` row.

## What this proves

| Claim | Where it's verified |
|---|---|
| Real on-chain swap when policy allows | Solscan tx links |
| Wallet never signs when policy denies | Step [2] — no signature, no tx |
| Audit trail captures both paths | `https://altheia.xyz/agents/<pda>` chronicle |
| Agent doesn't break after a deny | Step [3] succeeds after Step [2] |
| `altheia.guard()` works with any function | This example wraps a raw fetch+sign+send, no SAK |

## Notes

- **Mainnet keypair custody:** the keypair holds real SOL during the run. Fund only what you'll spend (~0.05 SOL is plenty), drain back to your main wallet after.
- **Slippage:** demo uses 50 bps (0.5%). At 0.005 SOL that's ~$0.005 — negligible. If price moves hard mid-run a swap could fail with slippage exceeded; just re-run.
- **Failure mode:** SDK defaults to `failureMode: "open"` — if the Altheia backend is unreachable, the action proceeds. The on-chain Swig session-key scope is the floor that catches over-cap actions regardless. Set `failureMode: "closed"` to halt on outage.

## License

Apache-2.0.
