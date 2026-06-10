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
- **Ordering is operational, not a file field.** Priorities are resequenced often, and full-Oz's design
  owns *drag-reorder*, so sequencing's real home is Oz/the DB. **Interim** until that ships: the ordered
  roadmap lives in one place — [`PLAYBOOK.md`](../PLAYBOOK.md) "Priority roadmap"
  section (one line each, derived not restated, no owner pointer — so no F1/F4). Playbook files carry
  **no rank** — identity stays stable (the F1 surface).

## v1 history (frozen)

The folder-priorities (`v0.2-…`/`v0.3-…`/`v0.4-…`/`v0.5-…`), `../PRIORITIES.md`, and `zArchive/` are
**frozen v1 artifacts** — they encode the old route/Canon/Owner model the rebuild is escaping and are
not read by v2. Pending a founder decision to archive them under `../rebuild/`-era cleanup.
