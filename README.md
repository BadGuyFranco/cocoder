# CoCoder

> **Status:** v0.1 in progress — **not yet usable by adopters.** Foundation, dogfood orchestration, and audit-finding remediation are landing first; full personas, workspace template, Oz dashboard, and onboarding docs follow in Sub-Playbooks B, C, and D. See [`cocoder/PRIORITIES.md`](./cocoder/PRIORITIES.md) for the live state.

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

## Contributing

CoCoder is solo-maintained early-stage OSS. Outside contributions are welcome on the terms documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md). For open-ended questions and design discussions use [Discussions](https://github.com/BadGuyFranco/cocoder/discussions); for bugs and concrete proposals use [Issues](https://github.com/BadGuyFranco/cocoder/issues). For security reports see [`SECURITY.md`](./SECURITY.md) — never file a public issue for a vulnerability.

Behavior expectations: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). The orchestration core under `packages/core/` is mechanically extracted from upstream CoBuilder (independent OSS); attribution requirements live in `NOTICE`.
