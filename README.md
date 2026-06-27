# CoCoder

CoCoder is an open, local-first AI coding orchestration framework for solo builders and small teams. It packages the proven CoBuilder orchestration runtime as a reusable CLI, workspace template, persona contract system, and local Oz dashboard.

Use it when you want AI coding sessions to start from explicit priorities, bounded write scopes, durable evidence, and repeatable result artifacts instead of ad hoc chat threads.

## What v0.1 includes

- A `cocoder` CLI to launch runs (`cocoder run`, `cocoder run-independent`) and drive Oz daemon control-plane actions (`cocoder oz ...` for start, authoring, tickets, priorities, repair, resume, support commit, and teardown).
- A tracked `cocoder/` workspace structure for priorities, session logs, ADRs, tickets, memory, standards, and personas.
- A workspace template (`templates/workspace-cocoder/`) scaffolded into a repo when you add it as a workspace in the Oz dashboard.
- Oz, a loopback-only browser dashboard for workspace registration, priority launch, run listing, and run inspection.
- Public docs for first launch, orchestration, personas, configuration, Oz, freshness policy, and FAQ.
- Apache-2.0 licensing with CoBuilder extraction attribution in `NOTICE`.

## Requirements

- macOS first for v0.1
- Node.js version from `.nvmrc`
- pnpm 10.x
- cmux — the native macOS terminal host where agent panes run and the founder watches them (ADR-0002; AGPL-3.0, macOS-only). Install it separately and enable its socket control (automation mode); CoCoder drives it over that Unix socket and will `open -a cmux` if it isn't already running. It is not bundled or vendored.
- At least one configured model CLI adapter named by `cocoder/personas/assignments.json`

## Quick Start

Install CoCoder:

```sh
git clone <CoCoder-repo-url> ~/dev/CoCoder
cd ~/dev/CoCoder
pnpm install
node scripts/check-topology.mjs
export COCODER_HOME="$PWD"
```

The `cocoder` CLI runs TypeScript directly via `tsx` — there is no build step.

Add an application repo as a workspace. Start the Oz daemon and add it from the dashboard — that
scaffolds the repo's tracked `cocoder/` governance tree and registers it (there is no `cocoder init`):

```sh
scripts/oz.sh start   # starts the daemon detached on :7878 and prints the dashboard URL
```

Open the dashboard, go to **Workspaces → Add workspace**, and pick your repo's primary-root folder.
Then follow [`docs/getting-started.md`](./docs/getting-started.md) for the full path from clean clone to first run.

## Mental Model

CoCoder has two public surfaces and two private surfaces:

- The CoCoder install repo contains seven TypeScript packages (`@cocoder/core`, `@cocoder/personas`, `@cocoder/adapters`, `@cocoder/session-hosts`, `@cocoder/daemon`, `@cocoder/cli`, `@cocoder/ui`), plus templates and docs.
- `<CoCoder>/local/` stores install-private preferences, workspace registry data, audit logs, and secrets.
- Each application repo gets a tracked `cocoder/` workspace folder for priorities, ADRs, tickets, memory, standards, and persona contracts.
- All machine-local state (DB, runs, secrets, workspace files) lives in the install's `local/` — a workspace's `cocoder/` directory is fully git-tracked.

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
pnpm test                      # all package suites (pnpm -r test)
pnpm typecheck                 # src + tests, every package
pnpm lint                      # ESLint safety gate
node scripts/check-topology.mjs
```

The `cocoder` CLI needs no build — it runs via `tsx`. Invoke it from the install root:

```sh
pnpm exec cocoder --help
```

## Contributing

CoCoder is solo-maintained early-stage OSS. Outside contributions are welcome on the terms documented in [`CONTRIBUTING.md`](./CONTRIBUTING.md). For open-ended questions and design discussions use [Discussions](https://github.com/BadGuyFranco/cocoder/discussions); for bugs and concrete proposals use [Issues](https://github.com/BadGuyFranco/cocoder/issues). For security reports see [`SECURITY.md`](./SECURITY.md) - never file a public issue for a vulnerability.

Behavior expectations: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE). The orchestration core under `packages/core/` is mechanically extracted from upstream CoBuilder; attribution requirements live in `NOTICE`.
