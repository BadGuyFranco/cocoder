# Sub-Playbook B — Personas and workspace template

**Created:** 2026-05-21 | **Updated:** 2026-05-21 (cleanup pass; pre-execution)
**Type:** One-time
**Collaboration:** Collaborative
**Status:** Draft (awaits Sub-Playbook A Complete)
**Method:** WISER Playbook (Sub-Playbook; Master = `../README.md`)
**Parent:** [v0.1-foundation priority](../README.md)

## Context

Sub-Playbook B owns the persona system (contracts, prompts, public playbook summaries, custom-persona pattern) and the workspace `cocoder/` template + `cocoder init`. This is where CoCoder becomes usable on real repos — A built the resolver, B makes the engine *do* something for a user.

The riskiest piece here is **persona identity drift during the port**: CoBuilder's "session 583 class" of bugs shows that when persona-identity argv and playbook excerpts are not composed verbatim, the runtime persona loses its constraint envelope. A regression test that asserts composed prompts are byte-exact for known inputs is the only proof.

**Key files for resume:**

- Master: `../README.md`
- Sub-Playbook A: `./2026-05-21-foundation.plan.md` (must be Complete)
- ADR-0002 — Talia/Quinn boundary
- CoBuilder personas: `infrastructure/cobuilder-build/build-personas/*.md` (private playbooks)
- CoBuilder runtime prompts: `infrastructure/cobuilder-build/orchestration/personas/prompts/`

---

## Preconditions

- [ ] Sub-Playbook A reaches Final Check
- [ ] `packages/core`, `packages/cocoder-cli`, `packages/schemas` operational
- [ ] Config resolver proven (A Solve)
- [ ] [Sub-Playbook E (Dogfood Ramp)](./2026-05-22-dogfood-ramp.plan.md) reaches Final Check — provides upstream reuse: Bob + Talia personas (borrowed from CoBuilder, scrubbed), minimal prompt fragments, one profile (`cocoder-dogfood`), one route (`dogfood-port-tests`), and PORT-NOTES documenting divergences. Sub-Playbook B extends, does not redo, this work.

---

## Authority

**Autonomous:** Persona contract drafts, prompt manifest, playbook summaries, workspace template authoring, `cocoder init` planner + apply, regression tests.

**Needs human input:** Any redaction call on porting CoBuilder private playbooks (decide what's public vs `local/playbooks/`). Any departure from ADR-0002 boundaries.

---

## Witness

*Detailed Witness audit performed at Activation. Draft placeholder: confirm CoBuilder persona surface still matches A's extracted runtime; identify any post-A changes that affect persona contracts.*

### Objective

Ship a persona system (Oscar, Ian, Bob, Talia, Quinn, Oz contract, Phil example), workspace template, and `cocoder init` such that running `cocoder init` on an empty repo produces a working `cocoder/` folder ready for first launch (launch itself proven in Sub-Playbook C).

### Scope

**In:** Persona contracts in `packages/core/contracts/personas/`, prompts in `personas/prompts/`, public playbook summaries in `personas/playbooks/`, `examples/personas/phil-primitive-builder/`, `templates/workspace-cocoder/`, `cocoder init` (planner + apply), `cocoder audit-workspace` (stub — see Decision Log), `cocoder refresh-memory` (stub), `docs/custom-personas.md`.

**Out:** Full audit-workspace stack detection (deferred to v0.2); full refresh-memory automation (v0.2); Oz integration (Sub-Playbook C); end-user docs (Sub-Playbook D).

---

## Interrogate

### Sub-Playbook-local risks

| Risk | Status | Mitigation | Notes |
|---|---|---|---|
| Persona identity drift during prompt port | Active | **E.B-RegTest** regression test asserting composed prompts for known inputs are byte-identical to CoBuilder reference fixtures | Closes the orphan mitigation from V1 |
| Private CoBuilder playbook content leaking into public `personas/playbooks/` | Active | Manual diff review per persona; public summaries authored fresh, not copy-pasted from private playbooks; CI grep for known private strings | |
| `cocoder init` clobbers user-edited workspace files | Mitigated | A's S1.6 `--merge` planner already validates this case; B implements the apply step with confirmation prompts | |
| Custom persona pattern (Phil) too coupled to CoBuilder domain | Active | Phil example is **schema-only** + minimal example route; no CoBuilder-specific primitives in `personas/` (those stay in CoBuilder) | |
| `audit-workspace` scope creep (full stack detection is multi-week) | Mitigated | v0.1 ships a stub: AGENTS.md chain walk + `memory/onboarding-questions.md` generation; full detection deferred to v0.2 | |

---

## Solve

**Riskiest piece:** Persona identity preservation.

### Tasks (draft — finalize at Activation)

- [ ] **B-S1** Identify a known-good CoBuilder persona launch (e.g. Oscar with priority X) and capture the composed prompt as a reference fixture
- [ ] **B-S2** Port the persona contract + prompt fragments into `packages/core/contracts/personas/oscar.json` and `personas/prompts/oscar/`
- [ ] **B-S3** Implement prompt composer in `packages/core/lib/compose.mjs` (port from CoBuilder verbatim per ADR-0004)
- [ ] **B-S4** Write regression test: `pnpm -F core test persona-identity` asserts composed prompt for the reference fixture is byte-identical
- [ ] **B-S5** Repeat for Bob (second persona) to confirm the composer generalizes

**Pass threshold:** Regression test green for both Oscar and Bob; manual diff review confirms no private CoBuilder content leaked into public artifacts.

---

## Expand (draft — milestones to be finalized at Activation)

### Milestone 1 — Persona contracts and prompts

- [ ] B-M1.1 Author contracts for oscar, ian, bob, talia, quinn, oz
- [ ] B-M1.2 Port prompt fragments, stripping CoBuilder-only references
- [ ] B-M1.3 Public playbook summaries in `personas/playbooks/`
- [ ] B-M1.4 Document operator pattern for private `local/playbooks/`
- [ ] B-M1.5 Phil example under `examples/personas/phil-primitive-builder/`

### Milestone 2 — Workspace template

- [ ] B-M2.1 `templates/workspace-cocoder/` with AGENTS.md, PRIORITIES.md, TICKETS.md, SESSION_LOG.md, plans/, decisions/, memory/, personas/custom/, standards/, local/.gitkeep
- [ ] B-M2.2 Template-level `cocoder/.gitignore` per ARCHITECTURE.md ignore matrix
- [ ] B-M2.3 `templates/playbooks/new-workspace-setup.md` onboarding playbook for humans/Oscar

### Milestone 3 — `cocoder init` and stubs

- [ ] B-M3.1 `cocoder init` — scaffold into target repo, merge `.gitignore`, conflict report; uses A's `--merge` planner
- [ ] B-M3.2 `cocoder audit-workspace` STUB — walks AGENTS.md chain, emits `memory/onboarding-questions.md` (full stack detection deferred to v0.2 per Decision Log)
- [ ] B-M3.3 `cocoder refresh-memory` STUB — re-runs audit-workspace, updates `memory/codebase-map.md` from results only (LLM-assisted refinement deferred to v0.2)
- [ ] B-M3.4 `docs/custom-personas.md` — schema, checklist dir, route eligibility, Oz registration hook (Oz integration lands in C)

### Documentation Updates

- [ ] ARCHITECTURE.md persona table cross-referenced from `personas/` directory README

**Checkpoint:** [ ] All B-M tasks complete; persona regression test green; workspace template instantiates cleanly via `cocoder init` on a fresh test repo.

---

## Refine

- [ ] Founder runs `cocoder init` on a real empty repo; reviews generated `cocoder/` against ARCHITECTURE.md four-zone model
- [ ] Founder runs persona regression test after random small prompt edit (negative control: test should FAIL on any unintended change)
- [ ] Phil example is followed end-to-end by founder; result is a working custom persona route

**Checkpoint:** [ ] Sub-Playbook B locally validated.

---

## Final Check

- [ ] All Documentation Updates from Expand complete
- [ ] No private CoBuilder strings in public `personas/playbooks/` (CI grep)
- [ ] Persona regression test green in CI
- [ ] All checkboxes match reality
- [ ] Decision Log and Learnings current
- [ ] Master Playbook Sub-Playbook B row flipped to **Complete**

---

## Decision Log

| Date | Decision | Rationale | Alternatives |
|---|---|---|---|
| 2026-05-21 | `audit-workspace` and `refresh-memory` ship as stubs in v0.1 | Full stack detection is multi-week and not on the v0.1 critical path | Full implementation (rejected — scope creep) |
| 2026-05-21 | Persona identity preservation is Sub-Playbook B's riskiest piece (not extraction mechanics) | A already proves extraction mechanics for non-prompt files; persona prompts have a distinct failure mode (drift) | Treat prompts as just-another-file (rejected — V1 had this as an orphan mitigation) |

---

## Learnings

*(Populated during execution.)*

---

## Resume Instructions

1. Confirm Sub-Playbook A is Complete in the Master Progress table; if not, switch to A.
2. Read Master Playbook, ADR-0002, this Sub-Playbook, and CoBuilder `build-personas/*.md` for context.
3. Witness: run a full audit at Activation (the draft Witness above is intentionally light).
4. Follow Progress next-action below.

---

## Progress

**Last worked:** 2026-05-21 (drafted only)
**Current Canon:** Draft
**Next action:** Activate after Sub-Playbook A Final Check — start with Witness audit and B-S1 reference fixture capture.

| Canon | Items | Done | Status |
|---|---|---|---|
| Witness | 1 | 0 | Draft |
| Interrogate | 5 | 0 | Draft |
| Solve | 5 | 0 | Not started |
| Expand | M1: 5 · M2: 3 · M3: 4 | 0 | Not started |
| Refine | 3 | 0 | Not started |
| Final Check | 6 | 0 | Not started |

---

## Success Criteria

- [ ] `cocoder init` produces a working `cocoder/` in any empty repo
- [ ] Persona regression test green for all six personas
- [ ] Phil example demonstrates custom persona pattern end-to-end
- [ ] No private CoBuilder content in public artifacts
- [ ] Master Playbook Sub-Playbook B row Complete
