# ADR-0010 — Taxonomy & authoring lifecycle: Playbooks, Plays, Objectives

> **Extended by [ADR-0020](./0020-primary-root-audit.md) (2026-06-14).** The "a priority is a stub; its
> plan lives in the run, improvised by the orchestrator" rule below governs all **ordinary** priorities.
> ADR-0020 adds ONE narrow second category — **shipped onboarding Playbooks** (bootstrap / takeover /
> drift) — whose multi-phase plan is deliberately *baked into the file* because the process is
> repeatable and high-stakes (improvising it badly is expensive). That exception is scoped to onboarding
> and does not loosen the stub rule for anything else.

> **Amended by [ADR-0028](./0028-play-taxonomy-three-axes.md) (2026-06-20).** The 2026-06-19 "five named
> Play classes" framing below is superseded; the current Play taxonomy is three orthogonal axes
> (`triggerClass`, `executionModel`, `writeScope`) plus the existing `kind` field, with no enum deletion.

**Status:** Accepted (founder + Claude, 2026-05-29). Preceded by a 6-lens adversarial review (30 findings
raised → 1 confirmed blocker + 1 heeded F1/F2 refinement folded in; rest misread/overstated). See
[`../taxonomy-and-authoring.md`](../zArchive/rebuild-notes/taxonomy-and-authoring.md).
**Charter:** [0001](./0001-rebuild-charter.md) · **Builds on:** [0003](./0003-data-model-hybrid.md) (stability split), [0005](./0005-personas-and-subtasks.md) (the Play registry), [0007](./0007-write-scope-enforcement.md) (create-priority scope)
**Refines:** [0005](./0005-personas-and-subtasks.md) — names 0005's delegatable-procedure registry **Play** (the term 0005 now uses), and adds that a Play may be *interactive + governance-writing* (not only a headless read-mostly sub-agent dispatch).

> **2026-06-09 amendment (founder, run_46) — priority ordering is a per-workspace order-only manifest, not the DB.** Priorities stay exactly as decided: one human-authored Playbook `.md` per priority in `cocoder/priorities/` (the SSOT for *what exists*). Their **sequence** lives in a small git-tracked **`cocoder/priorities/order.json`** per workspace — an **order-only overlay**: a JSON array of priority ids, nothing else. It does **not** define existence (that would be two owners of "which priorities exist", an F1/F4 trap) — it only sorts. Deterministic reconciliation: a `.md` not named in `order.json` still appears (appended, e.g. alphabetically); an id in `order.json` with no `.md` is ignored. The dashboard's drag-reorder **rewrites `order.json`** (atomic tmp+rename); Oz reads it to sequence the queue. This is a **registry-like overlay the system may write** — distinct from the Playbook bodies, which an agent still **never** rewrites (the rule in *Authoring lifecycle* below is unchanged). Order is **intent**, so it is git-tracked (diffable, travels with the repo on clone) rather than per-machine operational state — which is why it is a file, not a DB row. This **retires** the "ordering source-of-truth migration off `backlog/`+roadmap into the DB" framing (Full Oz dashboard owed slice #8): there is no migration, just a manifest. The `backlog/` directory and roadmap are no longer an ordering source.

> **Amended by [ADR-0038](./0038-priority-visibility-invariant.md) (2026-06-23).** Runtime reconciliation
> above still appends unlisted priority files, but commit-time governance now enforces the priority
> visibility invariant: every loadable top-level priority must be in `order.json`, archived/backlogged,
> or explicitly allowlisted.

> **2026-06-19 amendment (founder, run_151) — Play taxonomy: trigger class × execution model.** A Play
> now has three independent axes. The existing `kind: headless | interactive` attribute survives
> unchanged as the **write-authority/interactivity axis**: headless Plays do not require founder
> interaction or governance-writing authority; interactive Plays may require founder gates and may write
> governance inside their declared scope. Two additive axes define how a Play starts and whether it has a
> deterministic spine. **Execution model** is `prompt-only` (markdown injected to the LLM; no code spine)
> or `hybrid` (an optional deterministic precheck/gate whose captured result gates or feeds the LLM
> layer). **Trigger class** is `lifecycle-triggered` (runner/daemon invokes at a lifecycle point, no
> persona discretion), `persona-requested` (a persona asks via a typed handoff; the runner validates
> before dispatch), or **tool/API-triggered** (a tool/API call invokes it). These axes are orthogonal, not
> one flat mutually-exclusive class list: a single Play has one trigger class, one execution model, and
> one write-authority/interactivity kind. For example, wrap-up is lifecycle-triggered + prompt-only, while
> code-review is persona-requested + potentially hybrid. This is backward-compatible: existing
> prompt-only Plays remain valid, and no schema change may force a Play to add deterministic code.
>
> The five named Play classes are defined by those axes:
>
> - **Prompt-only Play:** allowed callers are whichever lifecycle, persona, or tool/API surfaces its
>   trigger class permits; its trigger is not defined by being prompt-only; its execution model is
>   LLM-driven markdown with no deterministic precheck/gate; its output is validated by the existing
>   runner, persona, and commit-gate checks for that Play's trigger class and write-authority kind, then
>   committed or returned only through that same path.
> - **Hybrid Play (deterministic precheck/gate):** allowed callers are whichever lifecycle, persona, or
>   tool/API surfaces its trigger class permits; its trigger is not defined by being hybrid; its execution
>   model runs deterministic code first and captures the result as a gate or input to the LLM layer; its
>   output is valid only when the deterministic result is present, accepted by that Play's contract, and
>   the normal runner/commit validation for its write-authority kind also passes.
> - **Lifecycle-triggered Play:** allowed callers are runner/daemon lifecycle points only, not persona
>   discretion; its trigger class is a named lifecycle event; its execution model may be prompt-only or
>   hybrid; its output is validated by the runner against the lifecycle contract and committed only
>   through the normal write-scope and commit-gate path.
> - **Persona-requested Play:** allowed callers are personas authorized by the Play registry and their
>   current scope; its trigger class is a typed persona handoff that the runner validates before dispatch;
>   its execution model may be prompt-only or hybrid; its output is validated against the handoff,
>   declared Play contract, write-scope, and commit-gate before any state is accepted.
> - **Tool/API-triggered Play:** allowed callers are explicitly registered tools or API entry points; its
>   trigger class is the tool/API invocation; its execution model may be prompt-only or hybrid; its output
>   is validated against the request contract, deterministic result when present, declared write authority,
>   and commit-gate before it is committed or returned as authoritative state.
>
> This amendment does not reopen one-level dispatch, does not introduce PlayAssignment multi-binding,
> and does not move full Play-body injection into every prompt. Later schema, manifest, and dispatch work
> must derive labels and contracts from these axes instead of copying a second taxonomy.

> **2026-06-25 amendment (founder, Deb repair) — wrapper-backed Plays must document their executable
> lane.** When a Play can be invoked through a tool, API route, dashboard action, or dedicated CLI
> wrapper, the Play body must name that executable lane in plain text next to the invocation contract:
> the exact tool/API/CLI surface, required fields, defaults supplied by wrappers, the commit or
> validation owner, and the forbidden bypasses. The wrapper must also expose bounded help and missing
> argument errors before treating flags as positional input. This keeps a Play runnable without source
> spelunking and prevents a second, prose-only contract from drifting away from the runtime route.

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
- **Enforcement (D3, honest per F11):** Oz/the runner treats a missing or empty Objective (after trim)
  as a structural required question, not a launch refusal. The run starts with a `Required Questions`
  section that tells Oscar to answer/log the missing Objective in the priority file when evident, or wrap
  with the exact founder input needed when it is not. The system **does not** detect lazy or placeholder
  objectives: that is content judgment over a governance file (it would re-seed
  F5/`check-orchestration-fragmentation` and violate D3/D5/G4). Objective *quality* is owned by the
  founder at approval and by the **behavioral steer** — Oscar must not build on a vague objective.
  (Matches the split in Consequences: deterministic *presence*, probabilistic *quality/conflict*, human
  *approval*.)

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
