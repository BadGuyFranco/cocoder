# Taxonomy & authoring — the WISER revisit (design note)

**Status:** Accepted (founder + Claude, 2026-05-29) → [ADR-0010](./decisions/0010-taxonomy-and-authoring.md).
The adversarial review below ran (30 findings → 1 confirmed blocker + 1 heeded F1/F2 refinement folded
in; rest misread/overstated).

This note records the outcome of revisiting CoCoder's terminology and how plans/priorities are
authored, against *The WISER Method* (and AI First Principles) as adapted for agentic coding. The
binding filter was the charter disciplines (D1–D6) and the failure catalog (esp. F1/F4/F5), plus the
book's own anti-theater test: *does it change a decision or catch a failure?* If not, it's out.

## The headline finding

The book is **overwhelmingly validating, not additive** — same DNA as the charter. The 12 Principles
already live, distributed into their correct homes (P1≈write-scope default-deny; P2/P4/P8≈shared-
standards #3/#8; P3/#9≈decision-classifier; P5≈the CLI-visibility conviction; P7/#2≈research-before-
replace; P10/P11≈D6; P12≈build-vs-adopt). Importing them as a layer would create a **second home** for
values we already home — F4/F5 by definition. So the disciplined move was to adopt **almost nothing as
structure**, and only what is genuinely not-yet-homed.

## Adopted (three nouns, and one earned lifecycle)

| Term | Means | Home |
|---|---|---|
| **Playbook** | The per-priority plan document. Born a *stub* and stays one: Objective + its one-line boundary. Static governance, human-owned. | git-tracked `cocoder/priorities/*.md` (governance) |
| **Play** | A reusable procedure runnable without its author. *Renames ADR-0005's "sub-task."* One category, two attributes: **headless** (e.g. `code-review`, read-only) vs **interactive** (e.g. `create-priority`, founder-gated, writes governance). | governance files (Play registry / persona dir) |
| **Objective** | The founder-owned, verifiable outcome — *the outcome AND how it's verified*. Subsumes "Success"/"Done-when". | the Objective section of a Playbook |

**Objectives are the front door (earned — D2).** Observed failure: priorities defined without the
founder owning the objective produced bad code (CoBuilder). Fix:

- **A `create-priority` Play**, invokable by **both Oz and Oscar** — the same rigor in one procedure,
  so neither entry point can skip it (the teardown shared-operation pattern). Steps: *define Objective
  → conflict-scan → plain-English articulation → founder approval → write the stub Playbook.*
- **Conflict-scan** reads the codebase + the other Playbooks + the ADRs, and **surfaces** collisions to
  the founder in plain English. It is **judgment, never a deterministic checker** over our governance
  (the instant it "fails on a detected conflict," it is F5 — forbidden). It is a **creation-time aid**:
  its residue is a *sharper Objective*, not a stored conflict field (freezing a cross-priority reference
  into a Playbook would dangle when the other priority changes — F1/F2).
- **The founder owns the Objective** (P3). A model may do the scan grunt-work and draft phrasing; the
  call is the founder's. Even the Oz entry path delegates the scan to a model (cheap tier is fine).
- `create-priority` writes the **governance zone** (`cocoder/priorities/**`), not `packages/**` — which
  is why "Play" must admit interactive, governance-writing procedures (amends ADR-0005's headless-only
  framing).

## The stub stays a stub (stability, not completeness — reaffirms ADR-0003)

A priority isn't fully understood at creation; understanding deepens through the first run and must
persist for the next (F8 continuation; WISER "day-one questions → end-answers"). **Where** the answers
accumulate is decided by *stability*, not completeness:

- **Playbook (governance, git, human-owned, stable across runs):** Objective + its boundary. Revised
  only by the founder, rarely, and only when the *Objective itself* is wrong.
- **Operational record (DB + projections, churns freely):** plan, decomposition, progress, learnings,
  and **"resume here."** *This* is what fills out across runs — and it mostly exists already (run
  receipt + Oscar's wrap-up pickup brief). The one missing piece: the **pickup brief becomes a
  per-priority projection** (queryable), so run N+1 finds where run N left off instead of it being
  orphaned in a run dir.

Oz **renders** the stable Objective beside the current state + pickup. The bytes live in their correct
homes; the view composes them (ADR-0003: receipts are write-once projections, never read back as
truth). An agent **never** rewrites a Playbook file; an Objective revision routes back through the
`create-priority` approval rigor.

## Rejected (and why — the anti-theater results)

- **The 12 Principles as a doc/layer** — already distributed; importing = F5/D4.
- **W-I-S-E-R Canons as a phase taxonomy** — a second lifecycle vocabulary over `run→session→
  work_item→event`, with no one home and no earned failure. Useful only as Oscar's *private* reasoning,
  never a system label.
- **Positions as personas** — the book itself says skip; personas + the earned Phase-4 review lane
  cover it. ("Sentinel" is a possible future name for that lane. Optional, later.)
- **The self-mutating Playbook** — collides with ADR-0003; the run fills the *operational* record, not
  the governance file.
- **The 9-field Play schema applied to Playbooks** — that's the template for authoring **Plays**, not
  Playbooks. On a Playbook: only **Objective** (absorbs Success + a one-line boundary) + **conflict
  context** (absorbs the kernels of Inputs/Pitfalls). **Position is a HARD OUT** — "who executes" in the
  priority file *is* the `supportedPriorityOwners` reverse-pointer that caused **F1**; staffing stays
  runtime (ADR-0005). Steps/Tools/Variations are execution/template detail, out of governance.

## Homes (D4 — one concept, one home)

| Concept | One home |
|---|---|
| Objective (what + how-verified) | Playbook governance file |
| Plan / decomposition / steps | Oscar's per-run delegation (operational) |
| Progress / learnings / "resume here" | DB + per-priority pickup projection (operational) |
| Who executes (staffing) | runtime, by the orchestrator (ADR-0005) — never the Playbook |
| Reusable procedure (Play) + its pitfalls/variations | the Play file (governance) |
| Cross-cutting rules | shared-standards (unchanged) |

## What the adversarial review must probe

1. **F1 regression:** does any path let staffing/ownership leak into the Playbook file?
2. **F4 drift / two-homes:** does the stub-vs-operational split actually hold, or does "render
   together" smuggle operational state into governance?
3. **F5:** is the conflict-scan unambiguously *surfaced-not-gated*? Any wording that invites a checker?
4. **D1 seam-vs-feature:** is anything here (the `create-priority` Play, the per-priority pickup
   projection, the Oz "New Priority" affordance) being treated as foundation when it's cheap backlog?
5. **D6:** is the minimal earned slice clear (objective field + presence-gate + Oscar steer using the
   existing pane), with the rest deferred?
6. **Honest boundary (F11):** the Objective presence-gate is thin (it can't tell a real objective from
   a lazy one). Is that stated, with the behavioral steer named as the real defense?
