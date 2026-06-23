# `cocoder/priorities/` — Playbooks (v2)

One **Playbook** per priority: a flat markdown file, `*.md`, named by the priority slug
(kebab-case, descriptive). This is the v2 model — governed by
[ADR-0010](../decisions/0010-taxonomy-and-authoring.md) (taxonomy & authoring),
[ADR-0003](../decisions/0003-data-model-hybrid.md) (governance = git-tracked flat files;
operational state = the DB), and [ADR-0008](../decisions/0008-repository-topology.md).

## A Playbook is born a stub and stays one

```markdown
---
id: <slug>                 # stable identity; matches the filename
title: <one line>
scopeNarrowing: <glob>     # optional — narrows the builder's persona write-scope; never restates it
---

## Objective
<The founder-owned, verifiable outcome — the outcome AND how it is verified. Subsumes "done-when".
 One line of boundary (what this does NOT touch) folds in here. This is the only required section.>

<Optional context the founder wants on the record. The plan/decomposition does NOT live here —
 that is the orchestrator's job at run time and lives in the run (operational), not this file.>
```

- **The Objective is the front door.** A priority is created via the `create-priority` Play (ADR-0010,
  invokable by Oz or Oscar): *define Objective → conflict-scan → plain-English articulation → founder
  approval → write this stub.* The founder owns the Objective; nothing launches without one.
- **The stub stays a stub.** An agent never rewrites a Playbook. What deepens through a run —
  plan, progress, learnings, "resume here" — is **operational** (the DB + the per-priority pickup
  projection), rendered *beside* the Objective in Oz, not written back into this file.
- **Revising the Objective** routes back through the `create-priority` approval rigor (founder-owned).
- **No `PRIORITIES.md` mirror, no `Owner`/`Canon` headers.** Staffing is decided at run time by the
  orchestrator (ADR-0005), never written into the Playbook — "who owns/executes this priority" in the
  file is the F1 reverse-pointer that caused ghost priorities. The directory listing *is* the index.

## Active vs backlog, and ordering

- **Active priorities** are flat `*.md` files at this top level — the launchable set (the runner/Oz
  scan `priorities/*.md`, non-recursive). **The directory listing is the index of what's active.**
- **Deferred priorities** live in [`backlog/`](./backlog/) — authored so the intent isn't lost, but
  outside the launch glob (no gating code needed). Promote one with a `git mv` up to this level when it
  unblocks; its `## Objective` names what it's blocked on.
- **Ordering is operational, not a file field.** Ordering lives in the order-only runtime overlay
  [`order.json`](./order.json) at this directory level, per
  [ADR-0035](../decisions/0035-priority-creation-always-placed-or-halted.md) and
  [ADR-0038](../decisions/0038-priority-visibility-invariant.md). New live priorities are registered in
  `order.json` by construction at write time — do not edit `order.json` manually when authoring. The
  directory listing is the index of what's active; Playbook files carry **no rank** — identity stays stable
  (the F1 surface).

## Archived history

Completed and frozen priorities live in [`../zArchive/priorities/`](../zArchive/priorities/) — the
v1 folder-priorities (`v0.2-…`…`v0.5-…`, the old route/Canon/Owner model) and archived v2 priorities
alike (reorg, 2026-06-10). Nothing in there is read by the engine; this directory's flat listing is
the only live set.
