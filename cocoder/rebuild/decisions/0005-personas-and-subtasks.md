# ADR-0005 — Personas + delegatable sub-tasks (seam S5; dissolves S9)

**Status:** Accepted (founder + Claude, 2026-05-28)
**Seam:** S5 — persona / model-tiering contract. **Also resolves S9** (collaboration) by
dissolving the standing-route concept rather than rebuilding it.
**Charter:** [0001](./0001-rebuild-charter.md) · **Builds on:** [0003](./0003-data-model-hybrid.md), [0004](./0004-process-architecture.md) · **Touches seams:** S6 (adapter), S7 (write-scope), S8 (extensibility)
**Amended by:** [ADR-0008](./0008-repository-topology.md) — persona *definitions* are flat governance markdown files (+ scripts) in `cocoder/personas/`, default set shipped in `templates/`, loader in `core`. (Replaces this ADR's "core built-ins" phrasing for persona definitions; model assignments remain Oz-edited settings as below.)
**Amended by:** [ADR-0010](./0010-taxonomy-and-authoring.md) — "sub-task" is renamed **Play**, and a Play may be *interactive + governance-writing* (e.g. `create-priority`), not only a headless read-mostly sub-agent dispatch. The registry, scopes, and one-level-delegation decisions below are unchanged.

## Context

v1 had heavy persona contracts *plus* separate profiles (model maps) *plus* routes
(collaboration). Routes **owned** priorities (`supportedPriorityOwners`) — the F1 ghost cause —
and the config was smeared across files (F4). v2 needs a minimal persona and **founder control
over which CLI+model does what**, without that fragmentation.

## Decision

### Two tiers

1. **Top-level personas** — the roles you launch/assign (orchestrator, builder, test,
   experience, …). A persona = `{ id, label, role/prompt, cli+model, declaredSubTasks[] }`.
   The orchestrator assigns work to other top-level personas (persona-to-persona).
2. **Sub-tasks** — a **shared registry of delegatable support-work types**: `code-review`,
   `documentation`, `internal-research`, `external-research`, … Each type has a default prompt.
   A persona declares which sub-tasks it delegates; each fires to a **headless sub-agent**.

### Model control (the founder knob) — multi-level, all set in the Oz persona settings panel

- per **persona**: `cli + model`
- per **(persona, sub-task)**: `cli + model`

So `code-review` can run cross-vendor (e.g. cursor-agent) while the persona codes on Codex —
your adversarial thesis as a literal, per-sub-task setting. **Nothing improvises model choice.**

### Delegation depth

**One level for MVP** — a persona delegates to headless sub-agents; a sub-agent does not itself
delegate further. Keeps fan-out bounded.

### Homes (charter D4 — one concept, one home)

- **Persona definitions + Play catalog** (types + default prompts): the **base set is a referenced
  package** (`@cocoder/personas`), improved centrally; a repo layers deltas + repo-only personas as
  flat files in its `cocoder/personas/` zone (ADR-0008/0012). *Not* `core` built-ins.
- **Model assignments** (per-persona, per-(persona, sub-task)): **workspace governance config** —
  a tracked default + a `cocoder/local/` per-machine override (which CLIs are installed varies
  by machine). Edited via Oz: **Oz writes config *files*; the SQLite DB stays operational-state
  only** (consistent with ADR-0003).

### Persona-to-persona assignment (MVP default)

The orchestrator decides **at runtime** which top-level personas to involve — but only from the
personas you've defined, on the models you've set (the control box). Making this *declarative*
(pre-staffing a priority) is deferred; it's pure config and cheap to add later (D1). Flagged as
revisitable, not locked shut.

## Why this dissolves S9 (collaboration)

"Who reviews / documents / researches" is no longer a standing route that owns priorities — it's
a persona's sub-task registry, founder-configured. No reverse-ownership pointer (**kills F1**), no
multi-file route sync for this concept (**kills F4** here). Collaboration = the delegation graph,
fully under your control.

## Consequences

- **Sub-task types are a known registry**, so the deterministic layer (S7) can reference them —
  e.g. "a code change must pass the `code-review` sub-task before commit" becomes a checkable
  rule, not prose.
- Model control is multi-level and entirely yours; the orchestrator's only freedom is *which*
  configured persona/sub-task to involve.
- Sub-task **catalog extensibility** → S8. **Write-scope** per persona/sub-task → S7. Per-CLI
  **auth/sandbox** for headless sub-agents → S6.
- The local contract for how a persona invokes a sub-agent is implementation, not a seam (D1).
