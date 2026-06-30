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
**Workspaces** section in the sidebar: **Add workspace**, pick the repo's primary-root folder, and create.
The daemon writes a `.code-workspace` registry file under `<CoCoder>/local/workspace/` — the one home for
workspace identity (ADR-0019); there is no `cocoder oz register` CLI command. Each run is then isolated in
its own cmux workspace automatically — no per-workspace socket to configure (ADR-0002; see
[`ARCHITECTURE.md`](../ARCHITECTURE.md)).

## Launch a run

1. Open the **Dashboard** priorities tab and pick a registered workspace.
2. Confirm the priority you want (its summary and scope) — the per-persona CLI/model assignment comes from the workspace's `cocoder/personas/assignments.json`.
3. Click **Launch** on a priority row. For ordinary priorities, Oz calls `POST /runs`; the daemon runs it through the core runner, spawning each lane's configured model CLI as an argv subprocess. For `independent-of-runner: true` destructive priorities, Oz calls `POST /runs/independent-launch` instead: it starts `cocoder run-independent <priorityId>` as a detached runnerless CLI process from the workspace root, so the work does not enter the daemon runner or create a daemon-owned run. (The `--strict-dirt` opt-out is the `strictPreRunDirt` field on the ordinary `POST /runs` body and a checkbox in the priority's launch dialog; see [ADR-0029](../cocoder/decisions/0029-founder-trusted-pre-run-snapshot.md).)

### Watching a run (cmux panes)

A launched run opens in its own cmux workspace, with each lane as a split pane (ADR-0002). The driver brings the active pane to the front when the run starts, and will `open -a cmux` if the app isn't already running. There are no `--attach`/`--execute` flags and no iTerm/Terminal auto-open — that was a v1 behavior and no longer exists.

To re-focus a run's pane later, use the **Attach** action in the dashboard run drawer (`POST /runs/:id/show`). It focuses the run's live cmux pane — Oscar by preference, since Oscar stays the founder-facing surface after wrap-up. If the run is no longer live in the current daemon process (torn down, or the daemon restarted), Attach returns a 409 and nothing opens.

From the terminal, launch a run directly:

```bash
pnpm exec cocoder run <priorityId> [--resume <runId>] [--strict-dirt] [--allow-pre-run-integrity-errors]
```

`cocoder oz resume <runId>` resumes a **held** run: it re-enters that run's parked atom after a
founder-explicit halt. When the run's panes are still alive, resume re-attaches to those same panes and
continues in place; it does not fork a second orchestrator. If the stored panes have died, resume
respawns a fresh set for the same held run. It is not teardown, and it is not
`cocoder run --resume <runId>`, which starts a fresh launch from a prior pickup brief.

For a mid-run `ask-founder-continue` decision, answer through Oz chat with
`founder-answer <runId> <answer>` or CLI with `cocoder oz founder-answer <runId> <answer>`. That records
the answer and resumes the held run in place, re-attaching to live panes when they are still available.

### Uncommitted work at launch (ADR-0029)

A launch no longer refuses on uncommitted founder WIP. The founder is a trusted actor: by default the launch takes a **pre-run snapshot** — it commits the dirty tree to its own labeled commit so the commit-gate and quarantine only ever see agent-produced changes — and then proceeds. Pass `--strict-dirt` to opt back into the old hard gate: with it set, an uncommitted in-scope tree **refuses** the launch instead of snapshotting. See [`ARCHITECTURE.md`](../ARCHITECTURE.md) and [ADR-0029](../cocoder/decisions/0029-founder-trusted-pre-run-snapshot.md).

### Sync corruption and malformed governance (ticket 0029)

Before launch, the runner scans for sync-conflict artifacts (`*.sync-conflict-*`, `*.orig`, conflict
markers). Matches **warn** in the launch event stream; the launch still proceeds. If a persona, Play, or
priority the run must load has unparseable frontmatter, launch **refuses with the file named** (the run
would crash on it anyway). Pass `allowPreRunIntegrityErrors` on `POST /runs` (dashboard checkbox in the
priority launch dialog) or `--allow-pre-run-integrity-errors` on `cocoder run` to override even the refuse case —
same founder-trusted override pattern as `--strict-dirt`.

## Stop a run

Two stop paths — do not conflate them ([ADR-0037](../cocoder/decisions/0037-founder-stop-hold-resume.md)):

- **Founder halt (mid-flight pause).** Tell an active persona to stop the run; the persona writes the
  founder-stop artifact and the runner parks in **`held`** — panes stay open, the in-flight atom is parked
  resume-ready (not abandoned). Resume with `cocoder oz resume <runId>`; it continues in the existing
  live panes when they are still attached, and respawns only if those panes have died.
- **Operator/cooperative stop (terminal).** Dashboard run drawer → **Stop** on a running run
  (`POST /runs/:id/stop`), or Oz Terminal: `stop <runId>`. This settles the run to **`stopped`** — not
  resume-ready.

Cooperative stop honors the runner's wait seams; a stop during wrap-up or integration may let the
run finish rather than corrupting a merge. To terminate the run's own personas and close their
surfaces, use `teardown <runId>` (chat) or the existing teardown surfaces — stop ≠ teardown.

## Oz Terminal (chat + commands)

The dashboard **Oz Terminal** sends free text to `POST /oz/messages`. The daemon first parses exact
commands. Unknown input falls through to the headless Oz agent when a workspace is selected and Oz is
enabled for that workspace; without that target, unknown input executes nothing and returns a hint.
Workspace context is required for mutating ops.

| Command | Example | Effect |
|---------|---------|--------|
| `launch` | `launch full-oz-dashboard` | Launches the named priority in the active workspace |
| `adhoc` | `adhoc review this diff` | Launches the `adhoc-session` priority with a free-text task |
| `show` | `show run_45` | Attaches/show panes for the run |
| `archive` / `confirm-archive` | `archive run_45` | Requests archive confirmation for the run's priority |
| `confirm-close` | `confirm-close run_45` | Confirms governed ticket close for a verified ticket run |
| `deb-repair` | `deb-repair runner stalled --run run_45` | Requests the Oscar-Deb repair dialogue |
| `reconcile-close` | `reconcile-close 0042 fixed by run_45` | Closes a reconciliation ticket with a resolution |
| `reconcile-repoint` | `reconcile-repoint 0042 standalone` | Repoints a reconciliation ticket |
| `commit-support` | `commit-support run_45` | Commits verified support edits for the run |
| `stop` | `stop run_45` | Cooperative run stop (`POST /runs/:id/stop`) |
| `teardown` | `teardown run_45` | Aborts that run's live controller and closes only that run's sessions |
| `status` | `status` or `status run_45` | Lists runs or shows one run's status |
| `help` | `help` | Prints the supported command list |

The headless Oz agent may call its declared tools (`launch`, `adhoc`, `show`, `confirm-archive`, `stop`,
`nudge`, `repair`, `oz-action`, `read-governed`, `author`, `teardown`, `status`, `refresh`) and only
reports success from tool results. Mutating requests require the same Bearer + CSRF tokens as other
dashboard mutations. When the daemon is unreachable, the Electron app falls back to a local stub reply.

## Development vs production UI

- **Dev:** `pnpm --filter @cocoder/ui dev` (Electron/Vite dev shell; C-D2).
- **Prod:** build dashboard then start daemon: `pnpm build:ui && pnpm exec cocoder oz start`.

See also [`getting-started.md`](./getting-started.md) and [`oz-security-checklist.md`](./oz-security-checklist.md).
