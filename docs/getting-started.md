# Getting started with CoCoder

**Last verified:** 2026-06-20

The shortest path from a clean clone to a first orchestrated run. CoCoder v2 ships and dogfoods
itself: the repo is both the engine install and one managed workspace (the **dogfood**, whose
governance lives at `<CoCoder>/cocoder/`). The commands below drive that dogfood workspace. For the
storage-zone model and the launch/commit machinery, the single source of truth is
[`ARCHITECTURE.md`](../ARCHITECTURE.md); this page only gets you running.

## 1. Install

Prerequisites:

- Node.js version from `.nvmrc`
- pnpm 10.x
- [cmux](https://github.com/cmux) (the session host — CoCoder runs agents in cmux panes)
- At least one configured CLI adapter (`claude`, `codex`, or `cursor-agent`)

```sh
git clone <CoCoder-repo-url> ~/dev/CoCoder
cd ~/dev/CoCoder
pnpm install
node scripts/check-topology.mjs
export COCODER_HOME="$PWD"
```

The `cocoder` CLI runs TypeScript directly via `tsx` — there is no build step.

`check-topology.mjs` is the inward-only dependency guardrail; a clean clone should pass it.

## 2. Storage zones

CoCoder has **three** zones ([ARCHITECTURE.md](../ARCHITECTURE.md), [ADR-0008](../cocoder/decisions/0008-repository-topology.md)).
You do not create any of them by hand:

```text
<CoCoder>/                  install repo (tracked): packages/, docs/, templates/, scripts/,
                            and cocoder/ — the dogfood workspace's governance
<CoCoder>/local/            the ONE machine-local zone (gitignored), spanning every workspace:
                            cocoder.db, runs/, workspace/ defs, settings.json, secrets/, audit
<primary-root>/cocoder/     each managed repo's tracked governance dir (here: the dogfood cocoder/)
```

There is no per-workspace `local/` — all machine state lives in the install's single `local/`. The
config/secrets locations are covered in [`configuration.md`](./configuration.md).

## 3. Pick (or add) a priority

Launchable priorities are one flat `.md` per priority under `cocoder/priorities/`, ordered by
`cocoder/priorities/order.json`. The directory listing is the index — there is no `PRIORITIES.md`.
Run id is the priority's filename stem. List them:

```sh
ls cocoder/priorities/
```

## 4. First run from the CLI

```sh
cocoder run <priorityId>
```

What happens (see [ARCHITECTURE.md → commit spine](../ARCHITECTURE.md#how-work-reaches-trunk--the-commit-spine-adr-0023)):
Oscar orchestrates the priority as a multi-atom loop, delegating to Bob, verifying each atom before
the commit spine lands it on the active branch.

If a daemon is running it owns the DB writer and cmux; the CLI routes the launch through it (client
mode). Otherwise the CLI runs standalone and takes the SQLite write-lock. Either way the launch
emits a run id and the commits it landed.

Useful flags ([`packages/cli/src/run.ts`](../packages/cli/src/run.ts)):

- `--resume <runId>` — continue from a prior run's pickup brief.
- `--strict-dirt` — see [§6](#6-launching-with-uncommitted-changes).

## 5. View / attach to a run (the dashboard)

CoCoder's run surface is the **Oz dashboard** (an Electron app served by the Oz daemon). Start the
daemon and open the dashboard:

```sh
scripts/oz.sh start        # starts the daemon detached on :7878, prints the dashboard URL
```

(`cocoder oz start` runs the daemon in the foreground instead.) In the dashboard, a run's **attach**
action focuses that run's live cmux pane — under the hood it posts `/runs/:id/show`, which calls the
cmux host's `show()` to bring the agent pane to the front
([`packages/daemon/src/launcher.ts`](../packages/daemon/src/launcher.ts) `showRun`,
[`packages/session-hosts/src/cmux/driver.ts`](../packages/session-hosts/src/cmux/driver.ts) `show`).
There is no CLI attach command and no auto-opened terminal. If the run is not live, attach is a no-op.

For the daemon security posture, see
[ARCHITECTURE.md → Oz daemon security model](../ARCHITECTURE.md#oz-daemon-security-model) and
[`oz-security-checklist.md`](./oz-security-checklist.md).

## 6. Launching with uncommitted changes

By default a launch with uncommitted **founder** work in scope is **not** refused. The founder is a
trusted actor ([ADR-0029](../cocoder/decisions/0029-founder-trusted-pre-run-snapshot.md)): the launch
guard snapshots that WIP to its own attributed commit and proceeds — product/builder dirt →
`founder: pre-run WIP snapshot`, governance dirt → `governance: pre-run snapshot`. Mixed dirt
produces both snapshots and still proceeds. Agent governance gates (verify, quarantine, out-of-lane
flagging) stay hard; only the founder's own work is preserved rather than blocked.

To restore the old hard-stop refusal (shared repos, CI), opt in:

```sh
cocoder run <priorityId> --strict-dirt
```

The same opt-out is `strictPreRunDirt` on `POST /runs` and the dashboard's strict-dirt checkbox
([`packages/daemon/src/routes.ts`](../packages/daemon/src/routes.ts)).

## 7. What to commit

A `cocoder/` governance directory is fully git-tracked — priorities, decisions, tickets, memory,
standards, persona/play extensions. Never commit anything under `<CoCoder>/local/` (only its signage
`README.md` is tracked). The canonical ignore matrix is in
[ARCHITECTURE.md → Ignore matrix](../ARCHITECTURE.md#ignore-matrix-canonical).

See [`faq.md`](./faq.md) for commercial-use, trademark, telemetry, and sync guidance.
