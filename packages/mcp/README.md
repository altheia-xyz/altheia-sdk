# `@altheia/mcp`

Standalone [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes [Altheia](https://altheia.xyz) tools + resources to any MCP-aware LLM client (Claude Desktop, Cursor, ChatGPT, custom agents).

The LLM operates against your agent fleet through these tools — every action goes through Altheia policy + audit before the agent signs anything on-chain.

## Install

```bash
npx -y @altheia/mcp
```

Or wire it into your client config:

```json
{
  "mcpServers": {
    "altheia": {
      "command": "npx",
      "args": ["-y", "@altheia/mcp"],
      "env": {
        "ALTHEIA_API_KEY": "ak_...",
        "ALTHEIA_AGENT_ID": "..."
      }
    }
  }
}
```

## Tools exposed

| Tool | Maps to | Description |
|---|---|---|
| `altheia_check` | `Altheia.check()` | Pre-flight check whether an action is allowed |
| `altheia_guard` | `Altheia.guard()` | Wrap a tool call so the LLM can't call it without policy approval |
| `altheia_report` | `Altheia.report()` | Log an arbitrary action to the audit trail |
| `altheia_policy` | `Altheia.policy()` | Inspect the current policy in scope |
| `altheia_audit_query` | (read-only) | Query recent audit events for the current agent |

## Resources

| URI | Content |
|---|---|
| `altheia://agent/<id>/policy` | Current PolicyObject |
| `altheia://agent/<id>/audit?limit=20` | Last N audit events |
| `altheia://agent/<id>` | AgentObject |

## Status

`v0.0.1-alpha` — scaffold. Tool/resource implementations land across the next commits.

License: Apache-2.0.
