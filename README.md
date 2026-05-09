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

## Packages

| Package | Version | Description |
|---|---|---|
| [`@altheia-xyz/sdk`](packages/sdk) | `0.0.2` | Core SDK — `guard()`, `check()`, `report()`, `ping()`, `policy()` |
| [`@altheia-xyz/mcp`](packages/mcp) | `0.0.2` | Standalone MCP server — connects Claude Desktop, Cursor, ChatGPT to your agent fleet |
| [`@altheia-xyz/solana-agent-kit`](packages/solana-agent-kit) | `0.0.2` | Adapter for [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) (SendAI) |
| [`@altheia-xyz/types`](packages/types) | `0.0.2` | Shared TypeScript types + zod schemas |

Phase 1.5: an `@altheia-xyz/eliza-plugin` adapter lands later (Eliza demoted from Phase 1).

## Local dev

```bash
pnpm install
pnpm build         # build all packages
pnpm dev           # parallel watch mode
pnpm test          # run vitest in all packages
pnpm typecheck     # tsc --noEmit everywhere
```

Cross-package linking is automatic via `workspace:*` — change `packages/types`, `packages/sdk` picks it up immediately.

## Contributing

This is alpha software building toward the Altheia Phase 1 hackathon submission ([Colosseum Frontier 2026](https://www.colosseum.org/)). PRs welcome but expect breakage as we iterate. Issues: ideas, bug reports, integration requests.

## License

Apache 2.0 — see [LICENSE](LICENSE). The SDK + MCP server + adapters + types are open source. The backend, dashboard, and audit indexer are closed source — that's where the platform moat lives.

## Related repos

- [altheia-program](https://github.com/altheia-xyz/altheia-program) — the on-chain Anchor Identity Program
- altheia-backend (private)
- altheia-dashboard (private)
