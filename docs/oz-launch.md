# Oz launch (replaces `.command` double-click)

CoCoder is **terminal-only** in v0.1. Ticket 0001 retires macOS `.command` double-click wrappers; Oz is the operator-facing launch surface instead.

## Start Oz

From the CoCoder install root:

```bash
pnpm exec cocoder oz start   # runs the daemon in the FOREGROUND
```

Or run it detached with the lifecycle script (start/stop/status/restart):

```bash
scripts/oz.sh start
```

Default URL: `http://127.0.0.1:7878/` (override with `COCODER_OZ_PORT`).

Check status or stop the detached daemon:

```bash
scripts/oz.sh status
scripts/oz.sh stop
```

## Register a workspace

Before launching runs from the dashboard, register each workspace Oz should manage from the
**Workspaces** page (`#/workspaces`): **Add workspace**, pick the repo's primary-root folder, and create.
The daemon writes a `.code-workspace` registry file under `<CoCoder>/local/workspace/` — the one home for
workspace identity (ADR-0019); there is no `cocoder oz register` CLI command. Each run is then isolated in
its own cmux workspace automatically — no per-workspace socket to configure (ADR-0002; see
[`ARCHITECTURE.md`](../ARCHITECTURE.md)).

## Launch a run

1. Open **Priorities** (`#/priorities`) and pick a registered workspace.
2. Confirm the priority you want (its summary and scope) — the per-persona CLI/model assignment comes from the workspace's `cocoder/personas/assignments.json`.
3. Click **Launch** on a priority row. Oz calls `POST /runs`; the daemon runs it through the core runner, spawning each lane's configured model CLI as an argv subprocess. (The `--strict-dirt` opt-out is the `strictPreRunDirt` field on the `POST /runs` body and a checkbox in the priority's launch dialog; see [ADR-0029](../cocoder/decisions/0029-founder-trusted-pre-run-snapshot.md).)

### Watching a run (cmux panes)

A launched run opens in its own cmux workspace, with each lane as a split pane (ADR-0002). The driver brings the active pane to the front when the run starts, and will `open -a cmux` if the app isn't already running. There are no `--attach`/`--execute` flags and no iTerm/Terminal auto-open — that was a v1 behavior and no longer exists.

To re-focus a run's pane later, use the **Attach** action in the dashboard run drawer (`POST /runs/:id/show`). It focuses the run's live cmux pane — Oscar by preference, since Oscar stays the founder-facing surface after wrap-up. If the run is no longer live in the current daemon process (torn down, or the daemon restarted), Attach returns a 409 and nothing opens.

From the terminal, launch a run directly:

```bash
pnpm exec cocoder run <priorityId> [--resume <runId>] [--strict-dirt]
```

### Uncommitted work at launch (ADR-0029)

A launch no longer refuses on uncommitted founder WIP. The founder is a trusted actor: by default the launch takes a **pre-run snapshot** — it commits the dirty tree to its own labeled commit so the commit-gate and quarantine only ever see agent-produced changes — and then proceeds. Pass `--strict-dirt` to opt back into the old hard gate: with it set, an uncommitted in-scope tree **refuses** the launch instead of snapshotting. See [`ARCHITECTURE.md`](../ARCHITECTURE.md) and [ADR-0029](../cocoder/decisions/0029-founder-trusted-pre-run-snapshot.md).

## Stop a run

- Dashboard run drawer → **Stop** on a running run (cooperative — `POST /runs/:id/stop`), or
- Oz Terminal: `stop <runId>` (same cooperative path).

Cooperative stop honors the runner's wait seams; a stop during wrap-up or integration may let the
run finish rather than corrupting a merge. To terminate the run's own personas and close their
surfaces, use `teardown <runId>` (chat) or the existing teardown surfaces.

## Oz Terminal (bounded chat commands)

The dashboard **Oz Terminal** sends free text to `POST /oz/messages`. The daemon parses a **fixed verb
vocabulary** — it is not an LLM agent. Supported commands (workspace context required for mutating ops):

| Command | Example | Effect |
|---------|---------|--------|
| `launch` | `launch full-oz-dashboard` | Launches the named priority in the active workspace |
| `show` | `show run_45` | Attaches/show panes for the run |
| `stop` | `stop run_45` | Cooperative run stop (`POST /runs/:id/stop`) |
| `teardown` | `teardown run_45` | Aborts that run's live controller and closes only that run's sessions |
| `status` | `status` or `status run_45` | Lists runs or shows one run's status |
| `help` | `help` | Prints the supported command list |

Unknown or ambiguous input returns a hint and **executes nothing**. Mutating requests require the same
Bearer + CSRF tokens as other dashboard mutations. When the daemon is unreachable, the Electron app
falls back to a local stub reply.

## Development vs production UI

- **Dev:** `pnpm --filter oz-dashboard dev` (Vite proxies API to `:7878`; C-D2).
- **Prod:** build dashboard then start daemon: `pnpm --filter oz-dashboard build && pnpm exec cocoder oz start`.

See also [`getting-started.md`](./getting-started.md) and [`oz-security-checklist.md`](./oz-security-checklist.md).
