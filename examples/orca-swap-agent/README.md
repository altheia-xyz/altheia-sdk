# orca-swap-agent — AI agent you can fire (devnet)

Devnet Orca Whirlpools swap, wrapped by `altheia.guard()`. Six scenarios in sequence prove the full operator-control loop end-to-end:

```
[1] over-cap swap        (0.5 SOL on Orca)        → DENIED [over_per_tx_cap]
[2] wrong-program swap   (0.1 SOL on Jupiter v6)  → DENIED [program_not_in_scope]
[3] under-cap Orca swap  (0.05 SOL → devUSDC)     → ALLOWED, real on-chain swap
[4] operator pauses → retry same action            → DENIED [agent_paused]
[5] operator unpauses → retry same action          → ALLOWED, second real swap
[6] operator revokes → retry same action           → DENIED [agent_revoked] (permanent)
```

Every denied step is the kill switch: `PolicyDeniedError` throws **before** Orca ever runs, so the keypair never signs and nothing lands on chain. The SDK runs in `failureMode: "closed"` — if the backend is unreachable, denials still halt rather than fail-open.

## Roles

The script holds **no operator secrets**:

- **Operator** (you, in the dashboard via Phantom): registers the agent up front, then clicks **Pause** at step [4], **Unpause** at step [5], **Revoke** at step [6]. Your operator wallet's private key never leaves Phantom.
- **Agent** (this script): does `agent_check` + the two real Orca swaps in steps [3] and [5]. Signs with the **session keypair** revealed at registration (saved from the reveal modal).

Steps [4][5][6] each pause for a keystroke. Switch to the dashboard, click the action, wait for Phantom to confirm, hit Enter — script retries and shows the expected outcome.

## Cost per run

Devnet. Two real swaps × ~0.052 SOL each = ~0.11 SOL per rehearsal. Top up the session-key wallet to ~0.2 SOL beforehand. Operator wallet needs ~0.01 SOL for 4 Phantom-signed lifecycle txs (register, pause, unpause, revoke). No real value at risk.

## Setup

### 1. Register an agent at [altheia.xyz/dashboard](https://altheia.xyz/dashboard)

Use this policy:

| Field | Value |
|---|---|
| `asset_caps` | `{ SOL: { max_per_tx: 0.2, max_per_day: 1.0 }, USDC: { max_per_tx: 100, max_per_day: 500 } }` |
| `allowed_programs` | `["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"]` |
| `blocked_destinations` | `[]` |

Copy `agentPda`, `apiKey`, and `sessionKeyBase58` from the registration reveal modal. **That's all you lift from the browser** — no JWT, no operator private key, nothing else.

### 2. Airdrop SOL to the session key's pubkey

The session key from the reveal modal is a fresh keypair with no balance. It's the wallet that signs the Orca swap, so it needs ~1 SOL of devnet gas + swap input.

```bash
solana airdrop 1 <sessionKeyPubkey from the reveal modal> --url devnet
```

(If `solana airdrop` rate-limits, try a few times or use a devnet faucet web UI.)

### 3. Fill `.env` and run

```bash
cd altheia-sdk/examples/orca-swap-agent
cp .env.example .env
# edit .env — paste agentPda, apiKey, sessionKeyBase58
pnpm install   # at repo root if not done already
pnpm demo
```

`tsx --env-file=.env` loads the file automatically. `.env` is git-ignored. The whirlpool address is pre-filled (verified working on devnet) but you can override.

## Expected output

```
┌──────────────────────────────────────────────────────────────
│  Altheia + Orca Whirlpools — devnet swap demo
├──────────────────────────────────────────────────────────────
│  agent  : 6Af2…Eii6
│  wallet : 9xKj…2pQR
│  rpc    : https://api.devnet.solana.com
│  policy : SOL max_per_tx 0.2, allowed_programs [whirLb…, Tokenkeg…]
│  mode   : failureMode=closed (denials halt, no fail-open)
└──────────────────────────────────────────────────────────────

[1] swap 0.5 SOL on Orca (2.5× over cap) — should be DENIED:
  ✗ DENIED [over_per_tx_cap] over_per_tx_cap (0.5 > 0.2 SOL)
    └─ wallet never signed, nothing landed on chain

[2] swap 0.1 SOL on Jupiter v6 (program not allowed) — should be DENIED:
  ✗ DENIED [program_not_in_scope] program JUP6Lk… not in allowlist
    └─ wallet never signed, nothing landed on chain

[3] swap 0.05 SOL on Orca (under cap, allowed program) — should be ALLOWED:
  ✓ ALLOWED — tx 4xK9…Pq2L
    https://solscan.io/tx/4xK9…Pq2L?cluster=devnet

[4] operator pauses via dashboard + retry — should be DENIED [agent_paused]:
  → Pause the agent in the dashboard now: [user clicks Pause + signs]
    Press Enter when pause has landed on chain… [user hits Enter]
    retry the same 0.05 SOL swap on Orca:
  ✗ DENIED [agent_paused] agent paused

[5] operator unpauses via dashboard + retry — should be ALLOWED (back to life):
  → Unpause the agent in the dashboard now: [user clicks Unpause + signs]
    Press Enter when unpause has landed on chain… [user hits Enter]
    retry the same 0.05 SOL swap on Orca:
  ✓ ALLOWED — tx 7QbR…Mn3T
    https://solscan.io/tx/7QbR…Mn3T?cluster=devnet

[6] operator revokes via dashboard + retry — should be DENIED [agent_revoked]:
  → Revoke agent in the dashboard now: [user clicks Revoke + signs]
    Press Enter when revoke agent has landed on chain… [user hits Enter]
    retry the same 0.05 SOL swap on Orca:
  ✗ DENIED [agent_revoked] agent revoked

┌──────────────────────────────────────────────────────────────
│  invariant check: orcaSwap fn() was called 2 time(s)
│  ✓ kill-switch held: 4 denied steps' fn() did NOT run, 2 allowed steps did
├──────────────────────────────────────────────────────────────
│  open the chronicle:
│    http://localhost:5173/agents/<pda>
│  expect: 2 action_allowed rows (real sigs), 4 action_denied rows,
│          plus agent_paused / agent_unpaused / agent_revoked lifecycle rows
└──────────────────────────────────────────────────────────────
```

## What this proves

| Claim | Where it's verified |
|---|---|
| Cap denial fires before signing | Step [1] — no signature, no tx |
| Program filter denies wrong DEX | Step [2] — Jupiter tx never even built |
| Real on-chain swap when policy allows | Step [3] — Solscan devnet tx link |
| Pause is a real soft kill switch | Step [4] — same action that worked at [3] is now denied |
| Unpause brings the agent back to life | Step [5] — second real swap, same action allowed again |
| Revoke is a permanent kill switch | Step [6] — same action denied with no recovery path |
| Audit trail captures every path | `/agents/<pda>` chronicle: 2 allowed + 4 denied + 3 lifecycle rows |
| `altheia.guard()` works with any DEX | This example wraps Orca Whirlpools SDK, no SAK |

## Notes

- **Failure mode is closed:** SDK is constructed with `failureMode: "closed"` so backend outage halts rather than letting actions through. On mainnet you'd weigh this against the Swig on-chain floor — see [SDK README](../../packages/sdk/README.md).
- **Devnet quirks:** Orca devnet pools have thin liquidity; the 0.05 SOL swap will succeed but expect non-trivial slippage. The script uses 50 bps which is usually enough; if it fails with slippage exceeded, raise it or re-run.
- **Whirlpool discovery:** the SOL/devUSDC pool derivation uses Orca's devnet config PDA. If the script fails at pool fetch, pin `WHIRLPOOL_ADDRESS` to the current pool from the Orca devnet UI.
- **Operator key never leaves Phantom:** revoke happens in the dashboard in step [4]; the script pauses for a keystroke. No JWT, no private-key export, no operator secrets in `.env`.

## License

Apache-2.0.
