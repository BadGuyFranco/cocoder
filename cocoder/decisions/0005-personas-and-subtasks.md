# ADR-0005 — Personas + delegatable Plays (seam S5; dissolves S9)

**Status:** Accepted (founder + Claude, 2026-05-28)
**Seam:** S5 — persona / model-tiering contract. **Also resolves S9** (collaboration) by
dissolving the standing-route concept rather than rebuilding it.
**Charter:** [0001](./0001-rebuild-charter.md) · **Builds on:** [0003](./0003-data-model-hybrid.md), [0004](./0004-process-architecture.md) · **Relates to:** [0008](./0008-repository-topology.md) (persona/Play definitions are flat files), [0010](./0010-taxonomy-and-authoring.md) (Play taxonomy & authoring lifecycle) · **Touches seams:** S6 (adapter), S7 (write-scope), S8 (extensibility)

## Context

v1 had heavy persona contracts *plus* separate profiles (model maps) *plus* routes
(collaboration). Routes **owned** priorities (`supportedPriorityOwners`) — the F1 ghost cause —
and the config was smeared across files (F4). v2 needs a minimal persona and **founder control
over which CLI+model does what**, without that fragmentation.

## Decision

### Two tiers

1. **Top-level personas** — the roles you launch/assign (orchestrator, builder, test,
   experience, …). A persona = `{ id, label, role/prompt, cli+model, declaredPlays[] }`.
   The orchestrator assigns work to other top-level personas (persona-to-persona).
2. **Plays** — a **shared registry of delegatable procedures**: `wrap-up`, `code-review`,
   `documentation`, `internal-research`, `external-research`, … Each Play has a default prompt
   and a default write-scope. A persona declares which Plays it delegates. A Play is either
   **headless** (a read-mostly sub-agent dispatch, e.g. `code-review`) or **interactive**
   (founder-gated, may write governance, e.g. `create-priority`) — the headless/interactive
   taxonomy is owned by [ADR-0010](./0010-taxonomy-and-authoring.md).

### Model control (the founder knob) — multi-level, all set in the Oz persona settings panel

- per **persona**: `cli + model`
- per **(persona, Play)**: `cli + model`

So `code-review` can run cross-vendor (e.g. cursor-agent) while the persona codes on Codex —
your adversarial thesis as a literal, per-Play setting. **Nothing improvises model choice.**

### Delegation depth

**One level for MVP** — a persona delegates a Play to a sub-agent; that Play's sub-agent does not
itself delegate further. Keeps fan-out bounded.

### Homes (charter D4 — one concept, one home)

- **Persona definitions + Play catalog** (types + default prompts): the **base set is a referenced
  package** (`@cocoder/personas`), improved centrally; a repo layers deltas + repo-only personas as
  flat files in its `cocoder/personas/` zone (ADR-0008/0012). *Not* `core` built-ins.
- **Model assignments** (per-persona, per-(persona, Play)): **workspace governance config** —
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
a persona's Play registry, founder-configured. No reverse-ownership pointer (**kills F1**), no
multi-file route sync for this concept (**kills F4** here). Collaboration = the delegation graph,
fully under your control.

## Consequences

- **Plays are a known registry**, so the deterministic layer (S7) can reference them —
  e.g. "a code change must pass the `code-review` Play before commit" becomes a checkable
  rule, not prose.
- Model control is multi-level and entirely yours; the orchestrator's only freedom is *which*
  configured persona/Play to involve.
- Play **catalog extensibility** → S8. **Write-scope** per persona/Play → S7. Per-CLI
  **auth/sandbox** for headless Plays → S6.
- The local contract for how a persona invokes a Play is implementation, not a seam (D1).

## History

- **2026-05-30:** Folded the two amendments this ADR carried into the body above so it reads as
  current truth (per ADR-0014): [ADR-0010](./0010-taxonomy-and-authoring.md) renamed "sub-task"
  → **Play** and added the headless/interactive attribute; [ADR-0008](./0008-repository-topology.md)
  placed persona/Play *definitions* as flat files in `cocoder/personas/` (default set in
  `templates/`, loader in `core`) rather than core built-ins. The Play taxonomy itself remains
  owned by ADR-0010.
