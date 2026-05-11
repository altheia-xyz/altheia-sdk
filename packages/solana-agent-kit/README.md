# `@altheia-xyz/solana-agent-kit`

**AI agents you can fire — Solana Agent Kit adapter.**

📖 Docs: [docs.altheia.xyz](https://docs.altheia.xyz)

Altheia adapter for [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) (SendAI). Wraps a SAK instance so every action — swap, transfer, deposit, borrow, mint, etc. — is gated by Altheia policy and recorded in the audit trail.

## Install

```bash
pnpm add solana-agent-kit @altheia-xyz/solana-agent-kit
```

## Use

```ts
import { SolanaAgentKit } from "solana-agent-kit";
import { withAltheia } from "@altheia-xyz/solana-agent-kit";

const agent = withAltheia(
  new SolanaAgentKit(privateKey, rpcUrl),
  {
    agentPda: process.env.ALTHEIA_AGENT_PDA!,
    apiKey:   process.env.ALTHEIA_API_KEY!,
  }
);

// All SAK actions now go through altheia.guard transparently
await agent.transfer(toPubkey, 0.5, USDC_MINT);
await agent.trade(SOL_MINT, 0.05, USDC_MINT); // mainnet only — see note
```

## Note: `trade()` is mainnet-only

SAK's `trade()` calls Jupiter v6 (`https://quote-api.jup.ag/v6/swap`) which doesn't have a devnet route table. If you initialize SAK with a devnet RPC and call `trade()`, the swap will fail because Jupiter returns mainnet account addresses that don't exist on devnet.

For devnet swap demos, use Orca Whirlpools directly with `altheia.guard()` (see `examples/orca-swap-agent`). For mainnet, SAK works as documented.

`transfer()` works on both networks — it's an SPL token transfer, no aggregator needed.

## Status

`v0.0.2` — alpha. Mainnet ready (unaudited).

License: Apache-2.0.
