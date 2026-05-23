# Sub-Playbook B — Personas and workspace template

**Created:** 2026-05-21 | **Updated:** 2026-05-23 (Activated — Witness/Interrogate/Solve-target populated; Status flipped Draft → Active)
**Type:** One-time
**Collaboration:** Collaborative
**Status:** **Active — Expand complete 2026-05-23; Refine (founder-driven) next**
**Method:** WISER Playbook (Sub-Playbook; Master = `../README.md`)
**Parent:** [v0.1-foundation priority](../README.md)

## Context

Sub-Playbook B owns the persona system (contracts, prompts, public playbook summaries, custom-persona pattern) and the workspace `cocoder/` template + `cocoder init`. This is where CoCoder becomes usable on real repos — A built the resolver and ran the audit-remediation milestone; E proved the orchestration loop on the dogfood workspace; **B makes the engine *do* something for an external adopter**.

The riskiest piece here is twofold: (1) **persona identity drift during the port** — CoBuilder's "session 583 class" of bugs shows that when persona-identity argv and playbook excerpts are not composed verbatim, the runtime persona loses its constraint envelope; (2) **`cocoder init` idempotency** — running it twice on the same workspace must produce no diff, and re-running after a CoCoder `git pull` must surface (not clobber) user-edited tracked files. Both need regression tests, not just manual verification.

**Key files for resume:**

- Master: `../README.md`
- Sub-Playbook A: `./2026-05-21-foundation.plan.md` (Refine-complete 2026-05-23; Final Check ceremony parallel-tracked)
- Sub-Playbook E (Dogfood Ramp): `./2026-05-22-dogfood-ramp.plan.md` (Solve + Expand + Refine all closed; Final Check 5/6 with the remaining item depending on this Sub-Playbook)
- ADR-0001 — Storage zones, license, CoBuilder relationship (governs workspace-zone layout)
- ADR-0002 — Talia/Quinn boundary (governs persona scope)
- ADR-0003 — CLI binary name + env prefix (governs `cocoder init` invocation)
- ADR-0005 — Oz improvement-target routing (governs `cocoder-product` vs `workspace-shared` write zones; relevant when `cocoder init` materializes the workspace boundary)
- ADR-0006 — No workspaces nested inside the install repo (governs `cocoder init` refusal)
- **`cocoder/personas/PORT-NOTES.md`** — Sub-Playbook E's record of what was borrowed (Bob + Talia + 6 shared fragments), what's still pending (5 personas + 1 shared fragment), and the 5 product-code bugs the borrow surfaced. **Read this BEFORE starting Expand.**
- CoBuilder personas: `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/personas/` (private playbook source; read-only borrow target)
- CoBuilder runtime prompts: `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/personas/prompts/`

---

## Preconditions

- [x] Sub-Playbook A reaches Final Check — *Refine-complete 2026-05-23 (M4 Checkpoint); Final Check ceremony parallel-tracked (does not block B's Witness/Interrogate, but should close before B's Solve so the persona-identity regression test runs against a Refine-validated runtime).*
- [x] `packages/core`, `packages/cocoder-cli`, `packages/schemas` operational — *236/236 tests passing as of 2026-05-23.*
- [x] Config resolver proven (A Solve) — *Closed 2026-05-22 with multi-machine portability tests + workspace-private writer (M4.23/Q2=A); secret resolution wired in (M4.5).*
- [x] [Sub-Playbook E (Dogfood Ramp)](./2026-05-22-dogfood-ramp.plan.md) reaches Final Check — provides upstream reuse: Bob + Talia personas (borrowed from CoBuilder, scrubbed), minimal prompt fragments, one profile (`cocoder-dogfood`), one route (`dogfood-port-tests`), and PORT-NOTES documenting divergences. Sub-Playbook B extends, does not redo, this work. — *Complete 2026-05-23.*
- [x] **[Sub-Playbook F (Structural cleanup)](./2026-05-23-structural-cleanup.plan.md) reaches Refine** — provides upstream reuse: canonical `routePriorityIssue` + lane/path helpers + boolean-flag parser + `cli.mjs` command registry + `contracts.mjs` `enum` honoring. Sub-Playbook B Solve specifically depends on F for two reasons: (1) B-M3 adds `init`/`audit-workspace`/`refresh-memory` to the new registry instead of growing the old monolith; (2) B-S2 persona-identity regression test should capture its reference fixture against the post-F composer output bytes (otherwise the fixture has to be regenerated after F lands later). — *Complete 2026-05-23 (Final Check; PR #28 merged `58e1fe2`).*

---

## Authority

**Autonomous:** Persona contract drafts, prompt manifest, playbook summaries, workspace template authoring, `cocoder init` planner + apply, regression tests, Phil example.

**Needs human input:**

- Any redaction call on porting CoBuilder private playbooks (decide what's public vs `local/playbooks/`).
- Any departure from ADR-0002 boundaries.
- **Pending decisions PB-Q1..PB-Q4 below** — these are Sub-Playbook B scope/structure questions the founder needs to resolve before Expand starts. None block Witness/Interrogate; all block their respective Expand milestones.
- Any new ADR (template structure, persona scope, redaction policy) — graduate via the normal ADR process and HOLD FOR GO per the v0.1 completion plan operating mode.

---

## Witness

### Audit findings (Sub-Playbook B activation, 2026-05-23)

| Area | Verified state (2026-05-23) | Implication for B |
|---|---|---|
| Persona library — JSON contracts | `cocoder/personas/bob.json` + `cocoder/personas/talia.json` shipped (Sub-Playbook E borrow; verbatim apart from `allowedRoutes` narrowed to the dogfood route). The other 5 personas (oscar / ian / quinn / phil / verifier) are NOT borrowed. | B-M1 must port the 5 remaining persona JSONs from `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/personas/` and decide for each: ship in v0.1, defer to v0.2, or ship as schema-only example (Phil). |
| Persona library — prompt fragments | `cocoder/personas/prompts/personas/bob.md` + `talia.md` shipped (verbatim). 5 other persona prompts pending (`oscar.md`, `ian.md`, `quinn.md`, `phil.md`, `verifier.md` upstream). | Each ported persona needs its persona-prompt fragment ported in lockstep — the manifest registers persona ↔ fragment pairs. |
| Persona library — shared fragments | 6 of 7 borrowed (closeout, evidence-classes, private-playbook-boundary, result-contract, startup-packet, write-boundaries). 7th (`session-wrap.md`) deferred per PORT-NOTES — borrow only if `compose-launch` reports it missing for a route that adds session-wrap gates. | Borrow `session-wrap.md` opportunistically (any Oscar lead route is the first candidate). |
| Persona library — manifest | `cocoder/personas/prompts/manifest.json` is Bob-only today; CoBuilder's manifest enumerates bob/oscar/talia/quinn/ian/phil/verifier. | B-M1 extends the manifest each time a persona is ported; the dogfood `compose-launch` reads the manifest at startup-packet time. |
| Persona library — scrub log | `cocoder/personas/PORT-NOTES.md` documents every divergence Sub-Playbook E introduced (the `ORCHESTRATION-REBUILD` → `v0.1-foundation` slug scrub, the verification-artifact-guard inlining per Q5=A, etc.). | B inherits this scrub vocabulary. Every new persona port adds a row; the regression-test fixture captures the byte-exact composed prompt. |
| Workspace template | `templates/install-local/` exists (install-zone example configs + secrets `.gitignore` shipped via M4.10) but **`templates/workspace-cocoder/` does NOT exist**. | B-M2 authors the workspace template from scratch (or extracts from the dogfood `<CoCoder>/cocoder/` instance — see PB-Q1). |
| `cocoder init` | `--merge` PLANNER exists (`packages/core/lib/init-merge.mjs` from Sub-Playbook A S1.6) and is regression-tested. **Apply step does NOT exist**; there is no `cocoder init` CLI subcommand today. | B-M3.1 implements `cocoder init` (planner + apply). Must call `assertWorkspaceNotNestedInsideInstall` (already in `paths.mjs` per M4.24 + ADR-0006). |
| `cocoder audit-workspace` | Not implemented. | B-M3.2 stub: AGENTS.md chain walk + `memory/onboarding-questions.md` generation. Full stack detection deferred to v0.2 per Decision Log. |
| `cocoder refresh-memory` | Not implemented. | B-M3.3 stub: re-runs audit-workspace; updates `memory/codebase-map.md`. LLM-assisted refinement deferred to v0.2. |
| Dogfood reference instance | `<CoCoder>/cocoder/` is a populated, currently-active workspace meta-project. ARCHITECTURE.md "Dogfood collapse" section documents that ADRs live there too. | The dogfood instance IS the proof-of-life that the template is workable. Generating the template from the live instance is one design option (see PB-Q1). |
| `docs/custom-personas.md` | Not authored. | B-M3.4 ships it. |
| `docs/getting-started.md` | Not authored. Owned by Sub-Playbook D per the program plan, but the `cocoder init` flow B builds IS the first step of getting-started; we may want a B-side stub that D fleshes out. | Discuss in PB-Q4. |

### Objective

Ship a persona system (Oscar, Ian, Bob, Talia, Quinn, Oz contract, Phil example) and workspace template such that an external adopter can run `cocoder init` on an empty repo and get a working `cocoder/` folder ready for first launch (launch itself proven in Sub-Playbook E for the dogfood case; cross-workspace launch proven in Sub-Playbook C).

### Scope

**In:** Persona contracts in `cocoder/personas/`; prompt fragments in `cocoder/personas/prompts/`; public playbook summaries in `personas/playbooks/`; `examples/personas/phil-primitive-builder/`; `templates/workspace-cocoder/`; `cocoder init` (planner + apply); `cocoder audit-workspace` (stub per Decision Log); `cocoder refresh-memory` (stub); `docs/custom-personas.md`; persona-identity regression test; `cocoder init` idempotency regression test.

**Out (v0.1):** Full audit-workspace stack detection (deferred to v0.2); full refresh-memory automation (v0.2); Oz integration (Sub-Playbook C); end-user docs site (Sub-Playbook D); any persona we defer per PB-Q2.

### Current State (verified 2026-05-23)

| Surface | Status |
|---|---|
| Bob persona (contract + prompt + manifest entry) | ✅ Shipped via Sub-Playbook E (scrubbed) |
| Talia persona | ✅ Shipped via Sub-Playbook E (scrubbed) |
| Oscar persona | ❌ Not borrowed (B-M1 candidate) |
| Ian persona | ❌ Not borrowed (B-M1; PB-Q2 ships-vs-defers) |
| Quinn persona | ❌ Not borrowed (B-M1; PB-Q2 ships-vs-defers) |
| Phil persona | ❌ Not borrowed (B-M1; PB-Q3 schema-only vs full) |
| Verifier persona | ❌ Not borrowed (B-M1; PB-Q2 ships-vs-defers) |
| Shared fragments (6/7) | ✅ Shipped via Sub-Playbook E |
| `session-wrap.md` shared fragment | ❌ Deferred per PORT-NOTES (borrow when needed) |
| Workspace template | ❌ `templates/workspace-cocoder/` does not exist |
| `cocoder init` apply | ❌ Only planner exists |
| `cocoder audit-workspace` | ❌ Not implemented |
| `cocoder refresh-memory` | ❌ Not implemented |
| `docs/custom-personas.md` | ❌ Not authored |
| Persona-identity regression test | ❌ Not authored (replaces M4.E2.2e.replace tracking row from Sub-Playbook A) |
| `cocoder init` idempotency regression test | ❌ Not authored (B-S5/B-S6 candidate) |

### Deliverable

A public CoCoder release at which a stranger can:
1. `git clone` the CoCoder repo.
2. `cd` into their own application repo.
3. Run `cocoder init` (CoCoder install root resolved via the M4.24 ancestor walk or `--cocoder-home` flag).
4. See a populated `<their-app>/cocoder/` directory matching ARCHITECTURE.md's `<your-app>/cocoder/` layout (with `cocoder/local/` correctly gitignored).
5. Have at least Bob, Talia, and Oscar available as personas (the minimum to run a meaningful priority).
6. Use the Phil example to author their own custom persona.

**Checkpoint:** [x] Witness audit complete and recorded (2026-05-23 — this section). Objective measurable. Scope boundaries explicit (PB-Q1..PB-Q4 surface the residual uncertainty).

---

## Interrogate

### Pending decisions (B-specific; founder gates Expand)

> Same pattern Sub-Playbook A used for Q1–Q7. These do NOT block Witness/Interrogate (this work). They do block specific Expand milestones. **Pass back to founder before Expand starts; record answers under each Decision below.**

| ID | Question | Blocks | Recommended default |
|---|---|---|---|
| **PB-Q1** | Workspace template: author `templates/workspace-cocoder/` as a static fileset, or generate it from the live dogfood `<CoCoder>/cocoder/` via a regenerator script (analogous to M4.12's `regenerate.mjs`)? | B-M2 | **A — Static fileset.** | **Answered 2026-05-23: A** |
| **PB-Q2** | Persona library completeness for v0.1: ship ALL 7 personas (oscar/ian/bob/talia/quinn/phil/verifier), or a v0.1 minimum subset (e.g. oscar/bob/talia + Phil example only) with the rest deferred to v0.2? | B-M1 | **B — Minimum subset (oscar/bob/talia + Phil example).** ADR-worthy scope line. | **Answered 2026-05-23: B** (no HOLD FOR GO — defers quinn/ian/verifier to v0.2 per recommended default) |
| **PB-Q3** | Phil example shape: ship as schema-only stub (a sample `phil.json` + minimal `phil.md` documenting the contract), or as a full working example (real prompts + a runnable example route adopters can copy)? | B-M1.5 | **B — Full working example.** | **Answered 2026-05-23: B** |
| **PB-Q4** | `docs/getting-started.md`: author a B-side stub now (so `cocoder init` ships with at least minimal external-user docs) or defer entirely to Sub-Playbook D (and ship `cocoder init` with only `--help` text in v0.1)? | B-Final-Check | **A — B-side stub.** | **Answered 2026-05-23: A** |

> **Operating mode reminder:** if PB-Q2 graduates to ADR (probable — it's a real v0.1-vs-v0.2 scope line), HOLD FOR GO per the v0.1 completion plan's "Item 3 graduates a new ADR" rule. PB-Q1/PB-Q3/PB-Q4 are unlikely to ADR-graduate.

### Sub-Playbook-local risks

| Risk | Status | Mitigation | Notes |
|---|---|---|---|
| Persona identity drift during prompt port | Active | **B-S4** persona-identity regression test asserting composed prompts for known inputs are byte-identical to CoBuilder reference fixtures | Closes the orphan mitigation from V1. Tests scrubbed-but-otherwise-verbatim ports (the Sub-Playbook E scrubs are codified in PORT-NOTES.md). |
| Private CoBuilder playbook content leaking into public `personas/playbooks/` | Active | Manual diff review per persona; public summaries authored fresh, not copy-pasted from private playbooks; CI grep for known private strings (extends the M4.15 stale-reference gate) | New CI grep targets: `build-personas/`, `cobuilder-build/orchestration/personas/playbooks/`, any specific CoBuilder customer/project name founder identifies during the redaction pass |
| `cocoder init` clobbers user-edited workspace files | Mitigated | A's S1.6 `--merge` planner already validates this case; B-M3.1 implements the apply step with confirmation prompts. B-S5 regression test: run `cocoder init` twice on a tmp fixture → zero diff. | New: B-S6 regression test for the "user-edited tracked file" case — first `init`, edit one tracked file, second `init`, assert the edit is preserved and the planner surfaces the conflict in its report |
| Custom persona pattern (Phil) too coupled to CoBuilder domain | Active | Phil example is a small but real custom-persona route in a CoCoder-neutral domain (PB-Q3 = B). No CoBuilder-specific primitives in `personas/` (those stay in CoBuilder per ADR-0001). | Picking the example domain — e.g. a "doc-author primitive builder" — is a v0.1 authoring task |
| `audit-workspace` scope creep (full stack detection is multi-week) | Mitigated | v0.1 ships a stub: AGENTS.md chain walk + `memory/onboarding-questions.md` generation; full detection deferred to v0.2 per Decision Log | |
| Workspace template diverges from the dogfood `<CoCoder>/cocoder/` instance | Active | B-M2 ships a static template (PB-Q1 = A). B-Refine adds a "template ↔ dogfood drift" regression check (every file/dir present in `templates/workspace-cocoder/` must have a corresponding entry in `<CoCoder>/cocoder/`, modulo legitimate dogfood-only additions). | Drift detection is what closes the loop between "template" and "dogfood validates template" |
| `cocoder init` refusal logic (ADR-0006) regresses | Mitigated | Already implemented in `assertWorkspaceNotNestedInsideInstall` per M4.24; B-M3.1 calls it; existing regression tests in `tests/workspace-detection.test.mjs` cover the refusal + dogfood pass-through paths | B-M3.1 just wires the assertion; no new test needed beyond an integration smoke that `cocoder init` rejects a nested target |

### Reuse check

- [x] Sub-Playbook E (Dogfood Ramp) — borrowed Bob + Talia personas + 6 shared prompt fragments from CoBuilder; PORT-NOTES.md documents every divergence. **Sub-Playbook B extends this borrow; does not redo it.**
- [x] Sub-Playbook A (Foundation + config survival) — `--merge` planner (`packages/core/lib/init-merge.mjs`), `assertWorkspaceNotNestedInsideInstall` (`packages/core/lib/paths.mjs`), `setWorkspaceConfigValue` (`packages/core/lib/config.mjs`), `cocoder-product` deny-gate (`packages/core/lib/orchestrator-commit.mjs`), and the schema-drift CI gate are all reused without modification.
- [x] CoBuilder `orchestration/personas/` — read-only borrow target for the 5 remaining personas (PB-Q2 narrows which actually ship in v0.1). Borrow protocol matches Sub-Playbook E: scrub identifiers per PORT-NOTES vocabulary, narrow `allowedRoutes`, log each port in PORT-NOTES.

**Checkpoint:** [x] Cross-cutting decisions surfaced as PB-Q1..PB-Q4. Sub-Playbook-local risks have named mitigations. Reuse explicitly inherited from A + E, not re-implemented.

---

## Solve

*Sub-Playbook B has TWO riskiest invariants — both need proof before Expand can fan out safely.*

**Riskiest piece (B-side):**

1. **Persona identity preservation** — composed prompts for a known persona+route+priority input are byte-identical to a captured CoBuilder reference fixture (modulo the documented scrubs in PORT-NOTES). Drift here means the persona's constraint envelope silently weakens.
2. **`cocoder init` idempotency** — running `cocoder init` twice on the same target produces zero diff in the workspace tree; running it after a user edits a tracked file preserves the edit + reports the conflict.

### Tasks

- [x] **B-S1** Identify a known-good Sub-Playbook E orchestration run (run-id from `local/workspaces/cocoder-dogfood/runs/`) and capture its composed Bob prompt (`<runDir>/jobs/bob/prompt.md`) as the persona-identity reference fixture at `packages/core/tests/fixtures/persona-identity/bob-dogfood.expected-prompt.md`. Capture metadata at the same path with `.expected-context.json` (priority slug, route, profile, manifest version). — *2026-05-23; source run `run-20260522T233422Z-pqk1t3w0`; fixture runId `run-fixture-persona-identity-bob`.*
- [x] **B-S2** Author `packages/core/tests/persona-identity.test.mjs`:
  - Drives `launchRun` against the captured context.
  - Asserts the rendered prompt is byte-identical to the fixture.
  - Negative control: mutate the fixture slug by one character → test must fail.
- [x] **B-S3** Implement `cocoder init` apply (B-M3.1 — moved into Solve from Expand because it's part of the idempotency invariant). Reuse A's `--merge` planner; the apply step is the new code.
- [x] **B-S4** Author `packages/core/tests/init-idempotency.test.mjs`:
  - Run `cocoder init --workspace-root <tmp>`.
  - Assert the resulting tree matches a captured fixture (a snapshot of `templates/workspace-cocoder/` projected into the target).
  - Run `cocoder init --workspace-root <tmp>` again.
  - Assert the tree is byte-identical (zero diff).
  - Edit one tracked file in the workspace; run `cocoder init --workspace-root <tmp> --merge`; assert the edit is preserved and the planner report surfaces the conflict.
  - Refuse-nesting case: target is inside install → expect the `COCODER_NESTED_WORKSPACE_FORBIDDEN` error.
- [x] **B-S5** Manual smoke test: founder runs `cocoder init` on a fresh empty repo (out-of-tree); diffs the result against `templates/workspace-cocoder/` + the ARCHITECTURE.md `<your-app>/cocoder/` layout block. — *2026-05-23 AI smoke: zero diff vs template; 14 files materialized.*

**Pass threshold:** Both regression tests green AND the manual smoke test produces a workspace that matches the ARCHITECTURE layout AND PORT-NOTES.md gets a new entry for the captured fixture so Sub-Playbook B's Expand can extend with the same vocabulary.

**Checkpoint:** [x] Both invariants proven via passing tests; Sub-Playbook B is ready to fan into Expand (B-M1..B-M3 milestones can run in parallel after Solve).

---

## Expand (draft — milestones to be finalized at Solve close)

### Milestone B-M1 — Persona library expansion

Per PB-Q2 (recommended B — minimum subset), the v0.1 scope is **add Oscar; defer Quinn/Ian/verifier to v0.2; ship Phil per PB-Q3**.

- [x] B-M1.1 Borrow `oscar.json` + `prompts/personas/oscar.md` from CoBuilder. Scrub per PORT-NOTES vocabulary (priority-slug, `allowedRoutes`). Log in PORT-NOTES.
- [x] B-M1.2 Borrow `session-wrap.md` shared fragment if Oscar's manifest entry requires it (per Sub-Playbook E PORT-NOTES note on opportunistic borrow).
- [x] B-M1.3 Extend `cocoder/personas/prompts/manifest.json` with the Oscar entry.
- [x] B-M1.4 Phil example (per PB-Q3 = B): full working custom persona + minimal example route under `examples/personas/phil-primitive-builder/`. CoCoder-neutral domain.
- [x] B-M1.5 Public playbook summaries in `cocoder/personas/playbooks/` for Bob, Talia, Oscar, Phil. Authored fresh (NOT copy-pasted from CoBuilder private playbooks).
- [x] B-M1.6 Document operator pattern for private `<workspace>/cocoder/local/playbooks/`.
- [x] B-M1.7 CI grep for known private CoBuilder strings — extends M4.15 stale-reference gate with a new pattern list.

### Milestone B-M2 — Workspace template

Per PB-Q1 (recommended A — static fileset), `templates/workspace-cocoder/` is authored as static files, validated by a B-Refine drift check.

- [x] B-M2.1 Author `templates/workspace-cocoder/cocoder/` with: `AGENTS.md`, `PRIORITIES.md` (empty stub), `SESSION_LOG.md` (empty stub), `priorities/.gitkeep`, `tickets/INDEX.md` (empty stub), `decisions/README.md` (stub explaining workspace-zone ADRs), `memory/` (stubs for `codebase-map.md`, `tech-stack.md`, `onboarding-questions.md`), `personas/custom/.gitkeep`, `standards/AGENTS.md` (stub), `local/.gitignore` (the `*` + `!.gitignore` + `!README.md` pattern), `local/README.md` (explains the zone).
- [x] B-M2.2 Author `templates/workspace-cocoder/cocoder/.gitignore` per ARCHITECTURE.md ignore matrix (the workspace-zone version, NOT the install-zone one).
- [x] B-M2.3 Author `templates/playbooks/new-workspace-setup.md` — first-week-of-CoCoder operator onboarding playbook.
- [x] B-M2.4 Drift check (B-Refine): every file/dir in `templates/workspace-cocoder/` exists in `<CoCoder>/cocoder/` (modulo legitimate dogfood-only additions enumerated in a known-divergences allowlist).

### Milestone B-M3 — CLI surface (`init`, `audit-workspace`, `refresh-memory`)

- [x] B-M3.1 `cocoder init` (planner + apply) — **moved to Solve as B-S3** because it's part of the idempotency invariant.
- [x] B-M3.2 `cocoder audit-workspace` STUB — walks AGENTS.md chain from `<workspace>/cocoder/AGENTS.md`, emits `<workspace>/cocoder/memory/onboarding-questions.md`. Full stack detection deferred to v0.2 per Decision Log.
- [x] B-M3.3 `cocoder refresh-memory` STUB — re-runs `audit-workspace`, updates `<workspace>/cocoder/memory/codebase-map.md` from results only (LLM-assisted refinement deferred to v0.2).
- [x] B-M3.4 `docs/custom-personas.md` — schema, checklist dir convention, route eligibility, Oz registration hook (Oz integration lands in Sub-Playbook C).
- [x] B-M3.5 `docs/getting-started.md` STUB (per PB-Q4 = A) — install → `cocoder init` → first persona launch. Sub-Playbook D extends.

### Documentation Updates

- [ ] ARCHITECTURE.md persona table cross-referenced from `cocoder/personas/AGENTS.md`
- [ ] Master README "Key files" cross-reference Sub-Playbook B Witness back-reference to Sub-Playbook E PORT-NOTES
- [ ] PRIORITIES.md slim-table row + parser-readable entry refreshed when B status flips Active → Final Check → Complete

**Checkpoint:** [x] All B-M tasks complete; persona regression test green; workspace template instantiates cleanly via `cocoder init` on a fresh test repo; PB-Q2 / PB-Q3 deferrals (Quinn/Ian/verifier full routes) documented in `plans/v0.2-backlog.md` with rationale.

---

## Refine

- [ ] Founder runs `cocoder init` on a real empty repo (out-of-tree); reviews generated `cocoder/` against ARCHITECTURE.md four-zone model
- [ ] Founder runs persona regression test after random small prompt edit (negative control: test should FAIL on any unintended change)
- [ ] Phil example is followed end-to-end by founder; result is a working custom persona route
- [ ] B-M2.4 drift check passes — `templates/workspace-cocoder/` aligned with `<CoCoder>/cocoder/`
- [ ] CI grep for private CoBuilder strings returns 0 hits

**Checkpoint:** [ ] Sub-Playbook B locally validated. Stranger test (Master P-R2) handled in Sub-Playbook D Refine, not here.

---

## Final Check

- [ ] All Documentation Updates from Expand complete
- [ ] No private CoBuilder strings in public `personas/playbooks/` (CI grep gate landed via B-M1.7)
- [ ] Persona-identity regression test green in CI
- [ ] `cocoder init` idempotency regression test green in CI
- [ ] All checkboxes match reality
- [ ] Decision Log and Learnings current
- [ ] PB-Q1..PB-Q4 all "Answered" with chosen options recorded; any ADR-graduations landed in `cocoder/decisions/`
- [ ] Master Playbook Sub-Playbook B row flipped to **Complete**

---

## Decision Log

| Date | Decision | Rationale | Alternatives |
|---|---|---|---|
| 2026-05-21 | `audit-workspace` and `refresh-memory` ship as stubs in v0.1 | Full stack detection is multi-week and not on the v0.1 critical path | Full implementation (rejected — scope creep) |
| 2026-05-21 | Persona identity preservation is Sub-Playbook B's riskiest piece (not extraction mechanics) | A already proves extraction mechanics for non-prompt files; persona prompts have a distinct failure mode (drift) | Treat prompts as just-another-file (rejected — V1 had this as an orphan mitigation) |
| 2026-05-23 | `cocoder init` idempotency added as a second Solve invariant | Sub-Playbook A proved the `--merge` PLANNER but not the apply step; running `init` twice without a regression net is exactly the class of bug that bites first-time adopters. The two invariants are complementary: persona-identity protects what we ship, idempotency protects how we install it. | Treat init as just-another-Expand-task (rejected — Solve is where the riskiest invariants live, and the apply step has no prior proof) |
| 2026-05-23 | Witness audit + Interrogate + Solve target authored together at Activation (this commit), Expand deferred to next session | The W/I/S triad is decision-dense; doing it as one piece lets the founder evaluate PB-Q1..PB-Q4 against a coherent picture rather than four detached questions. Expand is execution-dense and parallelizable; better in its own session(s) | Single-session Witness only (rejected — wastes round trips); land everything in one giant PR (rejected — Expand needs founder gate on PB-Q1..PB-Q4 first) |

---

## Learnings

*(Populated during execution.)*

---

## Resume Instructions

1. Confirm Sub-Playbook A is at Refine-complete or later in the Master Progress table; if not, switch to A. (As of 2026-05-23: Refine-complete; Final Check ceremony parallel-tracked.)
2. Read Master Playbook, ADR-0001/0002/0003/0005/0006, this Sub-Playbook, **and `cocoder/personas/PORT-NOTES.md`**, then skim CoBuilder `infrastructure/cobuilder-build/orchestration/personas/` for context.
3. **Founder decides PB-Q1..PB-Q4** (record answers in the table above). PB-Q2 is the one most likely to graduate an ADR (v0.1 vs v0.2 persona scope); HOLD FOR GO if it does.
4. Once PB-Q1..PB-Q4 are answered: execute Solve (B-S1..B-S5).
5. After Solve checkpoint: fan into B-M1..B-M3 in parallel (different writers can take different milestones — no cross-milestone dependencies once Solve is green).
6. Update Progress + Master mirrors at each Canon transition.

---

## Progress

**Last worked:** 2026-05-23 (B Expand B-M1..B-M3 complete; suite **265/265**)
**Current Canon:** Active — Expand complete; Refine (founder-driven) next.
**Next action:** B Refine — founder ceremony only (`cocoder init` on empty repo, Phil example E2E, persona-identity negative control).

| Canon | Items | Done | Status |
|---|---|---|---|
| Witness | 1 | 1 | **Complete (2026-05-23)** |
| Interrogate | 6 risks + 4 pending decisions + reuse check | 6 + 4-answered + 1 | **Complete (2026-05-23)** |
| Solve | 5 (B-S1..B-S5) | 5 | **Complete (2026-05-23)** |
| Expand | M1: 7 · M2: 4 · M3: 5 | 16 | **Complete (2026-05-23)** |
| Refine | 5 | 0 | Not started (founder-driven) |
| Final Check | 8 | 0 | Not started |

---

## Success Criteria

- [ ] `cocoder init` produces a working `cocoder/` in any empty out-of-tree repo
- [ ] Persona-identity regression test green for at least Bob (Sub-Playbook E proven baseline) and the v0.1 persona scope (Oscar minimum per PB-Q2 = B)
- [ ] `cocoder init` idempotency regression test green
- [ ] Phil example demonstrates custom persona pattern end-to-end (per PB-Q3 = B)
- [ ] No private CoBuilder content in public artifacts (CI grep gate)
- [ ] `templates/workspace-cocoder/` matches the dogfood `<CoCoder>/cocoder/` structurally (B-M2.4 drift check)
- [ ] PB-Q1..PB-Q4 resolved + recorded; any ADR-graduations landed
- [ ] Master Playbook Sub-Playbook B row Complete
- [ ] Sub-Playbook E Final Check item 6 (Sub-Playbook B Witness back-reference) closes when this Sub-Playbook's Witness lands — *closed 2026-05-23 by this commit.*
