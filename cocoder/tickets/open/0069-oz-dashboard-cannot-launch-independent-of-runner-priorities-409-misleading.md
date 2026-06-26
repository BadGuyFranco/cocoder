---
id: 0069
title: Oz/dashboard cannot launch independent-of-runner priorities; 409 is misleading
type: bug
status: Open
priority: none
owner: founder-session
created: 2026-06-26
---

# 0069 — Oz/dashboard cannot launch independent-of-runner priorities; 409 is misleading

## Context
Launching an `independent-of-runner: true` priority (e.g. `local-cache-retention`) from
the Oz dashboard fails confusingly. There is no founder-facing way to start the runnerless
path from the dashboard at all, and the error the founder sees is wrong.

Root causes (verified by reading the code on 2026-06-26, run_253):

1. **The daemon refuses correctly, but the UI masks the reason.**
   `launchRun` in `packages/daemon/src/launcher.ts:812-825` returns a *specific* 409 for an
   independent-of-runner priority: `code: 'independent-of-runner-required'` with the message
   "Priority ... is marked independent-of-runner and must be executed via the runnerless path,
   not the deterministic daemon runner." That is the right rejection. **But** `doLaunch` /
   `doLaunchTicket` in `packages/ui/src/renderer/App.tsx:591-594` and `622-625` hardcode
   `'A run is already in flight for this workspace.'` for **every** 409, discarding the
   daemon's real `error` string. So the founder sees "already in flight" even when no run is
   active — the misleading message in the report. (The bridge `request()` in
   `packages/ui/src/main/daemon-client.ts:92` already preserves the daemon `error` text in
   `MutationResult.error`, but drops the structured `code`; the UI ignores both.) This same
   masking also hides the `self-impacting-priority` 409 (launcher.ts:827-840).

2. **No founder-facing runnerless launch affordance exists.** The only entry point to the
   runnerless path is the CLI `cocoder run-independent <priorityId>`
   (`packages/cli/src/run.ts`, `runStandalone`). The dashboard "Launch" button only ever
   POSTs to `/runs` (the deterministic daemon runner). There is no button, endpoint, or
   handoff that detects an independent-of-runner priority and opens / hands off to a
   runnerless cmux Claude Code session with full repo context and begin-run instructions.

3. **Runnerless work is not discoverable from Oz/dashboard status.** Independent-of-runner
   priorities are not visibly flagged in the dashboard as "needs runnerless launch," and a
   pending/handed-off runnerless session has no status surface before it writes its first run
   record to the store.

4. **Governed write / repair failed while filing this very bug.** The founder reported that
   Oz governed write actions / repair failed when trying to create the ticket for this bug.
   Likely cause: a governed write was attempted while run_253 was active. Ticket 0063 (closed
   2026-06-26) made authoring (create/close/repoint/reorder + priority-create)
   *accept-and-queue* during an active run, but the Oscar→Deb repair path
   (`request-deb-repair`) still refuses during an active run by design. The exact command and
   error the founder hit were not captured. This ticket itself was filed by Oscar directly via
   support write scope (`cocoder/tickets/**`) as the workaround.

## Acceptance
- Launching an independent-of-runner priority from the dashboard **does not** attempt the
  deterministic daemon runner and **does not** show the "already in flight" message when no
  run is active. The founder sees the real reason (independent-of-runner) verbatim from the
  daemon, not a hardcoded 409 string. (Minimal slice: branch the UI 409 handler on the daemon
  `error`/`code` instead of hardcoding; preserve `code` through `daemon-client.ts request()`.)
- The founder-facing launch **detects** independent-of-runner priorities and either opens, or
  hands off to, the runnerless cmux Claude Code path with full repository context and clear
  begin-run instructions (e.g. a launch action that surfaces / runs `cocoder run-independent`,
  or writes a durable explicit handoff artifact the founder can act on).
- Oz/dashboard status makes runnerless work discoverable: independent-of-runner priorities are
  flagged as such, and a pending runnerless handoff/session is visible before its first run
  record lands.
- The missing-bug ticket is recorded in the governed set (this ticket, 0069). Separately,
  capture the exact `request-deb-repair` / governed-write failure the founder hit (command +
  error) so it can be triaged; if it is a regression rather than the by-design active-run
  refusal, file or fold in a follow-up.

## Notes
- Defect class: founder-facing launch must respect the **two-path** model (daemon runner vs
  runnerless) end to end — UI, daemon response surfacing, launch affordance, and status — not
  just at the daemon refusal. Check the `self-impacting-priority` 409 path for the same UI
  masking; both 409 codes deserve real messages.
- Scope split for the implementer: AC-1 (un-mask the 409 + preserve `code`) is a small,
  low-risk UI/bridge fix. AC-2/AC-3 (runnerless launch affordance + discoverability) are
  net-new product behavior spanning daemon + UI + cmux session creation and warrant their own
  Objective; consider promoting that slice to a priority when launched rather than treating it
  as a one-line fix.
- Relevant code: `packages/daemon/src/launcher.ts:757-846` (in-flight guard +
  independent-of-runner + self-impacting 409s), `packages/ui/src/renderer/App.tsx:574-635`
  (doLaunch/doLaunchTicket 409 handling), `packages/ui/src/main/daemon-client.ts:89-94`
  (bridge drops `code`), `packages/cli/src/run.ts` (`runStandalone` = the existing runnerless
  path), ADR-0043 (runnerless execution shape), ADR-0042 (run concurrency model).
- `local-cache-retention` (`cocoder/priorities/local-cache-retention.md`, `destructive: true`,
  `independent-of-runner: true`) is the live reproducer and first real consumer of the
  runnerless path.
