---
id: fix-ticket-0011
title: Fix teardown `#cli` undefined on final Oscar surface (ticket 0011)
scopeNarrowing:
  - packages/daemon/**
  - packages/session-hosts/**
  - cocoder/tickets/**
---

> **Founder-directed 2026-06-17 (run_119 adhoc diagnosis)** — read-only pass root-caused
> [ticket 0011](../tickets/open/0011-teardown-cli-undefined-on-final-oscar-surface.md). Full spec,
> line numbers, and test-gap notes live in the open ticket.

## Objective

Fix the unbound-method `this` regression in `packages/daemon/src/launcher.ts` so
`cocoder oz teardown <runId> --initiator oscar` closes **all** run surfaces — including the final
Oscar surface — with no 500 and no lingering session. **Verified when:** (1) the one-line bind fix
is applied (`closeWorkspace = ctx.sessionHost.closeWorkspace?.bind(ctx.sessionHost)` at launcher.ts:360,
or equivalent receiver-preserving call); (2) `fakeHost().closeWorkspace` in
`packages/daemon/tests/mutations.test.ts` reads `this` so the unbound path fails before the fix and
passes after; (3) `pnpm -w typecheck`, `pnpm --filter @cocoder/session-hosts test`, and
`pnpm --filter @cocoder/daemon test` are green; (4) ticket 0011 is moved to `closed/` with
`INDEX.md` updated. **Boundary:** teardown-only path — do not weaken the run-scoped teardown
boundary or swallow errors.
