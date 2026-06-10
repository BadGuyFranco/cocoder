# ADR-0010 — Taxonomy & authoring lifecycle: Playbooks, Plays, Objectives

**Status:** Accepted (founder + Claude, 2026-05-29). Preceded by a 6-lens adversarial review (30 findings
raised → 1 confirmed blocker + 1 heeded F1/F2 refinement folded in; rest misread/overstated). See
[`../taxonomy-and-authoring.md`](../taxonomy-and-authoring.md).
**Charter:** [0001](./0001-rebuild-charter.md) · **Builds on:** [0003](./0003-data-model-hybrid.md) (stability split), [0005](./0005-personas-and-subtasks.md) (the Play registry), [0007](./0007-write-scope-enforcement.md) (create-priority scope)
**Refines:** [0005](./0005-personas-and-subtasks.md) — names 0005's delegatable-procedure registry **Play** (the term 0005 now uses), and adds that a Play may be *interactive + governance-writing* (not only a headless read-mostly sub-agent dispatch).

> **2026-06-09 amendment (founder, run_46) — priority ordering is a per-workspace order-only manifest, not the DB.** Priorities stay exactly as decided: one human-authored Playbook `.md` per priority in `cocoder/priorities/` (the SSOT for *what exists*). Their **sequence** lives in a small git-tracked **`cocoder/priorities/order.json`** per workspace — an **order-only overlay**: a JSON array of priority ids, nothing else. It does **not** define existence (that would be two owners of "which priorities exist", an F1/F4 trap) — it only sorts. Deterministic reconciliation: a `.md` not named in `order.json` still appears (appended, e.g. alphabetically); an id in `order.json` with no `.md` is ignored. The dashboard's drag-reorder **rewrites `order.json`** (atomic tmp+rename); Oz reads it to sequence the queue. This is a **registry-like overlay the system may write** — distinct from the Playbook bodies, which an agent still **never** rewrites (the rule in *Authoring lifecycle* below is unchanged). Order is **intent**, so it is git-tracked (diffable, travels with the repo on clone) rather than per-machine operational state — which is why it is a file, not a DB row. This **retires** the "ordering source-of-truth migration off `backlog/`+roadmap into the DB" framing (Full Oz dashboard owed slice #8): there is no migration, just a manifest. The `backlog/` directory and roadmap are no longer an ordering source.

## Context

We revisited terminology and how priorities are authored, against *The WISER Method* / AI First
Principles (adapted for agentic coding), under the charter filter (D1–D6) and the failure catalog. The
finding: WISER is mostly *validating* — its Principles already live in the charter + shared-standards +
personas, so importing them as a layer would be F4/F5 (a second home). Two things were **not** yet
cleanly homed: (1) a shared vocabulary aligned with WISER without ceremony, and (2) founder ownership
of the **Objective**, whose absence is an *observed* failure (CoBuilder: priorities defined without a
thought-through objective produced bad code — earns this under D2).

## Decision

### Vocabulary (three nouns; nothing else from WISER adopted as structure)
- **Playbook** — the per-priority plan document (the artifact in `cocoder/priorities/*.md`). Born a
  *stub* (Objective + its one-line boundary) and stays one.
- **Play** — a reusable procedure runnable without its author. **The procedure type in [ADR-0005](./0005-personas-and-subtasks.md)'s registry** (formerly "sub-task"). One
  category, two attributes: **headless** (e.g. `code-review`, read-only) vs **interactive** (founder-
  gated, may write governance). The nine-field WISER Play schema is the template for authoring *Plays*,
  not Playbooks.
- **Objective** — the founder-owned, verifiable outcome (*outcome AND how it's verified*); subsumes
  "Success"/"Done-when". It is the only required authored field of a Playbook.

WISER's **Canons** (phase taxonomy) and **Positions** (personas) are explicitly **not** adopted — no
home, no earned failure; Canons survive only as Oscar's private reasoning.

### Objective ownership — the `create-priority` Play (earned, D2)
- Creating a priority runs the **`create-priority` Play**, invokable by **both Oz and Oscar** (one
  procedure, two entry points — the teardown shared-operation pattern), so the objective rigor can't be
  skipped. Steps: *define Objective → conflict-scan → plain-English articulation → founder approval →
  write the stub Playbook.*
- **Conflict-scan** (codebase + other Playbooks + ADRs) is **probabilistic judgment, surfaced to the
  founder — never a deterministic gate** over governance (a "fail on detected conflict" check would be
  F5). The Oz entry path delegates the scan to a model (cheap tier acceptable). It is a **creation-time
  decision aid**: its durable residue is a *sharper Objective*, **not** a stored conflict field —
  freezing a relational cross-priority reference into a Playbook would dangle when the other priority is
  renamed/retired (F1/F2).
- **Enforcement (D3, honest per F11):** Oz/the runner refuses to launch a Playbook whose Objective is
  **missing or empty (after trim)** — a purely structural fact at the human→system boundary. The system
  **does not** detect lazy or placeholder objectives: that is content judgment over a governance file
  (it would re-seed F5/`check-orchestration-fragmentation` and violate D3/D5/G4). Objective *quality* is
  owned by the founder at approval and by the **behavioral steer** — Oscar must not build on a vague
  objective. (Matches the split in Consequences: deterministic *presence*, probabilistic
  *quality/conflict*, human *approval*.)

### Authoring lifecycle — stub at creation, fill the operational record at run (reaffirms ADR-0003)
- The Playbook holds only what is **stable across runs and human-owned**: Objective + its boundary. An
  agent **never** rewrites it; an Objective revision routes back through `create-priority` approval.
- What deepens through a run — plan/decomposition, progress, learnings, **"resume here"** — is
  **operational**: DB + a **per-priority pickup projection** (the missing piece; today's wrap-up brief
  promoted from run-dir to a queryable per-priority projection so run N+1 resumes — F8). Oz **renders**
  Objective (governance) beside current-state + pickup (operational); bytes stay in their homes.

### Homes (D4)
Objective → Playbook file. Plan/steps → per-run delegation. Progress/pickup → DB + projection. Staffing
→ runtime orchestrator (ADR-0005), **never** the Playbook (writing "who executes" into the priority is
the F1 reverse-pointer). Reusable procedure + its pitfalls/variations → the Play file.

## Consequences

- **Naming aligns with WISER** without importing its ceremony; the rejection list is as load-bearing as
  the adoption list.
- **The Objective becomes a checkable launch precondition** at the human→system boundary, with an
  honest split: deterministic *presence*, probabilistic *quality/conflict*, human *approval*.
- **ADR-0005's registry uses the Play vocabulary** and gains the interactive-Play kind; the registry,
  scopes, and one-level-delegation decisions are otherwise unchanged.
- **No new store** for continuation — the per-priority pickup is a projection (ADR-0003), a query +
  render, not a second source of truth. If "render together" ever copies operational state into the
  governance file, F1/F4 return — that is the one rule to hold. (The pickup depends on the operational
  store keying rows to a **stable priority identity** — a build dependency in Phase 3, not a new
  governance home.)
- **Deferred (D1/D6):** Oz "New Priority" affordance, the conflict-scan automation, and the pickup
  projection are implementation earned during build — not foundation. The minimal first slice is the
  required Objective field + presence-gate + Oscar's framing steer on the existing cmux pane.
