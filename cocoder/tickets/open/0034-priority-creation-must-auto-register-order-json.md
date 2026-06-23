---
id: 0034
title: Priority creation must auto-register in order.json (prevent orphans at source)
type: task
status: Open
priority: oz-autonomy
owner: Deb
created: 2026-06-23
---

# 0034 — Priority creation must auto-register in order.json (prevent orphans at source)

## Context

Follow-up to ticket 0032 (closed, commit `4819767`). That fix added the `findOrphanedPriorities` guard +
daemon governance test (ADR-0038): if a `cocoder/priorities/*.md` file is unlisted in `order.json` and not
archived/backlogged/allowlisted, the daemon test suite goes red.

That guard is **detect-and-fail, not prevent.** It assumes some attentive party notices the red and
registers the priority. In this autonomous, no-human-backstop setup there is no reliable "someone": a run
that trips the guard is at best fixed by a future agent and at worst blocked or worked around. ADR-0038
deliberately deferred the real fix, keeping `order.json` an order-only overlay.

The root cause is unchanged: the authoring path can write a priority file **without** scheduling it. Today
multiple paths can each create an orphan:
- the daemon `createPriority` route (`packages/daemon/src/routes.ts:661`),
- the Oz `author` tool,
- the base `create-priority` Play (`packages/personas/base/plays/create-priority.md`),
- direct agent/Oscar support-writes into `cocoder/priorities/**`.

A priority must be **impossible to create without being scheduled** — visible in the active stack by
construction, not by after-the-fact CI.

## Acceptance

**One-owner registration at the single write chokepoint.** The one commit/write spine that lands a
`cocoder/priorities/*.md` file also writes its id into `order.json` (or applies an explicit
`archive/`/`backlog/` placement) **atomically** — so every authoring path funnels through it and **no code
path can produce an orphan.** Do not patch the four paths independently; fix the shared owner so the others
inherit it.

- Keep `findOrphanedPriorities` + its governance test as the belt-and-suspenders net; under normal operation
  it must now never trip.
- Amend ADR-0038 (or add a superseding ADR) to flip the recorded stance from *detect* to *prevent*, noting
  `order.json` registration is now owned by the write spine (reconcile with ADR-0010 priority/order
  ownership and ADR-0025 atomic authoring Plays).
- **Proven by tests:** creating a priority through the daemon route (and the authoring Play path) leaves the
  new id present in `order.json` with no manual step; a test asserts an authoring path cannot land a
  priority file while leaving `order.json` unchanged; the existing guard governance test stays green.

## Notes

- The base `create-priority` Play ships to **every** workspace — this is base-governance under
  `packages/personas/base/**`; route it through a **verified run** (or Deb repair) with the relevant
  persona/Play tests, not a post-wrap support edit. It also touches product code (the daemon route), so the
  per-atom verify gate applies.
- Relates to: ticket 0032 (closed), ADR-0038, ADR-0010, ADR-0025.
- Surfaced by the founder at run_195 wrap: the guard alone is insufficient because "someone fixes the red CI"
  has no reliable owner here, and the orphan can still be created in the first place.
