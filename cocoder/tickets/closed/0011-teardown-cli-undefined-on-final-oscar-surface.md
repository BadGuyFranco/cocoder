# 0011 — Teardown throws `#cli` undefined closing the run's final (Oscar) surface

**Status:** Closed | **Type:** bug | **Priority:** none (orchestration reliability) | **Owner:** deb
**Filed:** 2026-06-17 | **Closed:** 2026-06-17

## Symptom
`cocoder oz teardown run_116 --initiator oscar` returned **500** with:

```
{"closed":["surface:67","surface:68"],
 "failed":[{"persona":"oscar","sessionRef":"surface:66",
            "error":"Cannot read properties of undefined (reading '#cli')"}],
 "error":"teardown left 1 run session open"}
```

It closed the non-initiator surfaces (Bob `surface:67`, Deb `surface:68`) but failed on the
orchestrator (Oscar) surface `surface:66`, leaving 1 run session open. Observed live during run_116
teardown (founder-explicit). The lingering Oscar surface must be closed by hand by the founder until
this is fixed — the orchestrator must NOT close it itself (host/process-safety guardrail).

## Root Cause
**An unbound-method `this` regression introduced by [0009](../closed/0009-teardown-cannot-close-last-surface.md).**
It is NOT a missing/unresolved `workspaceRef` and NOT the old last-surface invariant.

- `packages/daemon/src/launcher.ts:354` does `const closeWorkspace = ctx.sessionHost.closeWorkspace`, which
  **detaches the method from its receiver** (the host instance).
- `packages/daemon/src/launcher.ts:372` then calls `await closeWorkspace({ workspaceRef })` as a *free
  function*, so inside the method `this` is `undefined`.
- `CmuxDriver.closeWorkspace` (`packages/session-hosts/src/cmux/driver.ts:187-188`) dereferences
  `this.#cli` → throws **`Cannot read properties of undefined (reading '#cli')`** (`#cli` is the private
  field declared at driver.ts:43).

Why only the initiator/final surface fails: Bob/Deb (the *prefix* surfaces) are closed via
`closeDurableSurface` → `ctx.sessionHost.closeSurface({...})` (`launcher.ts:350`), which is called as a
**bound** method and works. Only the **final remaining surface** is closed through the detached
`closeWorkspace` reference in `closeDurableWorkspace` (`launcher.ts:359-378`) — so it alone throws. This
exactly matches the symptom (prefix surfaces `closed`, final Oscar surface `failed` with the `#cli` error).
0010 (UI bundle rebuild) is unrelated — no ordering interplay.

### Re-verified against live code — 2026-06-17 (Oscar, run_119, read-only)
Diagnosis confirmed end-to-end; line numbers drifted, so the builder should target these (not the
originals above):
- Detach: `packages/daemon/src/launcher.ts:360` — `const closeWorkspace = ctx.sessionHost.closeWorkspace`.
- Unbound call: `packages/daemon/src/launcher.ts:378` — `await closeWorkspace({ workspaceRef })`.
- Throw site: `packages/session-hosts/src/cmux/driver.ts:188` — `this.#cli.run(['close-workspace', …])`;
  `#cli` declared at `driver.ts:43`.
- **Test-gap pinned:** the `fakeHost()` in `packages/daemon/tests/mutations.test.ts:186` defines
  `async closeWorkspace(args) { onCloseWorkspace?.(args) }` — its body never reads `this`, so the daemon's
  *unbound* call passes in the test while the real `CmuxSessionHost.closeWorkspace` (which reads `this.#cli`)
  throws in production. The regression must give the fake a `closeWorkspace` that reads an instance/private
  field via `this` (or asserts `this` is the host), so the unbound path fails *before* the fix.

### Fix (minimal, preserves the 0009 design)
Stop detaching the method. Either keep the guard/call on the receiver:
`if (!ctx.sessionHost.closeWorkspace) { … }` then `await ctx.sessionHost.closeWorkspace({ workspaceRef })`,
or bind it: `const closeWorkspace = ctx.sessionHost.closeWorkspace?.bind(ctx.sessionHost)`. Do NOT swallow
the error or weaken the teardown-only-touches-this-run boundary.

### Regression must catch the `this` binding
The current fake host's `closeWorkspace` is likely a plain closure that doesn't depend on `this`, so it
won't reproduce this. The regression needs a host whose `closeWorkspace` reads an instance/private field
via `this` (or asserts `this` is the host) so the daemon's *unbound* call path fails the test before the fix
and passes after.

## Resolution
`packages/daemon/src/launcher.ts` now keeps the `closeWorkspace` optional guard but invokes the method
through `ctx.sessionHost.closeWorkspace({ workspaceRef })`, preserving the cmux host receiver for the
final durable workspace close. `packages/daemon/tests/mutations.test.ts` now makes the shared `fakeHost()`
workspace close receiver-sensitive and covers the Oscar-initiated shared-workspace teardown; the old
unbound call would throw the same `#cli`-style error before marking the final Oscar surface closed.

## Acceptance / Verified When
- `cocoder oz teardown <runId> --initiator oscar` closes **all** of the run's surfaces — including the
  initiator (Oscar) surface — with no 500 and no "left N run session open".
- A regression covers the final/initiator-surface close via the stored workspace ref when the client/ref
  could be undefined (the exact path that threw here).
- Teardown still affects ONLY the run's own surfaces; never the Oz daemon, cmux app, or founder terminals.

## Notes
- Discovered while tearing down run_116 (tickets-review). Run work itself committed cleanly on `main`;
  this defect is in the teardown lifecycle path only.
- Related: [0009](../closed/0009-teardown-cannot-close-last-surface.md) (final-surface close),
  [0010](../closed/0010-auto-rebuild-ui-bundle-after-dashboard-changes.md) (finalization rebuild).
