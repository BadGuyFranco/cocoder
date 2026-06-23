# ADR-0037 — Founder stop control: halt-and-hold, then resume

**Status:** Proposed — pending founder approval.
**Builds on:** [0013](./0013-orchestration-observation.md) (runner loop, monitor, and nudge ownership),
[0017](./0017-oz-orchestration-persona.md) (Oz control surface), and
[0023](./0023-workspace-commit-spine.md) (direct-to-branch run state and receipt model).
**Closes:** Phase 1 closes ticket
[`0031`](../tickets/open/0031-founder-stop-the-run-control-for-personas.md) when implemented and landed.

## Context

During run_188 the founder told a persona to stop the run, but no persona had a sanctioned way to honor
that direction. The runner kept polling and nudging because the only live stop controls are lifecycle
operations outside persona authority.

The current owners are:

- `packages/core/src/runner/runner.ts` owns the run loop and current terminal `stopRun()` path. Today a
  stop request is observed through `StopRequestedError`; `stopRun()` records `run-stopped`, marks the
  active work item `abandoned`, quarantines the active atom's files, sets run status `stopped`, and exits.
- `packages/daemon/src/routes.ts` owns `POST /runs/:id/stop`; it forwards to
  `requestStopRun(ctx, runId)`.
- `packages/daemon/src/launcher.ts` owns `requestStopRun()`, which aborts the live run's controller, and
  `teardownRun()`, which closes tracked run surfaces. The launcher lifecycle currently records
  `stop-teardown` after an aborted live run settles.
- `packages/cli/src/run.ts` and `packages/cli/src/client.ts` own the `cocoder oz teardown <runId>` path:
  the CLI probes the daemon and posts to `/runs/:id/teardown`, the same pane-closing operation used by
  Oz.
- `packages/core/src/runner/prompts.ts` exposes teardown instructions to Oscar and Deb when explicitly
  asked, but personas are otherwise bound by host/process safety: they act on files and must not kill
  processes, close panes, or stop/restart the daemon by hand.

Ticket 0031 names the missing capability: a founder instruction given to Bob, Oscar, or Deb should let
that persona write a file-based stop signal, after which the **runner** halts its directive/verify/nudge
loop. The ticket also records the key design choice: stop should halt the loop while leaving panes open,
with teardown remaining separate.

## Decision

Add a sanctioned founder stop control with two ordered phases under this ADR.

### Phase 1: halt-and-hold

A founder-explicit "stop the run" direction delivered to Bob, Oscar, or Deb may be recorded by that
persona as a runner-owned stop-signal artifact in the run directory. The persona writes the artifact only;
the persona never invokes `cocoder oz teardown`, never calls `POST /runs/:id/stop`, never kills sessions,
and never closes windows.

The runner polls that artifact at the same loop boundaries that can currently emit directives, verify
requests, and nudges. Once the founder stop is registered:

- the runner emits no further dispatches or nudges to Bob, Oscar, or Deb;
- the run moves to a new `held` disposition, not `stopped`;
- panes stay open for inspection and founder conversation;
- teardown remains a separate explicit pane-closing operation;
- the in-flight atom is parked resume-ready. It is **not** marked `abandoned`, and its files are **not**
  quarantined merely because the founder halted the loop.

`held` is therefore a halt-only run disposition: work is intentionally paused at a known atom boundary or
monitor sample, with enough durable state to resume. It is not a failure state, not a terminal stop, and
not a pane lifecycle action.

Phase 1 closes ticket 0031 when this behavior lands.

### Phase 2: resume from held

Add the explicit resume transition from `held` to `running`. Resume re-enters the runner loop at the
parked atom without re-running or losing it:

- if the stop was registered before dispatch, the same directive remains the next dispatch;
- if the stop was registered during Bob execution or verification, the same atom remains active and the
  runner continues from the recorded wait/monitor point;
- no new atom number is allocated until the parked atom reaches its ordinary verified, blocked, or
  wrapped outcome.

Phase 2 is ordered after Phase 1 because `held` must first be represented as a durable, non-terminal,
resume-ready state before the transition back to `running` can be correct.

### Authority and scope

Stop is founder-explicit-only, using the same authority bar as teardown from the F20 lineage. There is no
persona self-stop path: a persona may write the stop-signal artifact only when it is recording an explicit
founder direction for that run.

Stop is not teardown. This ADR does not change `cocoder oz teardown`, `POST /runs/:id/teardown`, or the
pane-closing semantics of `teardownRun()`. It also does not redefine the existing dashboard/Oz
`POST /runs/:id/stop` control as a persona command. Build work may align that endpoint's settled status
with `held`, but the founder-stop control introduced here is the file-based persona-to-runner signal and
its halt-only `held` disposition.

### Disposition vocabulary (one owner)

`held` joins a disposition vocabulary that is already easy to conflate, so this ADR fixes one owner for the
distinctions the runtime, prompts, and personas must use:

- **`held`** — the loop is paused mid-flight at a known atom boundary; resume re-enters at the parked atom
  (this ADR). Non-terminal, resume-ready, panes open.
- **`wrapup`** (logical close) — the run's work for this launch is complete; there is no parked atom and
  resume is a *fresh launch*, not a re-entry.
- **`stopped`** — the existing terminal disposition from `stopRun()`: the run ends, the active atom is
  abandoned and quarantined. Reserved for genuine termination, never for a founder halt that promises resume.
- **teardown** — a pane/session lifecycle action, never a run disposition.

This distinction is normative because run_192 showed the gap concretely: with no `held` available, a persona
expressed a founder "stop" as a `wrapup` directive — the only non-terminal option — even though no work was
in flight. After Phase 1, a founder halt mid-flight must route to `held`, not `wrapup` or `stopped`.

## Consequences

- A founder can tell any active persona to stop the run and get an actual halt, without asking a persona
  to perform host/process lifecycle work.
- The runner, not the persona, remains the owner of loop control. Prompt-only stop behavior is incomplete
  unless the runner, monitor/nudge polling, status projection, and tests consume the same stop artifact.
- `held` separates three concepts that are currently easy to conflate: halt the loop, terminally stop a
  run, and tear down panes.
- The current terminal `stopRun()` behavior remains evidence for what **not** to do in Phase 1: a founder
  halt must not abandon or quarantine the active atom if the design promises resume.
- Resume becomes a first-class lifecycle transition instead of a manual restart convention.

**Verified when:**

- Phase 1 has a runner test proving that once a founder stop is registered, the loop emits no further
  nudges or dispatches and reaches a clean `held` state.
- Phase 1 has a test proving founder-explicit-only enforcement: no persona self-stop path exists.
- Phase 1 lands with ticket 0031 closed.
- Phase 2 has a runner test proving a `held` run resumes from the parked atom without re-running it or
  losing it.
