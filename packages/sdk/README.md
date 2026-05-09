# `@altheia-xyz/sdk`

The TypeScript SDK for [Altheia](https://altheia.xyz) — the trust + audit layer for AI agents on Solana.

Wrap your agent's actions with `altheia.guard()` and they're checked against your operator policy (off-chain pre-flight) and enforced on-chain at the [Swig](https://github.com/anagrambuild/swig-wallet) session-key signing layer.

## Install

```bash
pnpm add @altheia-xyz/sdk
```

## Use

```ts
import { Altheia } from "@altheia-xyz/sdk";

const altheia = new Altheia({
  apiKey: process.env.ALTHEIA_API_KEY!,
  agentId: process.env.ALTHEIA_AGENT_ID!,
});

const result = await altheia.guard(
  {
    type: "transfer",
    amount: 500,
    asset: "USDC",
    target: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter v6
  },
  async () => {
    // The actual action — only runs if policy allows
    return await jupiter.swap(/* ... */);
  }
);
```

## Status

`v0.0.1-alpha` — scaffold. Public API stubbed; backend integration lands across the next commits.

License: Apache-2.0.
