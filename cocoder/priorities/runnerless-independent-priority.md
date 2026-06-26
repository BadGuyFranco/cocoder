---
id: runnerless-independent-priority
title: Runner-independent (runnerless) priority execution + dogfooding-impact alert
---
## Objective

Give CoCoder a runner-independent ('runnerless') execution path for priorities that modify the machinery needed to run them, plus an alert recommending it. (a) Detect when a queued priority would impair the system's ability to run it (touches the runner/daemon/store/reload, or is flagged destructive) and surface an alert recommending an independent run — never silently dogfood it. (b) A priority marked independent-of-runner is executed by Oscar — using its assigned CLI (always the latest/greatest model) and orchestrating Bob sub-agents — to drive the priority to completion WITHOUT the deterministic runner loop or daemon-driven atom commits, so a self-impacting change is built and verified without depending on the machinery it changes. The runnerless path must work even when the runner/daemon under modification is inert or untrusted.

## Context

CoCoder dogfoods itself: a run that modifies the runner, daemon, or store is executed *by* the very components it changes. For most changes that is tolerable. But a class of changes — **destructive or run-critical self-modifications** (e.g. `local-cache-retention`, which deletes the live store; daemon-reload fixes like ticket 0064; store/schema migrations) — **cannot be safely dogfooded through the normal runner**: the change can break, corrupt, or surprise-activate against the very run building it (the daemon auto-reloads onto new code mid-run; a buggy store GC deletes the run's own state).

The escape hatch is to execute such a priority **independent of the runner**. Oscar acts as the orchestrator using sub-agents — driven by its own assigned CLI/model, not the deterministic runner/daemon atom loop. This priority builds (a) detection + alerting for self-impacting changes, and (b) the runnerless execution path itself.

## Objective

Give CoCoder a **runner-independent ("runnerless") execution path** for priorities that modify the machinery needed to run them, plus an **alert** that recommends it. (a) When a queued priority would impair the system's ability to run it, detect and surface that — recommend an independent run rather than silently dogfooding it. (b) A priority marked `independent-of-runner` is executed by **Oscar, using its assigned CLI (always the latest/greatest model), orchestrating Bob sub-agents to drive the priority to completion** — no deterministic runner loop, no daemon-driven atom commits — so a self-impacting change is built and verified without depending on the machinery it changes.

## Scope

1. **Dogfooding-impact detection + alert.** At queue/launch time, detect when a priority modifies run-critical machinery (heuristics: touches `packages/core/src/runner/**`, `packages/daemon/**`, the SQLite store, the reload/teardown path, or is flagged destructive). Surface a clear alert that recommends independent execution — never silently launch it as a normal run.
2. **`independent-of-runner` marking.** A priority can declare `independent-of-runner: true` (frontmatter/marker). Such priorities are not launched through the normal runner.
3. **Runnerless execution.** Oscar executes an `independent-of-runner` priority by orchestrating **Bob sub-agents** (plan → build → verify → commit → complete) directly, without the deterministic runner loop or daemon-driven atom commits. Define how Oscar dispatches sub-agents, commits work, verifies, and reaches completion in this mode.
4. **Always-latest CLI.** The runnerless run uses the **Oscar-assigned CLI**, which must resolve to the latest/greatest available model.
5. **Self-containment.** A runnerless run must operate even when the runner/daemon under modification is unavailable, inert, or untrusted — it is the escape hatch precisely for when those cannot be relied on.

## Acceptance

- A queued priority that touches run-critical machinery triggers a clear alert recommending independent execution (not a silent normal launch).
- A priority marked `independent-of-runner` is executed by Oscar via Bob sub-agents to completion, without the deterministic runner.
- The runnerless run uses the Oscar-assigned (latest/greatest) CLI.
- The runnerless path works without relying on the runner/daemon that is being modified.
- `local-cache-retention` and daemon-reload-class changes can be built and verified through this path without endangering the live install.
- Tests pin: the detection heuristic fires on a machinery-touching priority; a runnerless execution completes a priority end-to-end.

## Out of scope

- The actual `local-cache-retention` GC and the daemon-reload fix (ticket 0064) — this priority provides the **execution mechanism**, not those changes.
- Replacing the runner for normal priorities — runnerless is **opt-in** for self-impacting/destructive changes only; the deterministic runner remains the default for everything else.
