# Contributing

Every contribution is welcome: fixes, features, documentation and bug
reports. This guide covers the full flow, from environment setup to the PR.

## Setting up the environment

Requirements: Node.js LTS and pnpm 11. The pnpm version is pinned in the
`packageManager` field of `package.json`; with Corepack enabled, it is used
automatically:

```bash
corepack enable
pnpm install
```

## Developing

```bash
pnpm watch   # bundle into dist/ with watch
# F5 in VS Code: opens the Extension Development Host
```

The extension's architecture (providers, generation flow, settings panel)
is documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). A new
provider is one implementation of the `Provider` interface in
`src/providers/`, registered in `src/providers/registry.ts`.

## Before opening the PR

Run locally the same steps the CI runs:

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome check .
pnpm test        # vitest run
pnpm build       # esbuild
```

New behavior calls for new tests in `tests/` (Vitest). If the change
affects settings, providers or user-visible flows, update `README.md` and
`CHANGELOG.md` in the same PR.

## Commits

We follow [Conventional Commits](https://www.conventionalcommits.org/en/),
in English and with a small scope (atomic commits):

```text
feat: add kimi coding endpoint preset
fix: abort cli process group on cancel
docs: document machine-scoped settings
```

Common types: `feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, `test`.

## Opening the PR

1. Fork the repository and create a branch from `main` (`feat/...`,
   `fix/...`, `docs/...`).
2. Open the PR against `main`, filling in the template.
3. CI must be green before merging.

## Reporting bugs and vulnerabilities

Bugs: open an issue using the bug template, with reproduction steps and
environment. Never paste API keys, diffs or provider responses into the
issue.

Security vulnerabilities: do **not** open a public issue. Follow the
process described in [SECURITY.md](SECURITY.md).

## Code of conduct

By participating, you agree to the
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
