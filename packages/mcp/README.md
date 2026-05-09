# `@altheia-xyz/mcp`

Standalone [MCP (Model Context Protocol)](https://modelcontextprotocol.io)
server that exposes [Altheia](https://altheia.xyz)'s policy + audit layer to
any MCP-aware client (Claude Desktop, Cursor, ChatGPT, custom agents).

The LLM operates against your Altheia-registered agent through these tools.
Every action goes through Altheia's pre-flight policy check before the
agent's wallet signs anything on-chain. The on-chain Swig session-key scope
is the floor — even if the LLM ignores the gate, the chain refuses
out-of-policy signatures.

## Install + run

```bash
npx -y @altheia-xyz/mcp
```

Required env:

| Var | Required | Default |
|---|---|---|
| `ALTHEIA_AGENT_ID` | yes | — |
| `ALTHEIA_BACKEND` | no | `https://api.altheia.xyz` |
| `ALTHEIA_API_KEY` | no (Phase 1.5) | — |

## Tools

| Tool | Description |
|---|---|
| `altheia_check` | Synchronous policy decision; no execution, no audit row. Returns the `Decision` (`allowed`, `reason`, `audit_event_id`). |
| `altheia_guard` | Pre-flight gate. Returns `ALLOWED:` or `DENIED:` summary; sets `isError: true` on deny so MCP-aware LLMs short-circuit cleanly. |
| `altheia_report` | Log an action outcome to the audit trail. Best-effort. |
| `altheia_policy` | Fetch the current policy in scope (per-asset caps, allowed programs, etc). |
| `altheia_audit_query` | Query recent audit events. Supports `filter` (`all`/`allowed`/`denied`) + `limit` (1–100). |

## Resources (read-only)

| URI | Content |
|---|---|
| `altheia://agent/<id>` | AgentObject (status, on-chain refs, framework) |
| `altheia://agent/<id>/policy` | Current PolicyObject |
| `altheia://agent/<id>/audit` | Last 50 audit events, most recent first |

## Claude Desktop config

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "altheia": {
      "command": "npx",
      "args": ["-y", "@altheia-xyz/mcp"],
      "env": {
        "ALTHEIA_AGENT_ID": "<uuid from your dashboard>",
        "ALTHEIA_BACKEND": "http://localhost:3001"
      }
    }
  }
}
```

Restart Claude Desktop. The five tools appear in any new chat. Try:
*"Check whether I can transfer 50 USDC, and if allowed, fetch my policy."*

## Cursor config

`.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "altheia": {
      "command": "npx",
      "args": ["-y", "@altheia-xyz/mcp"],
      "env": {
        "ALTHEIA_AGENT_ID": "<uuid>",
        "ALTHEIA_BACKEND": "http://localhost:3001"
      }
    }
  }
}
```

## How an LLM should use these tools

```
User: "Swap 50 USDC to SOL with my agent."

LLM:
  1. altheia_guard({ type: "swap", amount: 50, asset: "EPjF...Dt1v" })
     → "ALLOWED: Action allowed. Proceed, then call altheia_report..."
  2. <run whatever execution tool>
  3. altheia_report({ action, outcome: "success", audit_event_id })
```

If guard returns `DENIED`, the LLM must abort. Even if it tries to skip the
gate, the on-chain Swig scope rejects out-of-policy signatures.

## Failure mode

If the Altheia backend is unreachable, `altheia_check` and `altheia_guard`
fall back to the SDK's fail-open default (action allowed; on-chain substrate
stays the floor). The audit trail catches up via the backend's reconciliation
cron + Helius webhook retries once the backend recovers.

## Build from source

```bash
cd packages/mcp
pnpm install
pnpm build
ALTHEIA_AGENT_ID=<uuid> ALTHEIA_BACKEND=http://localhost:3001 node dist/cli.js
```

## Tests

```bash
pnpm test
```

12 vitest exercising the full server through an in-memory client/server pair
(no stdio overhead). Verifies: tool discovery, resource discovery,
`altheia_check` allow/deny paths, `altheia_guard` `isError` semantics,
`altheia_audit_query` URL + Bearer-header propagation, `altheia_policy`
success + error paths, agent metadata resource read.

## Status

`v0.0.1` — Phase 1 hackathon scaffold. Real auth + retry/cache pass land in Phase 1.5 (SDK-005, SDK-010).

License: Apache-2.0.
