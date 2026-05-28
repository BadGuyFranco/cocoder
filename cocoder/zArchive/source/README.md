# CoCoder

CoCoder is an open, local-first AI coding orchestration framework for solo builders and small teams. It packages the proven CoBuilder orchestration runtime as a reusable CLI, workspace template, persona contract system, and local Oz dashboard.

Use it when you want AI coding sessions to start from explicit priorities, bounded write scopes, durable evidence, and repeatable result artifacts instead of ad hoc chat threads.

## What v0.1 includes

- A `cocoder` CLI for workspace setup, launch composition, lane startup, contract validation, and local audit checks.
- A tracked `cocoder/` workspace structure for priorities, session logs, ADRs, tickets, memory, standards, routes, profiles, and personas.
- A workspace template created by `cocoder init`.
- Oz, a loopback-only browser dashboard for workspace registration, priority launch, run listing, and run inspection.
- Public docs for first launch, orchestration, personas, configuration, Oz, freshness policy, and FAQ.
- Apache-2.0 licensing with CoBuilder extraction attribution in `NOTICE`.

## Requirements

- macOS first for v0.1
- Node.js version from `.nvmrc`
- pnpm 10.x
- tmux
- At least one configured model CLI adapter named by the selected profile

## Quick Start

Install CoCoder:

```sh
git clone <CoCoder-repo-url> ~/dev/CoCoder
cd ~/dev/CoCoder
pnpm install
pnpm -F cocoder-cli build
pnpm exec cocoder validate-contracts
export COCODER_HOME="$PWD"
```

Initialize an application workspace outside the CoCoder install:

```sh
mkdir -p ~/dev/my-app
cd ~/dev/my-app
git init
pnpm --dir "$COCODER_HOME" exec cocoder init \
  --workspace-root "$PWD" \
  --cocoder-home "$COCODER_HOME"
```

Then follow [`docs/getting-started.md`](./docs/getting-started.md) for the full path from clean clone to first CLI or Oz launch.

## Mental Model

CoCoder has two public surfaces and two private surfaces:

- The CoCoder install repo contains the engine, schemas, templates, docs, and dashboard source.
- `<CoCoder>/local/` stores install-private preferences, workspace registry data, audit logs, and secrets.
- Each application repo gets a tracked `cocoder/` workspace folder for priorities, ADRs, tickets, memory, standards, and persona contracts.
- Each application repo also gets ignored `cocoder/local/` overrides for machine-local settings and secrets.

Git updates the engine and templates. Ignored `local/` directories preserve operator preferences and run records.

For the full storage-zone model, see [`ARCHITECTURE.md`](./ARCHITECTURE.md). For commercial use, telemetry, trademark, and sync guidance, see [`docs/faq.md`](./docs/faq.md).

## Documentation

- [`docs/getting-started.md`](./docs/getting-started.md) - clean-clone to first launch.
- [`docs/orchestration.md`](./docs/orchestration.md) - runs, dispatch, evidence, and result artifacts.
- [`docs/personas.md`](./docs/personas.md) - core role contracts and write capability.
- [`docs/configuration.md`](./docs/configuration.md) - install/workspace config, path resolution, and terminal invocation.
- [`docs/oz.md`](./docs/oz.md) - dashboard overview and troubleshooting.
- [`docs/oz-launch.md`](./docs/oz-launch.md) - command-by-command Oz launch flow.
- [`docs/oz-security-checklist.md`](./docs/oz-security-checklist.md) - local daemon security checklist.
- [`docs/freshness-policy.md`](./docs/freshness-policy.md) - doc verification stamps and release-candidate audit cadence.

## Local Development

```sh
pnpm install
pnpm -F schemas build
pnpm -F core test
pnpm -F oz-dashboard test
pnpm exec cocoder validate-contracts
```

The public CLI package builds a `cocoder` binary:

```sh
pnpm -F cocoder-cli build
pnpm exec cocoder config get
```

## Contributing

CoCoder is solo-maintained early-stage OSS. Outside contributions are welcome on the terms documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md). For open-ended questions and design discussions use [Discussions](https://github.com/BadGuyFranco/cocoder/discussions); for bugs and concrete proposals use [Issues](https://github.com/BadGuyFranco/cocoder/issues). For security reports see [`SECURITY.md`](./SECURITY.md) - never file a public issue for a vulnerability.

Behavior expectations: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). The orchestration core under `packages/core/` is mechanically extracted from upstream CoBuilder; attribution requirements live in `NOTICE`.
