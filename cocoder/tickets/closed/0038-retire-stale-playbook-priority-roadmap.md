---
id: 0038
title: Retire the stale PLAYBOOK "Priority roadmap"; order.json is the ordering SSOT
type: task
priority: none
owner: Bob
created: 2026-06-23
status: Closed
closed: 2026-06-23
---

# 0038 — Retire the stale PLAYBOOK "Priority roadmap"; order.json is the ordering SSOT

## Context

`cocoder/PLAYBOOK.md` carries a hand-maintained "Priority roadmap" numbered list (≈lines 231–285) that
has drifted badly from the live active set, and `cocoder/priorities/AGENTS.md` (lines 44–48) still names
that roadmap as the interim home for priority ordering. Both statements are now stale:

- **The roadmap reflects a pre-archive snapshot (~run_53–57).** It lists **13** entries; `order.json`
  has **7**. Of the 13, **9 are now in `priorities/archive/`** (`ripgrep-dependency-research`,
  `drift-audit`, `surface-reduction`, `first-class-model-tiers`, `adapter-abstraction-hardening`,
  `deb-follows-oscar`, `deb-oscar-repair-loop`, `orchestration-loop-quality`, `launch-disposition-first`)
  and **3 live priorities never appear** (`oz-autonomy`, `oz-file-access`, `model-layer` — the last
  absorbed the two Grok drafts the roadmap still lists under their old names).
- **Ordering's home has moved to `order.json`.** ADR-0035 (2026-06-22) names placement as
  "`cocoder/priorities/` + `order.json`"; ADR-0038 (2026-06-23) defines `order.json` as the order-only
  runtime overlay with a daemon visibility guard (`findOrphanedPriorities`) enforcing it against the live
  tree. Ticket 0034 hardens registration at the write spine. The `priorities/AGENTS.md` sentence pointing
  ordering to PLAYBOOK predates all three.
- **It drifts because nothing derives it.** The roadmap's only unique content is per-priority status prose
  (`BLOCKED`, `ARCHIVE-CANDIDATE (run_NN)`), which duplicates the priority files and PLAYBOOK's own detail —
  a hand-copied second source, exactly the restate/F1 pattern `priorities/AGENTS.md` warns against. So every
  archive sweep leaves it behind.

## Acceptance

- The "Priority roadmap" numbered list is **removed** from `cocoder/PLAYBOOK.md` (don't reconcile a
  hand-maintained copy that will re-drift — retire it).
- `cocoder/priorities/AGENTS.md` "Active vs backlog, and ordering" section is updated to name **`order.json`
  (+ the directory listing) as the ordering home**, citing ADR-0035/0038, replacing the
  "Interim … PLAYBOOK.md 'Priority roadmap'" pointer. Consistent with that file's own "the directory listing
  IS the index" line.
- Any other live cross-reference that points readers to the PLAYBOOK roadmap as the ordered source is
  repointed to `order.json` (grep `Priority roadmap` across `cocoder/**` and fix live references; leave
  `zArchive/**` untouched).
- No change to runtime behavior — this is governance-doc reconciliation only; the daemon order/visibility
  guards are unaffected.

## Notes

- Pure governed-flat-file edits (`PLAYBOOK.md`, `priorities/AGENTS.md`); route via the documentation Play /
  support-edit path, not a build atom — no product code involved.
- Surfaced 2026-06-23 reviewing whether the active priority stack was sequenced logically. Separate from the
  live-stack finding that `oz-autonomy` is ordered ahead of its dependency `oz-file-access` in `order.json`
  (a direct founder order edit, not this ticket).
- Relates to: ADR-0035, ADR-0038, ADR-0010, ticket 0034.
