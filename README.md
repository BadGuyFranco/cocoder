# CoCoder

CoCoder is an open, local-first AI coding orchestration framework for solo builders and small teams. It extracts the proven CoBuilder orchestration runtime into a reusable CLI, workspace structure, and local control plane.

## Mental Model

CoCoder has two public surfaces and two private surfaces:

- The CoCoder install repo contains the engine, schemas, templates, docs, and dashboard source.
- `<CoCoder>/local/` stores install-private preferences, workspace registry data, audit logs, and secrets.
- Each application repo gets a tracked `cocoder/` workspace folder for priorities, ADRs, tickets, memory, and standards.
- Each application repo also gets ignored `cocoder/local/` overrides for machine-local settings.

Git updates the engine and templates. Ignored `local/` directories preserve user preferences.

## Requirements

- macOS first for v0.1
- Node 20 LTS
- pnpm
- tmux and iTerm2 for orchestrated sessions
- User-installed model CLIs such as Codex, Claude, Grok, Gemini, or Kimi

## Current Build Status

The active build is tracked in [cocoder/PRIORITIES.md](./cocoder/PRIORITIES.md). Sub-Playbook A is implementing the foundation: monorepo scaffold, config resolver, path portability, install preferences, and the extracted core baseline.

## Local Development

```sh
pnpm install
pnpm -F schemas build
pnpm -F core test
node packages/core/cli.mjs validate-contracts
```

The public CLI package builds a `cocoder` binary:

```sh
pnpm -F cocoder-cli build
packages/cocoder-cli/bin/cocoder config get
```

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
