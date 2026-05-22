# Sub-Playbook D — Documentation, dogfood, and public publish

**Created:** 2026-05-21 | **Updated:** 2026-05-21 (cleanup pass; pre-execution)
**Type:** One-time
**Collaboration:** Collaborative
**Status:** Draft (awaits Sub-Playbooks A, B, C Complete)
**Method:** WISER Playbook (Sub-Playbook; Master = `../README.md`)
**Parent:** [v0.1-foundation priority](../README.md)

## Context

Sub-Playbook D is the **public-readiness Sub-Playbook**. It produces the documentation set, dogfoods CoCoder on its own repo (proving the workspace template and Oz work on a real project), runs Refine = stranger test, executes public-readiness gates, and finally pushes to a public git remote.

The riskiest piece is **the stranger test**: a non-CoCoder developer must clone, init a workspace, and launch a priority in ≤30 minutes without contacting the founder. Failures here are the single highest-information signal — if the stranger test fails, no amount of polish makes v0.1 shippable.

**Key files for resume:**

- Master: `../README.md`
- Sub-Playbooks A, B, C (all Complete)
- ARCHITECTURE.md (final form)
- All ADRs (final form)

---

## Preconditions

- [ ] Sub-Playbooks A, B, C all Status: Complete in Master Progress
- [ ] At least one external developer recruited for the stranger test
- [ ] Public git remote provider chosen (recommend GitHub) — human decision

---

## Authority

**Autonomous:** Documentation authoring, dogfood execution, public-readiness gate implementation, secret-scan tooling configuration, recovery test execution.

**Needs human input (program gate):**

- Create public git remote
- Confirm secret-scan results before push
- Execute `git push` to public remote
- Tag `v0.1.0`

---

## Witness

*Detailed Witness at Activation.* Sub-Playbooks A, B, C will have changed the codebase enough that the docs surface must be authored against the **final** state, not the V1 plan's anticipated state.

### Objective

Produce documentation sufficient for a stranger to adopt CoCoder; dogfood CoCoder against its own repo to prove ergonomics; pass all public-readiness gates; publish the public repo and tag v0.1.0.

### Scope

**In:** `docs/getting-started.md`, `docs/orchestration.md`, `docs/personas.md`, `docs/oz.md`, `docs/configuration.md` (extended from A's spec), `docs/custom-personas.md` (extended from B), `docs/faq.md`, `docs/freshness-policy.md`, `docs/oz-security-checklist.md` (cross-link from C), Mermaid diagrams in ARCHITECTURE.md, dogfood of `cocoder init` on CoCoder repo itself, recursive priority + Oscar session, public-readiness gate scripts, secret-scan execution, public remote creation + push + tag.

**Out:** v0.2 docs (Linux/Windows guidance beyond best-effort, freshness panel in Oz, hosted-mode docs).

---

## Interrogate

### Sub-Playbook-local risks

| Risk | Status | Mitigation | Notes |
|---|---|---|---|
| Stranger test fails (docs incomplete) | Active | **D-S2** dry-run stranger test before recruiting external dev; iterate docs until founder + one internal proxy can do it from scratch | |
| Secrets leak into git history before publish | Active | **D-S1** `gitleaks detect --no-banner` on full history; remediation via `git filter-repo` if any found | History scan, not just working tree |
| Absolute `/Volumes/...` paths in shipped docs/templates/prompts | Active | **D-S1c** ripgrep gate in CI; fails build | |
| `cobuilder-build` runtime path references leak into shipped artifacts | Active | **D-S1d** ripgrep gate in CI; fails build | |
| Private CoBuilder playbook strings in public artifacts | Active | **D-S1e** known-private-string list scanned; fails build | Inherits B's mitigation |
| Recovery test (`local/` lost, restored from Syncthing peer) fails | Active | **D-S3** documented procedure + executed before publish | |
| Trademark issue with "CoCoder" name surfaces post-publish | Mitigated | Acknowledged in Master Authority as deferred; does not block v0.1 ship; FAQ notes commercial use of *the tool*, not redistribution of *the name* | |
| Founder fatigue → ship with known doc gaps | Active | Final Check requires green stranger test, not founder self-assessment | |

---

## Solve

**Riskiest piece:** Stranger-test readiness.

### Tasks

- [ ] **D-S1** Public-readiness gate scripts under `scripts/gates/`:
  - [ ] D-S1a `gitleaks-history.sh` — full history scan
  - [ ] D-S1b `no-absolute-paths.sh` — ripgrep for `/Volumes/`, `/Users/[^/]+/` in `docs/`, `templates/`, `personas/`, `packages/*/src/`
  - [ ] D-S1c `no-cobuilder-runtime.sh` — ripgrep for `cobuilder-build/` in `packages/` and runtime configs
  - [ ] D-S1d `no-private-playbook-strings.sh` — list of known private strings; fail if any match
  - [ ] D-S1e CI workflow runs all gates on every push to `main`
- [ ] **D-S2** Dry-run stranger test: a person other than the founder (internal proxy, not the recruited external dev) executes getting-started from a clean clone; founder watches without intervening; gaps captured as doc tasks
- [ ] **D-S3** Recovery test: delete `<CoCoder>/local/`, restore from a separate machine's Syncthing peer, confirm Oz re-attaches workspaces correctly via token resolution (depends on A's S1.4 implementation)

**Pass threshold:** All four gate scripts exit 0 on CI; dry-run stranger test completes without doc-clarifying questions; recovery test passes.

**Checkpoint:** [ ] Public-readiness proven. External stranger test can be scheduled.

---

## Expand (draft)

### Milestone 1 — Documentation

- [ ] D-M1.1 `docs/getting-started.md` — install, init workspace, first priority, first Oz launch (≤30 min target). **Must include a single labeled diagram showing the two `local/` directories — install-level `<CoCoder>/local/` (Oz state, secrets, workspace registry) vs workspace-level `<app>/cocoder/local/` (per-workspace overrides) — so adopters don't conflate them.**
- [ ] D-M1.2 `docs/orchestration.md` — tmux model, runs, evidence, session wrap
- [ ] D-M1.3 `docs/personas.md` — who does what, dispatch rules, custom persona ergonomics (cross-link `docs/custom-personas.md` from B)
- [ ] D-M1.4 `docs/oz.md` — Oz operations, security model summary, troubleshooting
- [ ] D-M1.5 `docs/faq.md` — license, commercial use, what to commit vs not, name trademark note
- [ ] D-M1.6 `docs/freshness-policy.md` — ADR/ARCHITECTURE verification stamps + doc audit cadence; Oz freshness panel deferred to v0.2
- [ ] D-M1.7 Mermaid diagram(s) in ARCHITECTURE.md verified for clarity

### Milestone 2 — Dogfood

- [ ] D-M2.1 Run `cocoder init` on CoCoder repo itself
- [ ] D-M2.2 Author priority in `cocoder/PRIORITIES.md`: "CoCoder v0.1 polish"
- [ ] D-M2.3 Oscar session executes one or more polish tickets using CoCoder on CoCoder
- [ ] D-M2.4 SESSION_LOG + planning Progress kept current as evidence

### Milestone 3 — Refine: stranger test

- [ ] D-M3.1 Recruit external developer (not familiar with CoCoder or CoBuilder)
- [ ] D-M3.2 Time the run from `git clone` to first `cocoder launch` (target: ≤30 min, hard cap: 60 min before pause for diagnosis)
- [ ] D-M3.3 Capture every clarifying question and confusion point as a doc task; iterate until run completes cleanly

### Milestone 4 — Publish

- [ ] D-M4.1 Create public git remote (founder; recommend GitHub `cocoder-dev/cocoder` or chosen org)
- [ ] D-M4.2 Run all gate scripts on the candidate commit; remediate any findings
- [ ] D-M4.3 Final review of LICENSE, NOTICE, CONTRIBUTING, CODE_OF_CONDUCT
- [ ] D-M4.4 `git push` to public remote (founder action)
- [ ] D-M4.5 Tag `v0.1.0`; draft release notes summarizing scope and known-deferred items

### Documentation Updates

- [ ] All ADRs referenced from ARCHITECTURE.md
- [ ] Playbook Progress for Master + all sub-Playbooks current at publish time

**Checkpoint:** [ ] All milestones complete; public repo live at `v0.1.0`.

---

## Refine

*Sub-Playbook D's Refine IS the stranger test (M3) plus the recovery test (D-S3). Program-level Refine in the Master adds the two-workspace concurrency test.*

- [ ] Stranger test green (D-M3.2, D-M3.3)
- [ ] Recovery test green (D-S3)
- [ ] Founder operates from public clone (not local working copy) for one work day; confirms no implicit local state required

**Checkpoint:** [ ] CoCoder is operable by people other than the founder, from the public artifact only.

---

## Final Check

- [ ] All Documentation Updates from Expand complete
- [ ] All four gate scripts green
- [ ] Stranger test green
- [ ] Recovery test green
- [ ] All checkboxes match reality
- [ ] Decision Log and Learnings current
- [ ] Public repo live at `v0.1.0`
- [ ] Master Playbook Sub-Playbook D row flipped to **Complete**
- [ ] Master Playbook Refine (P-R1..P-R4) unblocked

---

## Decision Log

| Date | Decision | Rationale | Alternatives |
|---|---|---|---|
| 2026-05-21 | Stranger test is Sub-Playbook D's Refine criterion (binary green/red) | "Founder thinks docs are fine" is unreliable; external execution is the only honest signal | Founder self-assessment |
| 2026-05-21 | History secret scan via `gitleaks` on full history (not just working tree) | Single missed secret in history requires force-push and remediation; cheaper to check before publish | Working-tree scan only |
| 2026-05-21 | Freshness policy doc ships in v0.1; Oz freshness panel deferred | Policy is cheap to author; UI surface is expensive and not on critical path | Both in v0.1 (scope creep) |

---

## Learnings

*(Populated during execution.)*

---

## Resume Instructions

1. Confirm Sub-Playbooks A, B, C all Complete in Master Progress; otherwise switch to the active one.
2. Read Master Playbook + all ADRs + ARCHITECTURE.md (final form).
3. Activate with full Witness audit; the codebase will have changed materially under A/B/C.
4. Gate scripts (Solve) must be green before Stranger test scheduling.

---

## Progress

**Last worked:** 2026-05-21 (drafted only)
**Current Canon:** Draft
**Next action:** Activate after Sub-Playbook C Final Check — start with D-S1 gate scripts.

| Canon | Items | Done | Status |
|---|---|---|---|
| Witness | 1 | 0 | Draft |
| Interrogate | 8 | 0 | Draft |
| Solve | 3 | 0 | Not started |
| Expand | M1: 7 · M2: 4 · M3: 3 · M4: 5 | 0 | Not started |
| Refine | 3 | 0 | Not started |
| Final Check | 9 | 0 | Not started |

---

## Success Criteria

- [ ] All seven docs files present and reviewed
- [ ] CoCoder dogfoods its own `cocoder/` directory
- [ ] Stranger test passes ≤30 min
- [ ] Recovery test passes
- [ ] All gate scripts green
- [ ] Public repo live; `v0.1.0` tagged
- [ ] Master Playbook Sub-Playbook D row Complete; Master Refine and Final Check unblocked
