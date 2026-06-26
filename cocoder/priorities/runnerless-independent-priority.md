---
id: runnerless-independent-priority
title: Runner-independent (runnerless) priority execution + dogfooding-impact alert
---
## Objective

Give CoCoder a **runner-independent ("runnerless") execution path** for priorities that modify the machinery needed to run them, plus an **alert** that recommends it. (a) When a queued priority would impair the system's ability to run it (touches the runner/daemon/store/reload path, or is flagged `destructive`), detect and surface that — recommend an independent run rather than silently dogfooding it. (b) A priority marked `independent-of-runner` is executed by Oscar via a **standalone, daemon-free process**: it reuses the proven runner orchestration (Oscar directing Bob, with the per-atom verify gate, scope quarantine, and commit receipts) but runs **outside the daemon** — frozen installed code (no mid-run auto-reload), committing via **direct git** (no daemon-driven atom commits), and against an **isolated target for `destructive` priorities** (a scratch store copy, so a GC/migration cannot endanger the run's own state). Oscar's CLI resolves to the latest/greatest model. The result: a self-impacting or destructive change is built and verified without depending on the **daemon machinery** (auto-reload, scheduling, daemon commit spine) or risking the live install.

## Context

CoCoder dogfoods itself: a run that modifies the runner, daemon, or store is executed *by* components it changes. For most changes that is tolerable. But **destructive or run-critical self-modifications** (e.g. `local-cache-retention`, which deletes the live store; store/schema migrations) **cannot be safely dogfooded through the normal daemon-driven runner** — the daemon auto-reloads onto new code mid-run, and a destructive op can activate against the run's own live state.

**Threat-model finding (run 105, 2026-06-26):** the danger is the **daemon and the live store**, not the runner orchestration logic. `runRun` is already fully decoupled from the daemon (in-process, live git, injected adapters, zero HTTP/store-socket coupling), and a standalone CLI process runs the **code it was launched with for its whole lifetime** — it does not hot-reload the way the daemon does. So the escape hatch is **execution outside the daemon**, reusing the proven loop, plus destructive-target isolation — not a from-scratch agentic orchestrator. The chosen shape and the rejected alternative are recorded in ADR-0043.

## Scope

1. **Dogfooding-impact detection + alert.** *(shipped, run 105.)* At launch time, detect when a priority modifies run-critical machinery (`detectRunnerImpact`: declared scope intersects `RUN_CRITICAL_GLOBS` — `packages/core/src/runner/**`, `packages/daemon/**`, the store, the commit-gate — or the priority is flagged `destructive`). Refuse it pre-spawn with a clear alert recommending independent execution; an explicit `allowSelfImpacting` override proceeds but is audited.
2. **`independent-of-runner` marking.** *(shipped, run 105.)* A priority declares `independent-of-runner: true`; such priorities are refused from the normal daemon runner and routed to the runnerless path.
3. **Runnerless execution (Shape A).** *(shipped, run 106.)* A new standalone CLI entrypoint (e.g. `cocoder run-independent <priorityId>`) executes an `independent-of-runner` priority by invoking the existing `runRun` **in direct mode, daemon-free** — no daemon launch, no daemon-driven scheduling/commits, frozen installed code. Oscar directs Bob through the proven atom loop (plan → build → verify → commit via direct git → complete). For `destructive` priorities, run against an isolated store/target so the change cannot corrupt the run's own state. It must operate when the daemon is down or inert.
4. **Always-latest CLI.** *(shipped, run 106.)* The runnerless run resolves the Oscar-assigned CLI to the latest/greatest available model.
5. **Self-containment.** *(shipped, run 106.)* A runnerless run operates with the daemon unavailable/inert/untrusted, runs frozen code (no mid-run auto-reload), and — for `destructive` priorities — does not endanger the live store/install.

## Acceptance

- A queued priority that touches run-critical machinery (or is `destructive`) triggers a clear alert recommending independent execution, not a silent normal launch. *(met, run 105.)*
- A priority marked `independent-of-runner` is refused from the normal daemon runner. *(met, run 105.)*
- `cocoder run-independent <priorityId>` executes an `independent-of-runner` priority to completion via the standalone daemon-free path, with the daemon not running. *(met, run 106.)*
- The runnerless run resolves Oscar to the latest/greatest CLI model. *(met, run 106.)*
- The path runs frozen installed code (no mid-run auto-reload) and, for `destructive` priorities, executes against an isolated target so the live store/install is not endangered — `local-cache-retention` and daemon-reload-class changes can be built and verified this way safely. *(met, run 106.)*
- Tests pin: the detection heuristic fires on a machinery-touching priority *(met, run 105)*; a standalone runnerless execution completes a priority end-to-end with no daemon running *(met, run 106)*.

## Out of scope

- The actual `local-cache-retention` GC — this priority provides the **execution mechanism**, not that change.
- Replacing the runner for normal priorities — runnerless is **opt-in** for self-impacting/destructive changes; the daemon-driven runner remains the default.
- A from-scratch agentic orchestrator that discards `runRun` (the rejected "Shape B"; see ADR-0043).

## Follow-up — founder-requested hardening (after run_250, 2026-06-26)

All five scope items and acceptance criteria are met (detection + alert in run_105; Shape A
runnerless execution, always-latest CLI, self-containment, and end-to-end no-daemon test in
run_250). The founder asked for **one more run** to close the gaps Oscar surfaced at wrap-up before
archiving. The Objective/Scope/Acceptance above stand; these are hardening items, not a re-scope.

1. **Real-CLI smoke — the true end-to-end proof.** *(met, run_251.)* Integration test
   `packages/cli/tests/run-independent-real-run.test.ts` drives the live `runStandalone` → real
   `runRun` wiring without injecting `runRunImpl`: real directive/verify handoff on disk, real
   `openRunStore`, scripted agents only at the headless layer. Covers non-destructive (live store) and
   destructive (isolated scratch; live store untouched) paths and asserts
   builder-dispatch→verify-pass→wrapup→run-end. Optional belt-and-suspenders: a live LLM run of
   [`local-cache-retention`](./local-cache-retention.md) via `cocoder run-independent` — not required
   by this item as written.
2. **Daemon-up guard (unhandled footgun).** *(met, run_251.)* `run-independent` probes the daemon before
   opening the live store; when the daemon is live and the target is non-isolated, it exits 1 with a
   clear message naming `local/cocoder.db` and the SQLite single-writer lock. `--force` downgrades to a
   logged WARNING. Isolated/destructive scratch runs skip the guard.
3. **"Latest/greatest" semantics — confirm intent.** *(founder gate.)* Resolution is the **first entry
   of `listModels()`** (claude → `opus`), i.e. most-capable-by-curation, **not newest-by-release**
   (Fable 5 is newer but curated last). Confirm this matches intent; if "latest" should track a
   deliberate marker rather than list order, encode that. Also: the runnerless path currently **forces
   latest even over an explicitly pinned assignment model** — confirm that override is desired, or have
   it honour a pinned model when one is set. Oscar recommends keeping both behaviours; optional cosmetic
   follow-up only: rename the resolver from `latest` to `most-capable`.

**Disposition:** `archive-confirmation` — hardening items 1–2 complete (run_251); item 3 founder
confirmation is the sole archive gate. Confirm current semantics → reply `archive` in Oz chat; request a
change to (a) and/or (b) → one small relaunch atom.
