---
id: oz-autonomy
title: Oz autonomy — conversational authoring and self-directed governance edits (write layer)
---

> **Archived 2026-06-23 (founder) — code-complete and proven.** All five "Verified when" bullets met
> with runnable proof: `node scripts/proof-oz-autonomy.mjs` passes 6/6 clauses (exit 0). ADR-0040
> Accepted (carry-forward pointers in ADR-0016/0017/0025 + index). Atoms: core scope guard `96f98e4`,
> `oz-action` lane `89c61eb`, code-level Objective guard `9acfaac`, proof harness `1f29cd6`. Bullet 1
> (conversational author-commit, no adhoc run) uses the existing `author` tool — no new code. Follow-up:
> ticket [0044](../../tickets/open/0044-deb-nudge-fabricated-out-of-scope-event.md) (Deb nudge
> reliability), not blocking.

## Objective

Make Oz a genuinely autonomous control-plane agent on the **write** side, layered on the read/answer
foundation in [oz-file-access](oz-file-access.md). After this lands, Oz can (a) **author priorities
conversationally** — draft an id/title/Objective with the founder in dashboard chat and commit it on the
founder's go-ahead through the existing `author` spine, instead of the founder hand-filling fields or
launching a run; and (b) **self-direct bounded, reversible governance edits without per-action approval** —
reorder priorities, open/close tickets, and make narrow documentation fixes — with the daemon gate-committing
only allowed paths as an `oz-action` commit and holding everything else back.

The **Objective-creation gate stays with the founder** (ADR-0010): Oz may *draft* a new priority's Objective
and surface it, but a brand-new priority's Objective is committed only on explicit founder approval. Oz's
no-approval self-direction covers reversible edits to *existing* governance (reorder, tickets, doc fixes,
edits to existing priorities that do not change a founder-approved Objective) — never net-new Objectives,
never product code, never secrets or install state.

**Governance gate (first deliverable, before any build atom):** this priority reverses standing decisions and
must be opened by **one new founder-approved ADR** that amends ADR-0016 (repair is idle-only and scoped),
ADR-0017 (bounded tool surface; "read facts from disk, don't burn model calls"), and ADR-0025 (authoring
cannot fabricate the founder-approved id/title/Objective). The ADR defines the self-direct write scope, the
gate-commit lane (`oz-action`), and the hard exclusions. No build atom lands before the ADR is approved.

**Verified when:**

- Oz creates and commits a priority from a conversational chat exchange (founder supplies/approves the
  Objective) via the `author` spine — proven by a run/daemon record plus the committed `cocoder/priorities/*`
  file, with **no adhoc run launched**.
- Oz performs a self-directed reversible governance edit (a reorder, a ticket close, or a doc fix) and the
  daemon gate-commits it as an `oz-action` commit whose receipt shows **only allowed paths landed** and any
  out-of-scope path **held back**, not silently committed or dropped.
- A code-level scope guard is proven by test: Oz **cannot** write product code (`packages/*/src/`), secrets,
  or install-local state even in self-direct mode, and **cannot** commit a net-new priority Objective without
  the founder-approval field present.
- The amending ADR is founder-approved and the superseded clauses in ADR-0016/0017/0025 carry forward
  pointers to it (one-owner / current-truth).

**Boundary:** write-side autonomy over governed flat files only, layered on `oz-file-access` (which must land
first or concurrently for the read/answer path). Out of scope and explicitly forbidden in self-direct mode:
target/product code (`packages/*/src/`), secrets, install-local state, process/window/daemon lifecycle
(unchanged — F20/teardown rules hold), and any net-new priority Objective without founder approval. This
priority does not change teardown or stop semantics.

**Disposition: `archive-candidate` (run_68/run_212).** All five Verified-when bullets met; proven by
`node scripts/proof-oz-autonomy.mjs` (exit 0). No buildable atoms remain. Founder archive confirmation
only.
