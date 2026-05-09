# Altheia SDK

*Open-source TypeScript packages for the [Altheia](https://altheia.xyz) trust layer — SDK, MCP server, framework adapters, and shared types.*

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node 22](https://img.shields.io/badge/Node-22-339933.svg)](https://nodejs.org)
[![pnpm 9](https://img.shields.io/badge/pnpm-9-F69220.svg)](https://pnpm.io)

## What this is

Altheia is the trust + audit layer for AI agents on Solana — register your agent, set a per-mint policy, and every action it takes goes through Altheia (off-chain pre-flight via SDK) and on-chain enforcement (via [Swig](https://github.com/anagrambuild/swig-wallet) session-key scope: `TokenRecurringLimit`, `ProgramScope`, etc.). One click revokes the agent permanently.

This monorepo holds the four open-source TypeScript packages developers install. The closed-source backend, dashboard, and audit indexer live elsewhere.

## Packages

| Package | Status | Description |
|---|---|---|
| [`@altheia-xyz/sdk`](packages/sdk) | `0.0.1-alpha` | Core SDK — `guard()`, `check()`, `report()`, `ping()`, `policy()` |
| [`@altheia-xyz/mcp`](packages/mcp) | `0.0.1-alpha` | Standalone MCP server — connects Claude Desktop, Cursor, ChatGPT to your agent fleet |
| [`@altheia-xyz/solana-agent-kit`](packages/solana-agent-kit) | `0.0.1-alpha` | Adapter for [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) (SendAI) |
| [`@altheia-xyz/types`](packages/types) | `0.0.1-alpha` | Shared TypeScript types + zod schemas |

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
