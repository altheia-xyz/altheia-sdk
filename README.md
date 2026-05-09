# Altheia SDK

**AI agents you can fire.**

*Open-source TypeScript packages for [Altheia](https://altheia.xyz) — SDK, MCP server, framework adapters, shared types.*

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node 22](https://img.shields.io/badge/Node-22-339933.svg)](https://nodejs.org)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220.svg)](https://pnpm.io)

## What this is

Register your agent at [altheia.xyz](https://altheia.xyz), set a per-action policy (asset caps, allowed programs, kill switch), and every action your agent takes goes through Altheia — off-chain pre-flight via the SDK, on-chain enforcement via [Swig](https://github.com/anagrambuild/swig-wallet) session-key scope (`TokenRecurringLimit`, `ProgramScope`, etc).

Revoke in one click. The wallet stops signing immediately. No key rotation, no downtime.

This monorepo holds the four open-source TypeScript packages developers install. The backend, dashboard, and on-chain identity program live elsewhere.

## How it works

```
                ┌─────────────────────────────────────────────────┐
                │  Your AI agent (any framework: SAK, Eliza, MCP) │
                └──────────────────┬──────────────────────────────┘
                                   │ altheia.guard(action, fn)
                                   ▼
                ┌─────────────────────────────────────────────────┐
                │  Altheia SDK — off-chain pre-flight             │
                │   POST /sdk/agent_check → Decision              │
                │   if denied: throw, fn() never runs             │
                │   if allowed: run fn(), report outcome          │
                └──────────────────┬──────────────────────────────┘
                                   │ if allowed
                                   ▼
                ┌─────────────────────────────────────────────────┐
                │  Swig session key — on-chain enforcement floor  │
                │   TokenRecurringLimit · ProgramScope · etc      │
                │   chain rejects out-of-scope signatures         │
                └──────────────────┬──────────────────────────────┘
                                   │ valid
                                   ▼
                            Solana mainnet
```

**Two layers of enforcement.** The SDK is fast (off-chain pre-flight) but trusts the agent runtime. The Swig session-key scope is slow (one tx) but trustless — even a compromised agent can't sign a tx the chain refuses. The kill switch lives in both.

## Packages

| Package | Version | Description |
|---|---|---|
| [`@altheia-xyz/sdk`](packages/sdk) | `0.0.2` | Core SDK — `guard()`, `check()`, `report()`, `ping()`, `policy()` |
| [`@altheia-xyz/mcp`](packages/mcp) | `0.0.2` | Standalone MCP server — connects Claude Desktop, Cursor, ChatGPT to your agent fleet |
| [`@altheia-xyz/solana-agent-kit`](packages/solana-agent-kit) | `0.0.2` | Adapter for [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) (SendAI) |
| [`@altheia-xyz/types`](packages/types) | `0.0.2` | Shared TypeScript types + zod schemas |

## Quickstart (5 min)

### 1. Register an agent

Visit [altheia.xyz/dashboard](https://altheia.xyz/dashboard), sign in with your Solana wallet, click **Register agent**. Set a policy:

```json
{
  "asset_caps": {
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": { "max_per_tx": 100, "max_per_day": 500 }
  },
  "allowed_programs": ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"]
}
```

Copy the `agentPda` and `apiKey` from the registration reveal modal.

### 2. Install + use

```bash
pnpm add @altheia-xyz/sdk
```

```ts
import { Altheia } from "@altheia-xyz/sdk";

const altheia = new Altheia({
  agentPda: process.env.ALTHEIA_AGENT_PDA!,
  apiKey:   process.env.ALTHEIA_API_KEY!,
});

const result = await altheia.guard(
  { type: "swap", amount: 0.5, asset: "USDC", target: "JUP6Lk…" },
  async () => {
    return await jupiter.swap(/* ... */);
  }
);
```

If the policy denies the action, `guard()` throws `PolicyDeniedError` and the callback **never runs** — the wallet doesn't sign, nothing lands on chain.

### 3. Revoke

When you want the agent to stop, click **Revoke** in the dashboard. The Swig session key is invalidated on-chain — every future `guard()` call returns denied, and even if the agent runtime ignores the gate, the chain refuses the signature. No key rotation, no downtime.

## Demo

A working mainnet demo lives in [`examples/jupiter-swap-agent`](examples/jupiter-swap-agent) — three actions in sequence (under-cap → allowed swap, over-cap → denied before signing, under-cap again → agent stays healthy). Real Solscan-linkable signatures on the allowed steps.

```bash
cd examples/jupiter-swap-agent
pnpm install

ALTHEIA_AGENT_PDA=<pda> \
ALTHEIA_API_KEY=<alth_sk_…> \
ALTHEIA_DEMO_KEYPAIR=<base58 secret> \
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<key> \
  pnpm demo
```

Cost per run: ~0.012 SOL (≈ $2.50).

## Local dev (this repo)

```bash
pnpm install
pnpm build         # build all packages
pnpm dev           # parallel watch mode
pnpm test          # run vitest in all packages
pnpm typecheck     # tsc --noEmit everywhere
```

Cross-package linking is automatic via `workspace:*` — change `packages/types`, `packages/sdk` picks it up immediately.

## Status

`v0.0.2` — Solana mainnet ready, **unaudited**. The slim Identity Program (~380 lines) reduces blast radius but doesn't replace an audit. Use real money at your own risk; revoke aggressively when in doubt.

## Submission

Built for [Colosseum Frontier 2026](https://www.colosseum.org/). Category: AI Platforms / Agents. Live: [altheia.xyz](https://altheia.xyz).

## License

Apache 2.0 — see [LICENSE](LICENSE). The SDK + MCP server + adapters + types are open source. The backend, dashboard, and audit indexer are closed source.

## Related repos

- [altheia-program](https://github.com/altheia-xyz/altheia-program) — Anchor Identity Program (PDA-as-identity)
- altheia-backend (private)
- altheia-web (private)
