# `@altheia-xyz/solana-agent-kit`

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
  new SolanaAgentKit({
    /* SAK config */
  }),
  {
    apiKey: process.env.ALTHEIA_API_KEY!,
    agentId: process.env.ALTHEIA_AGENT_ID!,
  }
);

// All SAK actions now go through Altheia.guard transparently
await agent.swap({
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: 50_000_000,
});
```

## Status

`v0.0.1-alpha` — scaffold. Action interception lands across the next commits.

License: Apache-2.0.
