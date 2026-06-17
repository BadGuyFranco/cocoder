# Oz launch (replaces `.command` double-click)

CoCoder is **terminal-only** in v0.1. Ticket 0001 retires macOS `.command` double-click wrappers; Oz is the operator-facing launch surface instead.

## Start Oz

From the CoCoder install root:

```bash
pnpm exec cocoder oz start
```

Default URL: `http://127.0.0.1:7878/` (override with `COCODER_OZ_PORT`).

Check status or stop:

```bash
pnpm exec cocoder oz status
pnpm exec cocoder oz stop
```

## Register a workspace

Before launching runs from the dashboard, register each workspace Oz should manage:

```bash
pnpm exec cocoder oz register \
  --id my-app \
  --path /path/to/my-app \
  --tmux-socket cocoder-my-app
```

Or use the **Workspaces** page in the dashboard (`#/workspaces`).

## Launch a run

1. Open **Priorities** (`#/priorities`) and pick a registered workspace.
2. Confirm profile and route paths (relative to workspace root).
3. Click **Launch** on a priority row. Oz calls `POST /runs`, which spawns `cocoder launch` as an argv subprocess (PC-Q4=A).

### Visible launch (iTerm2/Terminal split pane)

By default a launched run's tmux sessions are **detached** — nothing pops open. Pass `--attach iterm` (the dashboard does this automatically) to open one terminal window split into a pane per lane, each attached to its lane's tmux session:

```bash
pnpm exec cocoder launch ... --execute true --attach iterm
```

This is **best-effort**: it opens iTerm2 if present (else Terminal.app), and the run still proceeds headless if no GUI terminal is available — attach manually with the `attachCommands` from the launch output. macOS may show a one-time Automation permission prompt the first time. *(For-now behavior; to be superseded by the planned Electron terminal harness + Oz window.)*

Alternatively from the terminal (CLI path):

```bash
pnpm exec cocoder launch \
  --profile cocoder/profiles/your.profile.json \
  --route cocoder/routes/your.route.json \
  --priority-slug your-slug \
  --workspace-root /path/to/my-app \
  --execute true \
  --attach iterm
```

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
