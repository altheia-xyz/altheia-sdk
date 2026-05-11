# `@altheia-xyz/sdk`

**AI agents you can fire.**

📖 Docs: [docs.altheia.xyz](https://docs.altheia.xyz)

The TypeScript SDK for [Altheia](https://altheia.xyz). Wrap your agent's actions with `altheia.guard()` — they're checked against your operator's policy (off-chain pre-flight) and enforced on-chain at the [Swig](https://github.com/anagrambuild/swig-wallet) session-key signing layer.

Revoke an agent's authority in one click from the dashboard. The wallet stops signing immediately — no key rotation, no downtime.

## Install

```bash
pnpm add @altheia-xyz/sdk
```

## Use

Register an agent at [altheia.xyz/dashboard](https://altheia.xyz/dashboard) — copy the `agentPda` and `apiKey` from the registration modal. Then:

```ts
import { Altheia } from "@altheia-xyz/sdk";

const altheia = new Altheia({
  agentPda: process.env.ALTHEIA_AGENT_PDA!,
  apiKey:   process.env.ALTHEIA_API_KEY!,
  // endpoint defaults to https://api.altheia.xyz — no need to set it
});

const result = await altheia.guard(
  {
    type: "swap",
    amount: 0.5,
    asset: "USDC",
    target: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  },
  async () => {
    // The actual action — only runs if policy allows
    return await jupiter.swap(/* ... */);
  }
);
```

If the policy denies the action, `guard()` throws `PolicyDeniedError` and your callback **never runs** — the wallet doesn't sign, nothing lands on chain.

## Failure modes

By default, `failureMode: "open"` — if the Altheia backend is unreachable, the SDK returns allowed and the agent proceeds. Swig's on-chain scope still catches over-cap actions. Set `failureMode: "closed"` to halt on outage.

## Status

`v0.0.2` — alpha. Public API stable; mainnet ready (unaudited).

License: Apache-2.0.
