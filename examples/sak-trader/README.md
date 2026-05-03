# sak-trader — Altheia + Solana Agent Kit demo (E2E-001)

A 50-line agent that proves Altheia's kill-switch works at the SDK layer.

It runs three actions in sequence:

```
[1] under-cap transfer (0.5 USDC)  → ALLOWED, SAK runs
[2] over-cap swap     (5 USDC)     → DENIED, SAK never called
[3] under-cap swap    (0.5 USDC)   → ALLOWED again, agent is still healthy
```

The kill-switch is the whole point: **on a policy violation, the agent's wallet
never signs**. The deny happens before SAK touches the chain.

## Run it

```bash
# 1. Register an agent in the dashboard with policy:
#      asset_caps: { USDC: { max_per_tx: 1.0 } }

# 2. Copy the agent_id from the dashboard URL

# 3. Run the demo
ALTHEIA_AGENT_ID=<uuid> ALTHEIA_BACKEND=http://localhost:3001 pnpm demo
```

Output looks like:

```
[1] under-cap transfer (0.5 USDC) — should be ALLOWED:
    └─ MockSAK.transfer(Reci…1111, 0.5, EPjF…Dt1v)
  ✓ transfer ALLOWED (transfer 0.5 EPjF…Dt1v)

[2] over-cap swap (5 USDC → SOL) — should be DENIED, MockSAK never called:
  ✗ trade DENIED (swap 5 EPjF…Dt1v) [over_per_tx_cap]
    [agent caught PolicyDeniedError — action skipped, agent still healthy]

[3] under-cap swap (0.5 USDC → SOL) — agent still healthy after deny:
    └─ MockSAK.trade(So11…1112, 0.5, EPjF…Dt1v)
  ✓ trade ALLOWED (swap 0.5 EPjF…Dt1v)
```

## What's in the box

`src/index.ts` (~110 lines) — the agent. Uses `MockSAK` so you don't need a
funded devnet keypair to run the demo. The wrapping pattern is identical to
real SAK:

```ts
const sak = new MockSAK();              // or: new SolanaAgentKit(privateKey, rpc)
const guarded = withAltheia(sak, {
  agentId: process.env.ALTHEIA_AGENT_ID!,
  endpoint: process.env.ALTHEIA_BACKEND ?? "http://localhost:3001",
}, {
  onAction: (e) => { /* log allow/deny/passthrough */ },
});

await guarded.transfer(to, amount, mint);  // gated by altheia.guard()
await guarded.trade(outputMint, amount, inputMint);
```

## To run against real Solana Agent Kit + devnet

1. `pnpm add solana-agent-kit @solana/web3.js`
2. Replace the `MockSAK` import with:

   ```ts
   import { SolanaAgentKit } from "solana-agent-kit";
   const sak = new SolanaAgentKit(privateKeyBase58, "https://api.devnet.solana.com");
   ```

3. Fund the keypair with devnet SOL + a small USDC balance.
4. Re-run.

The chronicle will then populate with real on-chain `transfer_allowed` rows
(via the Helius webhook) for actions that pass the policy check.

## Tests

```bash
pnpm test
```

Verifies the allow → deny → allow cycle plus the critical assertion:
**`expect(sak.tradeCalls).toHaveLength(0)` after a denied action.** That is the
test for "the wallet never signs."
