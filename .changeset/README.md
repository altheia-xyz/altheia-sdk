# Changesets

This repo uses [changesets](https://github.com/changesets/changesets) for versioning + publishing.

## Adding a changeset

```bash
pnpm changeset
```

Pick the affected packages, pick the bump type (patch/minor/major), describe the change. The CLI writes a markdown file here.

## Releasing

CI runs `changeset version` to roll up pending changesets into version bumps + CHANGELOG entries, then `changeset publish` to push to npm.

For Phase 1: manual release until CI is wired up.
