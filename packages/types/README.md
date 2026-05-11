# `@altheia-xyz/types`

**AI agents you can fire — shared types.**

📖 Docs: [docs.altheia.xyz](https://docs.altheia.xyz)

TypeScript types + zod schemas for [Altheia](https://altheia.xyz).

Consumed internally by [`@altheia-xyz/sdk`](../sdk/), [`@altheia-xyz/mcp`](../mcp/), [`@altheia-xyz/solana-agent-kit`](../solana-agent-kit/), and the closed-source backend.

```bash
pnpm add @altheia-xyz/types zod
```

```ts
import {
  PolicyObject,
  PolicyObjectSchema,
  ActionDescriptor,
  Decision,
  PolicyDeniedError,
} from "@altheia-xyz/types";
```

License: Apache-2.0.
