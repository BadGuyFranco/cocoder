# Oz

**Status:** Draft, implemented by Sub-Playbook D Solve  
**Last verified:** 2026-06-27 (aligned Oz chat/agent, UI route, CLI flag, and run-dir prose with current code)

Oz is CoCoder's local browser control surface. In v0.1 it helps an operator register workspaces, inspect priorities, launch runs, watch run status, and stop runs without hand-copying long CLI commands.

For the command-by-command launch flow, see [`oz-launch.md`](./oz-launch.md). For the local daemon hardening checklist, see [`oz-security-checklist.md`](./oz-security-checklist.md).

## What Oz does

Oz sits on top of the same CLI/runtime contracts as terminal launches. It does not replace persona
assignments, priority boundaries, Play contracts, or the runner/commit-gate contracts.

The v0.1 dashboard covers:

- workspace registration
- priority selection
- run launch (via `POST /runs`; the CLI equivalent is `cocoder run <priorityId>`)
- run listing and stop actions
- a run inspector with minimum viable evidence paths
- settings surfaced through the shared configuration resolver
- **Oz Terminal** — a chat surface (`POST /oz/messages`) with exact command parsing plus a headless Oz
  agent fallback when a workspace is selected and Oz is assigned. Exact commands cover launch/ad-hoc
  run, show/attach, archive/ticket-close support, stop, teardown, status, and help. The agent can answer
  in plain English or call its declared tools (`launch`, `adhoc`, `show`, `confirm-archive`, `stop`,
  `nudge`, `repair`, `oz-action`, `read-governed`, `author`, `teardown`, `status`, `refresh`). `stop`
  requests cooperative run termination (`POST /runs/:id/stop`); `teardown` aborts that run's live
  controller and closes only the sessions recorded for that run. `GET /oz/events` is the SSE refetch-hint
  stream; final chat answers are still one completed message, not token streaming.

Use Oz when you want repeatable launches across multiple workspaces. Use the CLI directly when debugging launch composition or working in a terminal-only environment.

## Security model summary

Oz is designed as a local operator daemon, not an internet service. The v0.1 security posture is:

- loopback-only binding
- bearer token on state-changing routes
- strict Host and Origin checks
- CSRF token on mutating requests
- settings responses that preserve secret references instead of resolved secret values
- audit log entries for launch and stop actions
- argv subprocess execution instead of shell-string interpolation

This is only a summary. Use [`oz-security-checklist.md`](./oz-security-checklist.md) for the actual operator checklist and sign-off surface.

## Troubleshooting

### Oz will not start

Confirm dependencies are installed and the workspace CLI resolves:

```bash
pnpm install
pnpm exec cocoder --help
pnpm exec cocoder oz start
```

If the default port is occupied, set `COCODER_OZ_PORT` and restart.

### Dashboard cannot see a workspace

Register it from the **Workspaces** section in the sidebar → **Add workspace** → pick the repo's
primary-root folder → create. The daemon writes the workspace's `.code-workspace` file under
`<CoCoder>/local/workspace/` (the install-local registry, ADR-0019). Then refresh the Workspaces or
Dashboard view. (There is no `cocoder oz register` CLI command — registration is dashboard-only.)

### Launch starts but no cmux pane opens

The run opens in a cmux workspace; the driver will `open -a cmux` if the app isn't already running. If the cmux control socket never becomes reachable, the launch fails with a clear error — open cmux manually and ensure socket control (automation mode) is enabled, then relaunch (ADR-0002). To re-focus a live run's pane, use the **Attach** action in the run drawer (`POST /runs/:id/show`); it returns a 409 if the run is no longer live in the current daemon process. You can also inspect the run record under `<CoCoder>/local/runs/<workspace-id>/<run-id>/`.

### Mutating requests return 401 or 403

Restart the dashboard session so it can refresh the loopback auth session. If using a custom client, confirm it sends the bearer token and CSRF token exactly as returned by Oz.

### Run stop does not remove evidence

That is expected. Stop actions should leave run directories, event logs, and run artifacts intact so the lead can audit what happened.

### Cooperative stop vs teardown

`stop` (chat or dashboard) requests a **cooperative** halt: the runner honors it at wait seams
(directive/verify/triage polls), records a first-class `stopped` status, and skips integration —
it does not masquerade as a builder fault or trigger Deb triage. A stop arriving during wrap-up or
integration may let the run finish so merges are not corrupted. `teardown` terminates Oscar/Bob/Deb
for that run only: the daemon aborts the run controller, closes the stored cmux surfaces, and never
enumerates unrelated sessions. It is not a substitute for cooperative stop.
