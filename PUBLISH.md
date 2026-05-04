# Publishing the Altheia packages (SDK-010)

Four packages publish under the `@altheia` scope:

| Package | Depends on |
|---|---|
| `@altheia/types` | nothing |
| `@altheia/sdk` | `@altheia/types` |
| `@altheia/solana-agent-kit` | `@altheia/sdk`, `@altheia/types` |
| `@altheia/mcp` | `@altheia/sdk`, `@altheia/types`, `@modelcontextprotocol/sdk` |

Order matters: dependents publish after their dependencies.

## One-time setup

1. Create the npm scope (free if public):
   ```bash
   npm login
   # follow the prompts; pick "@altheia" as the org/scope when registering
   ```
2. If the `@altheia` scope doesn't exist on npm yet, register it at
   https://www.npmjs.com/orgs/create — pick the **Free Open Source** plan.

## Publish all four

Use **pnpm publish** (not `npm publish`) so `workspace:*` deps get rewritten
to real semver versions:

```bash
cd altheia-sdk

# 1. Build everything fresh (publishing dist/ only — make sure it's current)
pnpm -r build

# 2. Publish in dependency order
cd packages/types && pnpm publish --access public --no-git-checks
cd ../sdk && pnpm publish --access public --no-git-checks
cd ../solana-agent-kit && pnpm publish --access public --no-git-checks
cd ../mcp && pnpm publish --access public --no-git-checks
```

Flags:
- `--access public` — required for scoped packages on the free tier
- `--no-git-checks` — pnpm's safety check that the working tree is clean.
  Set this if you've made un-tagged commits since the last release. For a
  first publish from a fresh clone you can drop this.

## Verify

```bash
# Confirm each package is on npm
npm view @altheia/types version
npm view @altheia/sdk version
npm view @altheia/solana-agent-kit version
npm view @altheia/mcp version

# Smoke-test the MCP server
ALTHEIA_AGENT_ID=00000000-0000-0000-0000-000000000000 \
ALTHEIA_BACKEND=http://localhost:3001 \
npx -y @altheia/mcp
```

`npx -y @altheia/mcp` should print the missing-agent-id error or boot
silently if all env vars are set.

## After publish

The landing page's Integrations band copy ("`npx @altheia/mcp`") becomes
truthful for the first time. Update the demo recording script if needed.

## Versioning during the hackathon

All four start at `0.0.1`. Bump `patch` for fixes (`0.0.2`, `0.0.3`)
during the recording window. Don't go to `0.1.0` unless you intentionally
break SDK consumer contracts.

```bash
# Bump patch + republish a single package
cd packages/sdk
npm version patch
pnpm publish --access public --no-git-checks
```

## What if I want to publish from CI later

Add an `npm` token to GitHub Actions:
1. `npm token create --read-only=false` (publish token)
2. Add as `NPM_TOKEN` repo secret
3. CI step: `npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN && pnpm -r publish --access public --no-git-checks`

This is Phase 2 polish; not needed for the hackathon submission.
