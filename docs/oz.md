# Oz

**Status:** Draft, implemented by Sub-Playbook D Solve  
**Last verified:** 2026-06-11 (run_58 cooperative stop slice)

Oz is CoCoder's local browser control surface. In v0.1 it helps an operator register workspaces, inspect priorities, launch runs, watch run status, and stop runs without hand-copying long CLI commands.

For the command-by-command launch flow, see [`oz-launch.md`](./oz-launch.md). For the local daemon hardening checklist, see [`oz-security-checklist.md`](./oz-security-checklist.md).

## What Oz does

Oz sits on top of the same CLI contracts as terminal launches. It does not replace routes, profiles, priority boundaries, startup packets, or lane result contracts.

The v0.1 dashboard covers:

- workspace registration
- priority selection
- run launch through `cocoder launch`
- run listing and stop actions
- a run inspector with minimum viable evidence paths
- settings surfaced through the shared configuration resolver
- **Oz Terminal** — a bounded chat command interface (`POST /oz/messages`) that maps a fixed verb
  vocabulary (`launch`, `show`, `stop`, `teardown`, `status`, `help`) to existing run-lifecycle ops.
  `stop` requests cooperative run termination (`POST /runs/:id/stop`); `teardown` closes run panes
  without stopping the orchestration loop.
  This is **not** an in-daemon LLM agent; ambiguous or unknown input executes nothing. GUI controls
  remain the primary path; chat is parity for the same actions. Streaming (`GET /oz/stream` SSE) is
  not yet wired.

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

Confirm dependencies are installed and the core package is built:

```bash
pnpm install
pnpm -F cocoder-cli build
pnpm exec cocoder oz start
```

If the default port is occupied, set `COCODER_OZ_PORT` and restart.

### Dashboard cannot see a workspace

Register the workspace with the install-local registry:

```bash
pnpm exec cocoder oz register \
  --id my-app \
  --path /path/to/my-app \
  --tmux-socket cocoder-my-app
```

Then refresh the Workspaces or Priorities page.

### Launch starts but no terminal opens

Visible panes are best-effort. If macOS does not open iTerm2 or Terminal.app, use the attach commands from the launch output or inspect the run directory under `<CoCoder>/local/workspaces/<workspace-id>/runs/`.

### Mutating requests return 401 or 403

Restart the dashboard session so it can refresh the loopback auth session. If using a custom client, confirm it sends the bearer token and CSRF token exactly as returned by Oz.

### Run stop does not remove evidence

That is expected. Stop actions should leave run directories, event logs, and lane result artifacts intact so the lead can audit what happened.

### Cooperative stop vs teardown

`stop` (chat or dashboard) requests a **cooperative** halt: the runner honors it at wait seams
(directive/verify/triage polls), records a first-class `stopped` status, and skips integration —
it does not masquerade as a builder fault or trigger Deb triage. A stop arriving during wrap-up or
integration may let the run finish so merges are not corrupted. `teardown` closes Oscar/Bob/Deb
panes and reclaims worktree surfaces; it is not a substitute for cooperative stop.
