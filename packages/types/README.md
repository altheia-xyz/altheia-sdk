# `@altheia/types`

Shared TypeScript types + zod schemas for the Altheia trust layer.

Consumed internally by [`@altheia/sdk`](../sdk/), [`@altheia/mcp`](../mcp/), [`@altheia/solana-agent-kit`](../solana-agent-kit/), and the closed-source backend.

```bash
pnpm add @altheia/types zod
```

```ts
import {
  PolicyObject,
  PolicyObjectSchema,
  ActionDescriptor,
  Decision,
  PolicyDeniedError,
} from "@altheia/types";
```

License: Apache-2.0.
