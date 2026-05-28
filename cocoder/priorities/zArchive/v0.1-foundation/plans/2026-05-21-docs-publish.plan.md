# Sub-Playbook D — Documentation, dogfood, and public publish

**Created:** 2026-05-21 | **Updated:** 2026-05-24 (Activated — Witness/Interrogate/Solve-target populated; Status flipped Draft → Active)
**Type:** One-time
**Collaboration:** Collaborative
**Status:** **Active — Witness/Interrogate/Solve-target authored; Solve pending**
**Method:** WISER Playbook (Sub-Playbook; Master = `../README.md`)
**Parent:** [v0.1-foundation priority](../README.md)

## Context

Sub-Playbook D is the **v0.1 publish gate**. It produces the adopter documentation set, formalizes the dogfood evidence already accumulated in Sub-Playbooks E and C, proves public-readiness gates in CI, runs Refine = recruited stranger test (Master P-R2), and tags **`v0.1.0`** on the already-public repo (`BadGuyFranco/cocoder`).

The riskiest piece is **the stranger test**: a non-CoCoder developer must clone, init a workspace, and launch a priority in ≤30 minutes without contacting the founder. Failures here are the single highest-information signal — if the stranger test fails, no amount of polish makes v0.1 shippable.

**Key files for resume:**

- Master: `../README.md`
- Sub-Playbook A: `./2026-05-21-foundation.plan.md` (Refine-complete; Final Check ceremony parallel-tracked)
- Sub-Playbook B: `./2026-05-21-personas-template.plan.md` (Expand merged; Refine pending founder)
- Sub-Playbook C: `./2026-05-21-oz-mvp.plan.md` (Expand complete; Refine pending founder)
- Sub-Playbook E: `./2026-05-22-dogfood-ramp.plan.md` (Complete)
- `cocoder/plans/v0.2-backlog.md` — authoritative deferral list for **Out** scope
- ADR-0001 — license, distribution, CoBuilder relationship (publish gate enforces)
- `docs/` — six files exist today; inventory in Witness

---

## Preconditions

- [x] Sub-Playbook A Refine-complete (M4 Checkpoint reached 2026-05-23; Final Check ceremony parallel-tracked — does not block D activation).
- [x] Sub-Playbook B Expand merged (`9bf2433`) — persona library + workspace template + getting-started stub shipped; B Refine pending founder (parallel-tracked).
- [x] Sub-Playbook C Expand complete (PRs #42–#47 → `f46dcff`) — Oz MVP shipped; C Refine pending founder (parallel-tracked).
- [x] Sub-Playbook E Complete — dogfood orchestration proven on CoCoder itself.
- [x] Public git remote exists and is populated (`BadGuyFranco/cocoder`; Apache-2.0; community standards green).
- [ ] External developer recruited for Refine stranger test (Master P-R2) — **blocks Refine, not Solve or Expand.**

---

## Authority

**Autonomous:** Documentation authoring, dogfood evidence doc, CI gate extension (`gitleaks` + LICENSE/NOTICE/FAQ checks), internal-proxy stranger-test dry run (D-S1), recovery test procedure documentation.

**Needs human input (program gate):**

- Confirm `gitleaks` findings before tag (if any leak surfaces).
- Recruit and schedule external stranger test (Refine).
- Sign `docs/oz-security-checklist.md` (C Refine overlap acceptable).
- Tag `v0.1.0` + publish GitHub release notes (PD-Q6=A).

**Already satisfied (do not re-execute):**

- Public remote creation and initial push — done pre-D.

---

## Witness

### Audit findings (Sub-Playbook D activation, 2026-05-24)

| Area | Verified state (2026-05-24 @ `dbeb740`) | Implication for D |
|---|---|---|
| **Suite baseline** | Core **335/335**; oz-dashboard **8/8**; 0 fail; 0 skip. `pnpm exec cocoder validate-contracts` ok. | D Solve adds gate steps + readiness proof; expect modest test count rise only if gate wrappers get tests. |
| **`docs/` corpus** | **6 files** on disk: `getting-started.md` (stub), `custom-personas.md` (substantive, B), `configuration.md` (substantive, A), `oz-launch.md` + `oz-security-checklist.md` (C Expand), `oz-improvement-routing.md` (ADR-0005). | D Expand **extends** existing files; authors 5 net-new adopter docs + 1 evidence doc (see Scope). Do not duplicate C Oz docs — cross-link. |
| **`README.md` (repo root)** | Still says "not yet usable by adopters" and references Sub-Playbook A as active foundation work. | **D-M1.8** must flip before `v0.1.0` tag (PD-Q2=A). |
| **Community / legal files** | `LICENSE` (Apache-2.0), `NOTICE` (hand-authored, minimal CoBuilder extraction attribution), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` all present. | D-S2 adds content review steps; NOTICE stays hand-authored per PD-Q3=A. |
| **Public-readiness gates in CI** | `.github/workflows/ci.yml` stale-reference gate covers `/Volumes/`, `cobuilder\|COB_ORCH_`, private playbook path literals; schema-drift gate; `test -f LICENSE` + `test -f NOTICE` only. **No `gitleaks`. No FAQ check.** | D-S2 extends **ci.yml in place** — do not create parallel `scripts/gates/` wrappers that diverge from CI truth. |
| **Dogfood claim (M8)** | Sub-Playbook E Complete — 7+ orchestrated CoCoder-on-CoCoder runs; audit §4 ports closed; Oz observes runs (C Expand). `<CoCoder>/cocoder/` is live meta-project. | D-M2 compresses to **`docs/dogfood-evidence.md`** summarizing E + Oz — no mandatory new Oscar polish session (PD-Q7=A). |
| **Stranger test infrastructure** | No recruited external dev scheduled. `getting-started.md` is outline-only — not yet a ≤30 min path. | D-S1 internal proxy proves readiness before scheduling P-R2 recruit. |
| **Recovery test (P-R3)** | Oz registry + token resolution proven in C-S8; procedure not documented as a Refine runbook. | D Refine executes; document steps in Expand if needed for Final Check. |
| **Publish remote / push** | Repo already public at `BadGuyFranco/cocoder`. | M4 reduces to **tag + release notes** only. |
| **ADR-0001 §6 platform note** | Line 26 still mentions ".command wrappers" — retired per ticket 0001 Path B. | **D-M1.9** — founder gate: inline footnote vs new ADR amendment (see Expand). |
| **Immutable baseline drift** | `check-immutable-baseline` reports B Expand persona artifacts as tracked vs baseline-untracked. Expected; **out of D scope.** | Do not regen baseline in D sessions unless founder directs separate hygiene PR. |
| **Telemetry** | Zero in v0.1; v0.2-backlog requires ADR before any analytics code. | PD-Q5=A confirmation only — state in FAQ + ARCHITECTURE during Expand. |

### Objective

Ship **`v0.1.0`**: documentation sufficient for a recruited stranger to adopt CoCoder; dogfood claim formalized; all Master Final Check public-readiness gates green in CI; external stranger test passes in Refine; tag published on the existing public remote.

### Scope

**In:** Extend `docs/getting-started.md` to full ≤30 min stranger-test path (two-`local/` diagram); author `docs/orchestration.md`, `docs/personas.md`, `docs/oz.md` (overview cross-linking C's `oz-launch.md` + `oz-security-checklist.md`), `docs/faq.md`, `docs/freshness-policy.md`, `docs/dogfood-evidence.md`; extend `README.md` (PD-Q2=A); reconcile ADR-0001 §6 stale `.command` note (D-M1.9); extend `.github/workflows/ci.yml` with `gitleaks` + LICENSE/NOTICE/FAQ gates (D-S2); internal-proxy stranger readiness proof (D-S1); Mermaid diagram verification in ARCHITECTURE.md; tag `v0.1.0` + semver release notes (PD-Q6=A).

**Out (v0.1 — deferrals in `cocoder/plans/v0.2-backlog.md`):** Public `docs/roadmap.md`; brand/marketing site; extended contribution playbook beyond `CONTRIBUTING.md`; telemetry / opt-in analytics (PD-Q5=A); Linux/Windows docs beyond best-effort; Oz freshness panel; hosted-mode docs; full audit-workspace stack detection; Quinn/Ian/Verifier runnable personas; Browser E2E; auto-generated NOTICE from dependency scan (PD-Q3=A defers); extended legal FAQ beyond minimal commercial-use stance (PD-Q4=A).

### Current State (verified 2026-05-24)

| Surface | Status |
|---|---|
| `docs/getting-started.md` | ⚠️ Stub — install/init/outline; D extends |
| `docs/custom-personas.md` | ✅ Substantive (B Expand) |
| `docs/configuration.md` | ✅ Substantive (A + E) |
| `docs/oz-launch.md` | ✅ Substantive (C Expand) |
| `docs/oz-security-checklist.md` | ✅ Substantive (C Expand); founder sign-off in Refine |
| `docs/oz-improvement-routing.md` | ✅ Substantive (ADR-0005) |
| `docs/orchestration.md` | ❌ Not authored |
| `docs/personas.md` | ❌ Not authored |
| `docs/oz.md` | ❌ Not authored (overview; cross-links C docs) |
| `docs/faq.md` | ❌ Not authored |
| `docs/freshness-policy.md` | ❌ Not authored |
| `docs/dogfood-evidence.md` | ❌ Not authored |
| `README.md` adopter-ready pitch | ❌ Stale pre-release banner |
| `gitleaks` in CI | ❌ Not wired |
| Internal-proxy stranger readiness | ❌ Not proven |
| External stranger test (P-R2) | ❌ Not scheduled |
| `v0.1.0` tag | ❌ Not cut |

### Deliverable

A public CoCoder release at which:

1. A recruited external developer completes Master P-R2 (clone → init → first launch in ≤30 min, no founder contact).
2. All five Master Final Check public-readiness gates are green on the tag commit.
3. Eleven adopter-facing docs in `docs/` are present, cross-linked, and reviewed.
4. `v0.1.0` is tagged with release notes linking known deferrals to `v0.2-backlog.md`.

**Checkpoint:** [x] Witness audit complete and recorded (2026-05-24 — this section). Objective measurable. Scope boundaries explicit (PD-Q1..PD-Q7 answered below).

---

## Interrogate

### Pending decisions (D-specific; founder gates Expand)

> Same pattern as Sub-Playbook B (PB-Q1..PB-Q4) and C (PC-Q1..PC-Q9). These do NOT block Witness/Interrogate (this work). They block **Expand** milestones that depend on chosen semantics. **D Solve may proceed with recommended defaults; HOLD FOR GO before Expand if founder picks a non-default option on an ADR-graduating gate.**

| ID | Question | Blocks | Recommended default | Answer (2026-05-24) | ADR / HOLD FOR GO |
|---|---|---|---|---|---|
| **PD-Q1** | Stranger test (P-R2) execution model: **(A)** recruited external dev only; **(B)** internal proxy dry-run in **Solve** proves doc readiness; external recruit mandatory in **Refine/Final Check**; **(C)** founder-as-stranger after time gap counts as P-R2. | D-S1, D Refine M3 | **B — Internal proxy in Solve; external recruit in Refine.** | ~~B (2026-05-24)~~ **REVISED 2026-05-27 (run zx0s33ag): external recruit is NOT a v0.1 requirement (founder: "no external stranger test — never should have been a requirement"). Internal-proxy dry-run (D-S1) retained as the readiness check; Milestone 3 external recruit (D-M3.1–D-M3.3) removed from v0.1 scope.** | No |
| **PD-Q2** | `README.md` depth at `v0.1.0`: **(A)** full pitch + quick-start (remove "not yet usable" banner); **(B)** minimal pointer to `docs/getting-started.md` only. | D-M1.8, tag | **A — Full pitch + quick-start.** | **A (founder-approved 2026-05-24)** | No |
| **PD-Q3** | `NOTICE` maintenance: **(A)** hand-authored (current); **(B)** auto-generated from dependency license scan each release. | D-M4.3 | **A — Hand-authored for v0.1.** | **A (founder-approved 2026-05-24)** | No |
| **PD-Q4** | `faq.md` commercial-use scope: **(A)** minimal — Apache-2.0 commercial use, tool vs name/trademark note, commit guidance; **(B)** extended legal FAQ (CoBuilder relationship, redistribution essay). | D-M1.5 | **A — Minimal FAQ.** | **A (founder-approved 2026-05-24)** | **ADR-graduating if B** |
| **PD-Q5** | Telemetry in v0.1: **(A)** zero telemetry; state explicitly in FAQ + ARCHITECTURE; **(B)** opt-in analytics. | D-M1.5, ARCHITECTURE stamp | **A — Zero telemetry (confirmation).** | **A (founder-approved 2026-05-24)** | **ADR-required if B** |
| **PD-Q6** | Version tag + release notes: **(A)** Semver `v0.1.0`; GitHub release bullets + link to `v0.2-backlog.md`; **(B)** CalVer or other. | D-M4.1 | **A — Semver `v0.1.0`.** | **A (founder-approved 2026-05-24)** | No if A |
| **PD-Q7** | Dogfood M8 formality: **(A)** `docs/dogfood-evidence.md` summarizing E + Oz; no mandatory new Oscar session; **(B)** require fresh D Oscar polish session before publish. | D-M2 | **A — Evidence doc only.** | **A (founder-approved 2026-05-24)** | No |

> **Operating mode reminder:** if PD-Q4=B or PD-Q5=B, **HOLD FOR GO** before D Expand.

### Sub-Playbook-local risks

| Risk | Status | Mitigation | Notes |
|---|---|---|---|
| Stranger test fails (docs incomplete) | Active | **D-S1** internal proxy completes getting-started path in ≤30 min without doc-clarifying questions before recruiting external dev (PD-Q1=B) | Refine runs real P-R2 recruit |
| Secrets leak into git history before tag | Active | **D-S2** `gitleaks detect --no-banner` on full history in CI; remediation via `git filter-repo` if any found | History scan, not just working tree |
| Absolute `/Volumes/...` paths in shipped surfaces | Mitigated | Already in CI stale-reference gate (M4.15 lineage) | D-S2 verifies gate stays green; no duplicate script |
| `cobuilder-build` / private playbook strings in public artifacts | Mitigated | Already in CI (B-M1.7 patterns) | D-S2 extends with gitleaks + FAQ, not re-implements rg gates |
| Recovery test (P-R3) fails at Refine | Active | Document procedure during Expand; execute in D Refine before tag | Oz registry proven in C-S8 |
| Trademark / name confusion post-publish | Mitigated | FAQ minimal stance (PD-Q4=A); Master Authority deferred deep trademark work | |
| Founder fatigue → ship with known doc gaps | Active | Final Check requires green **external** stranger test, not founder self-assessment | PD-Q1=B enforces phase split |
| README / ADR stale mirrors confuse adopters | Active | **D-M1.8** README flip; **D-M1.9** ADR-0001 §6 reconciliation | Item 8 blocked on founder process pick |
| Parallel gate scripts diverge from CI | Mitigated | **No `scripts/gates/`** — extend `.github/workflows/ci.yml` only | Plan-vs-reality reconciliation |

### Reuse check

- [x] Sub-Playbook B — `docs/custom-personas.md`, `docs/getting-started.md` stub, `templates/workspace-cocoder/`, `cocoder init` (extend stub; do not rewrite from scratch)
- [x] Sub-Playbook C — `docs/oz-launch.md`, `docs/oz-security-checklist.md`; Oz MVP is live product surface for `docs/oz.md` overview
- [x] Sub-Playbook E — dogfood run evidence; D-M2 summarizes rather than re-orchestrates
- [x] Sub-Playbook A — `docs/configuration.md`; config resolver docs authoritative
- [x] CI stale-reference gate (M4.15 + B-M1.7) — extend, do not fork

**Checkpoint:** [x] Cross-cutting decisions surfaced as PD-Q1..PD-Q7 (all answered 2026-05-24). Sub-Playbook-local risks have named mitigations. Reuse explicitly inherited from A/B/C/E.

---

## Solve

*Sub-Playbook D Solve is now a **single** invariant — public-readiness gates green (D-S2). The stranger-test readiness invariant (D-S1) was removed from v0.1 scope by the founder on 2026-05-27 (run 1wna3uxq); founder real-project dogfooding validates readiness post-ship. Final Check is the binary ship gate.*

**Riskiest piece (D-side):**

1. ~~**Stranger-test readiness (D-S1)**~~ — **removed from v0.1 scope** (founder, 2026-05-27).
2. **Public-readiness gates green (D-S2)** — all Master Final Check §5 items enforced via CI on every push to `main`.

### Tasks

- [~] ~~**D-S1** **Stranger-test readiness (internal proxy).**~~ **❌ REMOVED FROM v0.1 SCOPE (founder, 2026-05-27, run 1wna3uxq):** "I have projects I will use CoCoder on myself — this is not a v0.1 concern." The founder's own real-project dogfooding is the readiness validation and it happens *after* ship, not as a pre-tag gate. Mirrors the 2026-05-27 removal of the external stranger recruit (D-M3). v0.1 doc-readiness is no longer gated by a proxy dry-run; the docs ship on their authored + `check-doc-refs`-clean state. Retained struck-through for history.

- [x] **D-S2** **Public-readiness gates green in CI.** **(Authored 2026-05-27, run 1wna3uxq — Bob, on branch `v0.1-publish`. All four sub-gates wired into `.github/workflows/ci.yml` in place. Local Class B equivalents pass; the "exit 0 on `main`" bar is Class A and only provable once CI runs at/after merge.)**
  - **Implementation shape:** extend `.github/workflows/ci.yml` (no parallel `scripts/gates/` directory):
    - [x] **D-S2a** `gitleaks detect --no-banner` on full history (install `gitleaks` on macOS runner same as `rg`). *(Local: `gitleaks detect --no-banner --source . --log-opts="--all"` → 104 commits scanned, no leaks. Class B.)*
    - [x] **D-S2b** Retain existing stale-reference gate block ( `/Volumes/`, `cobuilder`, private playbook paths ) — verify still green after doc Expand. *(Green; required removing one machine-specific `/Volumes/...` literal from `packages/schemas/test/workspaces-registry.test.ts` fixture → `/Users/example/CoCoder`, assertion unchanged.)*
    - [x] **D-S2c** LICENSE + NOTICE presence **and** minimal content checks (non-empty; NOTICE mentions CoBuilder extraction attribution). *(Local checks → `public-readiness-ok`. Class B.)*
    - [x] **D-S2d** `docs/faq.md` exists and contains commercial-use + telemetry-zero statements (PD-Q4=A, PD-Q5=A). *(Local grep passes. Class B.)*
  - **Test shape:** CI job fails if any gate fails; local reproduction documented in D plan Progress when landed.

**Pass threshold (revised 2026-05-27):** D-S2 all CI gate steps exit 0 on `main` (Class A — proven when CI runs after merge of `v0.1-publish`). ~~D-S1 internal proxy~~ removed from v0.1 scope.

**Checkpoint:** [ ] Public-readiness gates green on `main` (D-S2 Class A). ~~Stranger-test readiness~~ no longer a v0.1 gate.

---

## Expand

> Expand milestones fan out after Solve checkpoint. Doc authoring may proceed in batches; gate wiring (D-S2) can land in Solve before or alongside doc PRs.

### Milestone 1 — Documentation

- [x] **D-M1.1** Extend `docs/getting-started.md` to full ≤30 min stranger-test path: install → init out-of-tree workspace → first launch (CLI or Oz). Include labeled diagram: install-level `<CoCoder>/local/` vs workspace-level `<app>/cocoder/local/`. **(Authored 2026-05-27, run suesc2sq — clean-clone→init→compose-launch→CLI launch + Oz launch path, storage-zone diagram, cross-links to `oz-launch.md`/`oz-security-checklist.md`. The ≤30-min readiness *proof* is D-S1 internal-proxy, still deferred — authoring done, not yet stranger-validated.)**
- [x] **D-M1.2** `docs/orchestration.md` — tmux model, runs, evidence, session wrap (cross-link configuration + custom-personas). **(Authored 2026-05-27, run zx0s33ag — Bob; `check-doc-refs` 0 missing refs.)**
- [x] **D-M1.3** `docs/personas.md` — who does what, dispatch rules, custom persona ergonomics (cross-link `docs/custom-personas.md`). **(Authored 2026-05-27, run zx0s33ag — Bob; `check-doc-refs` 0 missing refs.)**
- [x] **D-M1.4** `docs/oz.md` — Oz overview, security model summary, troubleshooting; **cross-link** `docs/oz-launch.md` and `docs/oz-security-checklist.md` (do not duplicate C Expand content). **(Authored 2026-05-27, run zx0s33ag — Bob; summary-plus-pointers, no C-Expand duplication; `check-doc-refs` 0 missing refs.)**
- [x] **D-M1.5** `docs/faq.md` — minimal commercial use (PD-Q4=A), what to commit vs not, trademark/name note, zero telemetry (PD-Q5=A), Syncthing secrets warning. **(Authored 2026-05-27, run suesc2sq — minimal PD-Q4=A scope; all five required topics present; link-checked via `check-doc-refs` 0 missing refs.)**
- [x] **D-M1.6** `docs/freshness-policy.md` — ADR/ARCHITECTURE verification stamps + doc audit cadence; Oz freshness panel deferred v0.2. **(Authored 2026-05-27, run zx0s33ag — Bob; Oz freshness panel explicitly marked deferred-to-v0.2; `check-doc-refs` 0 missing refs.)**
- [x] **D-M1.7** Mermaid diagram(s) in `ARCHITECTURE.md` verified for clarity (update stamps if edited). **(Done 2026-05-27, run 1wna3uxq — Bob, on branch `v0.1-publish`; verification stamp refreshed + storage-zone Mermaid clarified. Static/manual clarity review — `mmdc` not installed locally, so render-verification is Class B.)**
- [x] **D-M1.8** **`README.md` adopter-ready rewrite (PD-Q2=A).** Remove "not yet usable by adopters" banner; replace stale Sub-Playbook A progress text with v0.1 pitch + quick-start pointer to `docs/getting-started.md`. **(Done 2026-05-27, run 1wna3uxq — Bob; "not yet usable" banner removed, "What v0.1 includes" + "Quick Start" → `docs/getting-started.md` added.)**
- [x] **D-M1.9** **ADR-0001 §6 stale `.command` reference — founder process gate.** ~~Line 26 still says "iTerm2 + `.command` wrappers"; retired per ticket 0001 Path B.~~ **Resolved 2026-05-27, run zx0s33ag (Oscar): founder chose option (i) — inline footnote.** ADR-0001 decision 6 now carries a dated `[^platform-v01-update]` footnote noting the `.command` retirement (ticket 0001 Path B) and terminal-only CLI + Oz launch surfaces; accepted decision text preserved, no new ADR graduated.

### Milestone 2 — Dogfood evidence (PD-Q7=A)

- [x] **D-M2.1** Author `docs/dogfood-evidence.md` summarizing Sub-Playbook E orchestrated runs + Oz observability (C Expand). No mandatory new Oscar polish session. **(Done 2026-05-27, run 1wna3uxq — Bob, on branch `v0.1-publish`; `check-doc-refs` 0 missing refs.)**

### Milestone 3 — Refine: stranger test (external recruit) — ❌ REMOVED FROM v0.1 SCOPE (2026-05-27, run zx0s33ag)

> **Founder decision 2026-05-27:** the external stranger-test recruit is not a v0.1 requirement and never should have been (PD-Q1 revised). v0.1 doc-readiness is proven by the **internal-proxy dry-run (D-S1)** only. The items below are retained struck-through for history; they do not gate v0.1.

- [~] ~~**D-M3.1** Recruit external developer (not familiar with CoCoder or CoBuilder; not the internal proxy from D-S1).~~ **Removed from v0.1 scope.**
- [~] ~~**D-M3.2** Time the run from `git clone` to first `cocoder launch` (target: ≤30 min; hard cap: 60 min before pause for diagnosis).~~ **Removed from v0.1 scope.**
- [~] ~~**D-M3.3** Capture every clarifying question as a doc task; iterate until run completes cleanly (binary green/red for Final Check).~~ **Removed from v0.1 scope.**

### Milestone 4 — Publish

- [ ] **D-M4.1** Tag **`v0.1.0`** (PD-Q6=A); draft GitHub release notes — scope summary + link to `cocoder/plans/v0.2-backlog.md` for deferrals.
- [ ] **D-M4.2** Run all CI public-readiness gates on the candidate tag commit; remediate any findings.
- [ ] **D-M4.3** Final review of LICENSE, NOTICE (hand-authored per PD-Q3=A), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.

### Documentation Updates

- [ ] All ADRs referenced from ARCHITECTURE.md remain current after D-M1.7 / D-M1.9
- [ ] Playbook Progress for Master + all sub-Playbooks current at tag time

**Checkpoint:** [ ] All Expand milestones complete; candidate commit ready for Refine stranger test + Final Check tag.

---

## Refine

*Sub-Playbook D Refine = external stranger test (D-M3, Master P-R2) + recovery test (Master P-R3). Internal proxy already ran in Solve (PD-Q1=B).*

- [ ] External stranger test green (D-M3.2, D-M3.3)
- [ ] Recovery test green (Master P-R3): delete `<CoCoder>/local/`, restore from Syncthing peer, confirm Oz re-attaches workspaces via token resolution
- [ ] Founder operates from public clone (not local working copy) for one work day; confirms no implicit local state required
- [ ] `docs/oz-security-checklist.md` founder sign-off (may overlap C Refine)

**Checkpoint:** [ ] CoCoder is operable by people other than the founder, from the public artifact only.

---

## Final Check

- [ ] All Documentation Updates from Expand complete
- [ ] All public-readiness CI gates green on tag commit (D-S2)
- [ ] External stranger test green (Master P-R2)
- [ ] Recovery test green (Master P-R3)
- [ ] All checkboxes match reality
- [ ] Decision Log and Learnings current
- [ ] **`v0.1.0` tagged and released** on `BadGuyFranco/cocoder`
- [ ] Master Playbook Sub-Playbook D row flipped to **Complete**
- [ ] Master Playbook Refine (P-R1..P-R4) unblocked for program-level ceremony

---

## Decision Log

| Date | Decision | Rationale | Alternatives |
|---|---|---|---|
| 2026-05-21 | Stranger test is Sub-Playbook D's Refine criterion (binary green/red) | "Founder thinks docs are fine" is unreliable; external execution is the only honest signal | Founder self-assessment |
| 2026-05-21 | History secret scan via `gitleaks` on full history (not just working tree) | Single missed secret in history requires force-push and remediation; cheaper to check before publish | Working-tree scan only |
| 2026-05-21 | Freshness policy doc ships in v0.1; Oz freshness panel deferred | Policy is cheap to author; UI surface is expensive and not on critical path | Both in v0.1 (scope creep) |
| 2026-05-24 | **PD-Q1..PD-Q7 derived at activation; all founder-approved** | Same pattern as B/C activation. PD-Q1=B splits internal proxy (Solve) from external recruit (Refine). PD-Q4=B and PD-Q5=B flagged ADR-graduating; founder chose A/A. | Founder-as-stranger (PD-Q1=C); extended legal FAQ (PD-Q4=B); opt-in telemetry (PD-Q5=B) |
| 2026-05-24 | **Plan-vs-reality reconciliations at activation** | Stub preconditions, M4 publish steps, and doc inventory were written before B/C Expand landed. Rewrote: preconditions allow parallel-tracked Refines; M4 = tag only; cross-link C Oz docs; extend getting-started; compress M2 to evidence doc; extend ci.yml not scripts/gates/; README + ADR-0001 as explicit Expand rows. | Silent absorption of stale stub text |
| 2026-05-24 | **Two-invariant Solve pattern (D-S1 readiness + D-S2 gates)** | Mirrors B (persona identity + init idempotency) and C (security + registry). Stranger readiness is the riskiest invariant; gates are the publish blocker. | Single combined Solve task; gates-only Solve |

---

## Learnings

*(Populated during execution.)*

---

## Resume Instructions

### Next Session Start Here

**All D authoring atoms are complete. The next step is a FOUNDER RELEASE sequence, not a fresh Oscar/Bob build run.**

**Recommended next atom:** D-RELEASE -- founder reviews branch `v0.1-publish`, merges it to `main` (PR), confirms CI is green (closes D-S2 Class A), then tags `v0.1.0`.

- **Branch state:** all v0.1 publish surfaces live on **`v0.1-publish`** (off `main`; commits `f83110a` Oscar governance + ADR-0001 §6 fix, `68feb24` Bob docs/README/ARCHITECTURE/ci.yml). The v0.4 control-plane work stays on `oz-control-plane-design`. This split was the founder's Option A (disentangle so `v0.1.0` contains only v0.1).
- **Release sequence (founder-gated):**
  1. Review `v0.1-publish` (diff vs `main`: 6 D docs + README rewrite + ARCHITECTURE verify + `docs/dogfood-evidence.md` + ci.yml gates + ADR-0001 §6 footnote + governance).
  2. Merge `v0.1-publish` → `main` (PR or fast-forward). **This triggers CI**, which runs the D-S2 gates and is the **Class A** proof that the gates exit 0 on `main`.
  3. If CI green → tag `v0.1.0` + semver release notes (PD-Q6=A). **Tag/publish is a human action (Master Authority).**
- **Stop conditions:** do NOT tag `v0.1.0` until D-S2 CI gates are green on `main`. Do NOT self-archive — archival is a founder confirmation.
- **Required checks already done (Class B):** `check-doc-refs` 0 missing on every edited doc; gitleaks full-history clean (104 commits); stale-ref gate green; LICENSE/NOTICE/FAQ public-readiness checks `ok`; core/schemas/oz-dashboard/oz-daemon tests pass except one socket-bind `EPERM` that is a sandbox limitation (re-run in a socket-capable env / CI for full-suite Class A).
- **Explicit founder decisions on record:** external stranger test REMOVED (PD-Q1, 2026-05-27); **D-S1 internal-proxy REMOVED** from v0.1 scope (2026-05-27, run 1wna3uxq — founder dogfoods own projects post-ship); README depth = full pitch + quick-start (PD-Q2=A); `v0.1.0` tag + release notes remain a founder release action.
- **Awareness (not a blocker):** `main` already carries forward-looking design that predates the branch — ADR-0008 (Oz architecture) + a v0.4 roadmap stub. These ship inside `v0.1.0` as roadmap/design, which is normal. The heavy v0.4 prototype tree (`docs/oz-control-plane-design/`), ADR-0010/0012, and designer-notes are correctly excluded.

### Remaining v0.1 work items
1. ~~D-M1.7 / D-M1.8 / D-M2.1 / D-S2 authoring~~ — **DONE (run 1wna3uxq, on `v0.1-publish`).**
2. **D-RELEASE (founder):** review `v0.1-publish` → merge to `main` → confirm CI green (D-S2 Class A) → tag `v0.1.0` + release notes.

### History
- D-M1.1–D-M1.6 + D-M1.9 complete (getting-started, faq in run suesc2sq; orchestration, personas, oz, freshness-policy + ADR-0001 footnote in run zx0s33ag).
- D-M1.7, D-M1.8, D-M2.1, D-S2 complete on branch `v0.1-publish` (run 1wna3uxq).
- Do not tag `v0.1.0` until D-S2 CI gates are green on `main`.

---

## Progress

**Last worked:** 2026-05-27 (run 1wna3uxq — D-M1.7/1.8/2.1 + D-S2 authored on branch `v0.1-publish`; D-S1 removed from v0.1 scope)
**Current Canon:** Active — Expand + Solve authoring COMPLETE on branch `v0.1-publish`. All D doc/gate atoms done; only the founder release sequence (merge → CI-green → `v0.1.0` tag) remains.
**Next action:** **D-RELEASE (founder):** review `v0.1-publish`, merge to `main` (triggers CI = D-S2 Class A proof), tag `v0.1.0` + release notes. See "Next Session Start Here" above.

| Canon | Items | Done | Status |
|---|---|---|---|
| Witness | 1 audit table + objective + scope + current state | 4 | **Complete (2026-05-24)** |
| Interrogate | 7 PD-Q + 9 risks + reuse check | 7 + 9 + 5 | **Complete (2026-05-24)** — PD-Q1 revised 2026-05-27 (external stranger test removed) |
| Solve | ~~2~~ → **1 (D-S2)** | D-S2 authored | **Authored (run 1wna3uxq)** — local Class B passes; Class A (CI green on `main`) pending merge. **D-S1 removed from v0.1 scope (founder 2026-05-27).** |
| Expand | M1: 9 (incl. D-M1.9) · M2: 1 · ~~M3: 3~~ removed · M4: 3 | M1: 9 of 9 · M2: 1 of 1 | **M1 + M2 COMPLETE** (D-M1.1–1.9, D-M2.1 — run 1wna3uxq closed D-M1.7/1.8/2.1). M3 external recruit removed. M4 = founder release. |
| Refine | 4 | 0 | Not started (Master-level; founder) |
| Final Check | 8 | 0 | Founder release sequence (merge → CI green → tag) |

---

## Success Criteria

- [ ] **Eleven adopter-facing docs** in `docs/` present and reviewed: `getting-started`, `custom-personas`, `configuration`, `orchestration`, `personas`, `oz`, `oz-launch`, `oz-security-checklist`, `oz-improvement-routing`, `faq`, `freshness-policy` (six exist today; five net-new or major extend in Expand)
- [ ] **`docs/dogfood-evidence.md`** summarizes E + Oz dogfood claim (PD-Q7=A)
- [ ] **`README.md`** adopter-ready (PD-Q2=A)
- [ ] External stranger test passes ≤30 min (Master P-R2)
- [ ] Recovery test passes (Master P-R3)
- [ ] All public-readiness CI gates green (D-S2)
- [ ] **`v0.1.0` tagged** on public remote
- [ ] Master Playbook Sub-Playbook D row Complete; Master Refine and Final Check unblocked
