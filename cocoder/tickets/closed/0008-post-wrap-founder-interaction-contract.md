---
id: 0008
title: Wrapped Oscar is reachable but lacks a committed post-wrap action path
type: bug
status: Closed
priority: governance-authoring-plays
owner: deb
created: 2026-06-16
closed: 2026-06-16
---

# 0008 — Wrapped Oscar is reachable but lacks a committed post-wrap action path

## Context
Founder report during run_99: after Oscar wraps, the founder still expects to ask questions, make
decisions, and direct small governance follow-ups. That is the intended human contract: wrap-up is a
checkpoint, not teardown.

The immediate focus bug was fixed in `packages/daemon/src/launcher.ts`: `showRun` now prefers a live
Oscar pane after wrap instead of focusing the most recent live session (often Deb/Bob), with regression
coverage in `packages/daemon/tests/mutations.test.ts`.

## Bug
The larger action path was incomplete. After wrap, `runRun` broke out of the loop, wrote `run-end`, and
no runner-owned commit gate watched Oscar. A live Oscar pane could answer questions and help classify
decisions, but file-changing founder-directed work after wrap did not have a first-class committed path
from Oscar.

This conflicted with the base Oscar persona, which says founder-directed Surface-A edits remain
committable after wrap-up delivery. Before the run_105 repair, the runtime surface still behaved like
the older prompt contract: questions were fine; file changes needed a fresh committed path.

## Recurrence — run_105

The same class recurred during `priority-audit`: the audit table existed, but after wrap-up Oscar refused
to continue the run or update the priority with the findings, leaving the founder without a durable
pickup in the priority. The live Deb status feed also projected the stale instruction:
`file-changing follow-ups need a new committed run path or explicit teardown`.

Immediate repair applied in this ticket's scope:
- The Oscar launch prompt now says wrapped Oscar remains reachable until explicit teardown and must make
  founder-directed Surface-A edits inside support scope.
- The wrap-up delivery prompt now says a post-wrap priority/governance/doc edit is allowed and must not
  be refused because the run already wrapped.
- The Deb status feed's wrapped wait condition no longer tells file-changing follow-ups to start a new
  path.
- Runner tests now pin the allowed post-wrap Surface-A contract instead of the old refusal.
- A daemon-owned post-wrap support commit path now exists: `POST /runs/:id/support-commit` and Oz chat
  `commit-support <runId>`. It uses `runCommitGate`, records a commit link on the original run, emits a
  `post-wrap-support-commit` event, and returns committed paths / commit SHA / out-of-lane flags as the
  receipt.

## Resolution — 2026-06-16

Closed by adding the explicit committed path rather than relying on the wrapped runner loop to keep
polling after `run-end`.

Owner map:
- Source of truth: base Oscar + shared Surface-A rule say founder-directed governance/support edits stay
  allowed after wrap-up until explicit teardown.
- Runtime commit owner: daemon mutation `requestSupportCommitRun` commits post-wrap support dirt for the
  original run through `runCommitGate`.
- Founder/Oz surfaces: HTTP `POST /runs/:id/support-commit`, Oz chat `commit-support <runId>`, Oscar
  launch prompt, wrap-up delivery prompt, and Deb status projection.
- Pinning tests: `packages/core/tests/runner.test.ts` for prompt/status; `packages/daemon/tests/mutations.test.ts`
  for HTTP + Oz chat commit receipts.

Verification:
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder' exec vitest run packages/core/tests/runner.test.ts packages/daemon/tests/mutations.test.ts`
  → 168 tests passed.

## Addendum — same wrapped run still marked in-flight

Founder report during run_106 exposed a missed subcase in the closed repair: the daemon support path
existed, but `requestSupportCommitRun` rejected whenever the workspace still appeared in `ctx.inFlight`.
That is valid for a different active run, but invalid for the same run after logical wrap-up: Oscar is
intentionally still live for founder questions and Surface-A edits, so the support command must be able
to commit that wrapped run's dirt.

Repair:
- `requestSupportCommitRun` now blocks a running run or a different in-flight run, but allows the same
  non-running run id while its wrapped Oscar surface remains live.
- `packages/daemon/tests/mutations.test.ts` now pins the same-run case: completed run, live Oscar,
  `ctx.inFlight` set to that run id, `POST /runs/:id/support-commit` returns a commit receipt.
- `cocoder oz commit-support <runId>` now exists as a real CLI command over the authenticated daemon
  endpoint. It is explicitly not a lifecycle command: it does not stop/restart/teardown processes or
  touch panes.
- Base Oscar and the generated runner prompt now tell Oscar to run that support-commit command himself
  after a post-wrap Surface-A edit and report the receipt, rather than telling the founder to do it.

Verification:
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder' exec vitest run packages/daemon/tests/mutations.test.ts`
  → 97 tests passed.
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder' exec vitest run packages/core/tests/runner.test.ts packages/daemon/tests/mutations.test.ts`
  → 169 tests passed.
- `pnpm --dir '/Volumes/NAS LOCAL/CoCoder' exec vitest run packages/cli/tests/client.test.ts packages/core/tests/runner.test.ts packages/daemon/tests/mutations.test.ts`
  → 174 tests passed.

## Ask
Add a durable post-wrap founder-interaction contract:
- After wrap-up delivery, keep Oscar reachable for founder questions/decisions while the pane is live.
- Provide a runner/daemon-owned way for founder-directed governance edits made from that wrapped Oscar
  surface to commit through the spine, or explicitly route them to an existing committed path such as
  Oz repair/authoring Plays.
- Align the runtime status text, Oscar prompt text, daemon Show behavior, and tests so they all state
  the same contract.

## Boundary
This is orchestration/runtime behavior, not a product feature. It should not reintroduce run branches
or post-settle stranded commits.
