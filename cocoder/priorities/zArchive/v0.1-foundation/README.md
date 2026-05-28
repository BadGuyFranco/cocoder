# Priority: v0.1-foundation — Program Master Playbook

> # ✅ ARCHIVED — COMPLETE (2026-05-27)
> **CoCoder `v0.1.0` shipped + tagged + released** (public `BadGuyFranco/cocoder`, CI green). All sub-Playbooks A–F landed: `cocoder` CLI, Oz MVP, persona orchestration, workspace template, adopter docs, Apache-2.0, recursive dogfood.
> **Closeout: [ADR-0011](../../../decisions/0011-v0.1-closeout.md).** The Master Refine validations — **P-R1** (two-workspace concurrency), **P-R3** (recovery/Syncthing restore), **P-R4** (dashboard-UX review), and the **Sub-Playbook B & C founder Refines** — were **waived** (recorded as *not run*), validated instead by ship + founder real-use. (P-R2 external stranger + D-S1 internal proxy were removed from scope earlier.)
> Successor active priority: **v0.5-orchestration-services**. Any defect in a waived area is handled as a v0.1.x patch priority, not by reopening this one.
> *The historical content below is preserved as-is from the active period; relative links may point one level shallower than this archived location.*

**Slug:** `v0.1-foundation` | **Created:** 2026-05-21 | **Updated:** 2026-05-27 (**Complete — archived**; ADR-0011)
**Type:** One-time | **Collaboration:** Collaborative
**Status:** **Complete — Archived 2026-05-27 (v0.1.0 shipped; Refine validations waived per ADR-0011)**
**Method:** WISER Playbook (Program-level)
**Owner:** Bob + founder

This README **is** the priority's master Playbook. Sub-Playbooks live in [`plans/`](./plans/) and execute under this Master's discipline.

> **Pickup state (2026-05-22):** A foundation audit was performed; findings preserved in [`plans/2026-05-22-foundation-audit.md`](./plans/2026-05-22-foundation-audit.md). Seven founder questions ([`pending-decisions.md`](./pending-decisions.md)) gate the remediation milestone (M4) in Sub-Playbook A. Free-of-decision M4 tasks (M4.1–M4.21) can proceed in parallel.

## Context

CoCoder v0.1 extracts CoBuilder's orchestration stack into a public, documented, solo/small-team OSS product that runs against arbitrary repos. The work decomposes into four sub-Playbooks. This Master owns **program-level** concerns only: cross-cutting decisions, sequencing, integration validation, and the publish gate. Each sub-Playbook owns its own WISER cycle, risks, and Refine.

**Why a Master Playbook (and not a `ROADMAP.md`):** v0.1 has real cross-cutting risks (binary-name lock-in, Oz security model, public-readiness gates, dogfood circularity) that don't belong inside any single sub-Playbook. Program-level Witness/Interrogate/Solve/Refine is the right home for them.

**Key files for a new context window:**

- [`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md) — four-zone storage model, ignore matrix, daemon security, Oz improvement routing
- [`../../decisions/README.md`](../../decisions/README.md) — ADR index
- [`../../decisions/`](../../decisions/) ADR-0001 through **ADR-0006** — accepted program decisions:
  - **ADR-0001** — Storage zones, license (Apache-2.0), CoBuilder relationship
  - **ADR-0002** — Talia and Quinn — test layer vs experience layer
  - **ADR-0003** — CLI binary name (`cocoder`) + env prefix (`COCODER_*`)
  - **ADR-0004** — TypeScript, validation toolchain (Zod-as-SSOT), monorepo policy
  - **ADR-0005** — Oz improvement-target routing taxonomy (`cocoder-product` / `workspace-shared` / `workspace-local` / `install-local` / `upstream-candidate`)
  - **ADR-0006** — No workspaces nested inside the install repository (dogfood exception via explicit `--workspace-root` + `--workspace-slug`)
- [`./pending-decisions.md`](./pending-decisions.md) — Q1–Q7 founder gates from the 2026-05-22 audit
- [`./plans/2026-05-22-foundation-audit.md`](./plans/2026-05-22-foundation-audit.md) — audit evidence for Milestone M4
- `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/ARCHITECTURE.md` — extraction source
- `/Volumes/NAS LOCAL/Shared/cofounder/tools/Playbook Author/AGENTS.md` — WISER methodology
- Sub-Playbooks A–D in [`./plans/`](./plans/)

---

## Preconditions

- [x] License: Apache-2.0 (ADR-0001)
- [x] Storage zones decided (ADR-0001)
- [x] Talia/Quinn boundary (ADR-0002)
- [x] Binary name `cocoder` + env prefix `COCODER_*` (ADR-0003)
- [x] TS/Zod/AJV/pnpm/Node policy (ADR-0004)
- [x] V1 of the foundation Playbook archived to [`./plans/zArchive/26-05-21 V1 - foundation.plan.md`](./plans/zArchive/)
- [x] Dogfood meta-project structure established (`cocoder/` collapsed install/workspace zones for our own repo)
- [ ] Sub-Playbook A drafted (in-flight as part of this restructure)
- [ ] Sub-Playbooks B, C, D stubbed with Resume Instructions
- [ ] CoCoder public git remote (decided immediately before D-publish; not before)

---

## Authority

**Autonomous (across all sub-Playbooks):** Research, ADR drafts, scaffolding, mechanical extraction with no behavior changes, tests, docs, example workspace template, Oz UI prototypes on localhost, dogfood on CoCoder's own repo.

**Needs human input (program-level):**

- Publishing public git remote (final commit + push)
- Telemetry policy (if any opt-in telemetry; default: none in v0.1)
- Commercial trademark of "CoCoder" name (deferred — does not block v0.1 ship)
- Any change to ADR-0001/0003/0004 mid-program (all four are gating decisions)

---

## Witness

### Audit findings (program-level)

| Area | Verified state | Implication |
|---|---|---|
| Sub-Playbook source documents | V1 (61 tasks, one document) violated WISER 3–5-task milestone ceiling and bundled four unrelated risks | Split into four sub-Playbooks; V1 archived |
| CoBuilder orchestration core | Mature `.mjs` runtime with JSON contracts; ready for mechanical port (ADR-0004) | Sub-Playbook A handles extraction; no rewrite during port |
| Decision records | ADRs 0001–0004 accepted; `decisions/README.md` index live | Sub-Playbooks reference ADRs by number, do not re-decide |
| CoCoder repo current state (refreshed 2026-05-22 evening) | `packages/core`, `packages/cocoder-cli`, `packages/schemas` exist with extracted `.mjs` runtime + TS schemas; `docs/configuration.md` + `docs/oz-improvement-routing.md` exist; ADRs 0001–0006 accepted; Sub-Playbook E (Dogfood ramp) ran end-to-end with 4 autonomous orchestrated test ports closed (E2.2e.1–E2.2e.4); 110/110 tests pass; 5 core bugs surfaced + fixed by dogfooding; repo published to `BadGuyFranco/cocoder` (public, Apache-2.0) with branch protection + community machinery; Sub-Playbooks B/C/D not started | Sub-Playbook A is mid-Refine (audit remediation); Sub-Playbook E is Final-Check-ready; B/C/D still gated on A close |
| Dogfood circularity | M8 (dogfood) requires `cocoder` binary to exist; tasks must order accordingly | Sub-Playbook D owns dogfood; depends on A, B, C |
| Dogfood structure | `cocoder/` meta-project established before code lands; priority README = master Playbook | Validates the workspace template by building it for ourselves first |

### Objective

Ship **CoCoder v0.1**: installable OSS framework with `cocoder` CLI, Oz dashboard, workspace template, ADR-backed configuration model, and docs that let a stranger clone, init, launch a priority, and recover from a `git pull` — all without reading CoBuilder source.

### Scope

**In:** Persona system (Oscar, Ian, Bob, Talia, Quinn, Oz; Phil as example), multi-model adapters, workspace `cocoder/` folder, install `local/` preferences with multi-machine portability, priorities/tickets/ADRs/memory templates, workspace onboarding, Oz local dashboard with security hardening, Apache-2.0, recursive dogfood on CoCoder itself, public-readiness gates before publish.

**Out (v0.1):** Hosted SaaS, team RBAC, cloud sync, persona marketplace, full codebase visualization in Oz, Windows parity beyond best-effort docs, CoBuilder IDE coupling, TypeScript migration of `packages/core`.

**Depends on:** macOS + iTerm2 + tmux; user-installed model CLIs (Claude, Codex, Grok, etc.); Node 20 LTS; pnpm.

### Current State

ADRs 0001–0006 accepted (added 0005 Oz improvement routing, 0006 no-nested-workspaces). ARCHITECTURE.md complete and consistent. V1 of the all-in-one Playbook archived. Dogfood meta-project (`cocoder/`) operational and proven by Sub-Playbook E running multi-lane orchestration on itself across 4 autonomous test ports. Repo published at `BadGuyFranco/cocoder` (public, branch-protected, community-standards 100%). 110/110 tests pass; 5 core bugs found + fixed during the dogfood ramp (regression coverage in `packages/core/tests/composition-dogfood-bugfixes.test.mjs`). Sub-Playbook A still mid-Refine (M4 free-wins M4.5–M4.14, M4.16–M4.21 remain; M4.22–M4.27 founder-gated tasks complete). Sub-Playbook E effectively complete (Final Check 5/6 with one deferral to Sub-Playbook B). Sub-Playbooks B, C, D pending stubs.

### Deliverable

A public git repository (`CoCoder`) with: working `cocoder` CLI, Oz dashboard, workspace template, ADRs, docs, license, and one reference dogfood (`cocoder/` inside the CoCoder repo itself).

**Checkpoint:** [x] Current state verified. Objective measurable. Scope boundaries explicit and recorded in ADR-0001.

---

## Interrogate

### Program-level decisions (ADR-backed)

| # | Decision | ADR |
|---|---|---|
| 1 | Apache-2.0 license | 0001 |
| 2 | `<CoCoder>/local/` gitignored; multi-machine via folder sync | 0001 |
| 3 | Visible `cocoder/` per workspace, `cocoder/local/` narrow-private | 0001 |
| 4 | Talia = test layer; Quinn = experience layer | 0002 |
| 5 | Phil = example custom persona only | 0001 |
| 6 | Oz = master persona, no separate brand | 0001 |
| 7 | macOS-first v0.1; git clone + pnpm distribution | 0001 |
| 8 | Per-workspace tmux socket | 0001 |
| 9 | CoBuilder migrates after CoCoder v0.1 | 0001 |
| 10 | Binary = `cocoder`; env prefix = `COCODER_*` | 0003 |
| 11 | Extracted `packages/core` stays `.mjs`; new packages TS | 0004 |
| 12 | Schemas authored in Zod, published as JSON Schema, consumed by AJV in core | 0004 |
| 13 | pnpm workspaces; Node 20 LTS | 0004 |
| 14 | Oz improvement-target routing (`cocoder-product` / `workspace-shared` / `workspace-local` / `install-local` / `upstream-candidate`) | 0005 |
| 15 | No workspaces nested inside the install repo; dogfood is the one legitimate "workspace inside install" instance, addressed via explicit `--workspace-root=<install>` + `--workspace-slug=cocoder-dogfood` | 0006 |

### Program-level risks

| Risk | Status | Mitigation | Notes |
|---|---|---|---|
| Cross-Playbook decision drift (e.g. binary name changes mid-program) | Mitigated | All gating decisions captured in ADRs before Sub-Playbook A starts | Reopen via new ADR only |
| Multi-machine path portability breaks Oz workspace registry | Active | Token-based path resolution (`${COCODER_HOME}`, `${root:name}`) — proven in Sub-Playbook A Solve | See ARCHITECTURE.md "Multi-machine path portability" |
| Oz daemon = local attack surface | Active | Security model in ARCHITECTURE.md "Oz daemon security model"; implemented in Sub-Playbook C Solve | Localhost bind, session token, CSRF, Origin check, audit log, no shell interpolation |
| Persona identity drift during port (CoBuilder "session 583" class) | Active | Regression test in Sub-Playbook B: composed prompts contain persona-identity argv + playbook excerpt verbatim | Mitigation now has an owner task |
| Dogfood circularity (Sub-Playbook D needs A+B+C done) | Mitigated | D activated 2026-05-24 with parallel-tracked Refines; Witness audits publish-readiness against final B/C Expand artifacts | |
| Public-readiness gate failures at the last minute (secrets in history, `/Volumes/...` paths in templates, CoBuilder runtime path refs in prompts) | Active | Automated gates in Sub-Playbook D Solve: `gitleaks`, path-scrubber, prompt-scrubber, dependency check — runs in CI on every push | |
| API key sprawl across Syncthing-replicated machines | Active | `local/secrets/` documented as encrypted-at-rest manual today; keychain integration deferred to v0.2; warning in `docs/faq.md` | |
| External adoption fails the "stranger test" | Active | Sub-Playbook D Refine = recruited non-CoCoder dev follows getting-started in ≤30 min without founder help | |
| Stale documentation drift after publish | Active | ADR + ARCHITECTURE verification stamps; `docs/freshness-policy.md` ships in v0.1 (Sub-Playbook D); Oz freshness panel deferred to v0.2 | |

### Reuse check

- [x] CoBuilder `orchestration/core/lib`, `adapters`, `contracts` — extracted, not rewritten (ADR-0004). 4 of 12 audit §4 test ports closed via Sub-Playbook E orchestration (E2.2e.1 `core.test.mjs`, E2.2e.2 `dispatch.test.mjs`, E2.2e.3 `adapters.test.mjs`, E2.2e.4 `composition.test.mjs`); 8 remaining (E2.2e.5–E2.2e.12).
- [x] CoBuilder `ORCH DEBUGGER.command` evidence patterns — reused by Oz Run Inspector (Sub-Playbook C Expand, C-M2.6 / PR #47 → `f46dcff`)
- [x] Cofounder WISER Playbook Author — execution discipline for every sub-Playbook
- [x] Sub-Playbook E (Dogfood ramp) borrowed Bob + Talia personas + 6 shared prompt fragments from CoBuilder; Sub-Playbook B will extend (not redo) per Sub-Playbook E Final Check item

**Checkpoint:** [x] Cross-cutting decisions locked in ADRs. Program-level risks have named mitigations. Sub-Playbook boundaries justified by risk topology, not arbitrary slicing.

---

## Solve

*The program's riskiest invariant: config survival across `git pull` + multi-machine path portability. Both prove out in Sub-Playbook A. If they fail, no further sub-Playbook is worth starting.*

**Riskiest piece (program-level):** Config resolver behaves identically on:

1. A single machine after `git pull`
2. Two machines syncing `<CoCoder>/local/` via Syncthing where paths differ across machines
3. A workspace where `cocoder/local/` contains an override that conflicts with a newly-introduced tracked template file

### Tasks

- [x] **P-S1** Sub-Playbook A reaches its own Solve checkpoint (config resolver + multi-machine portability + `cocoder init --merge` idempotency)
- [x] **P-S2** Master records the validation evidence (test run logs + manual checklist results) in `Learnings` table

**Pass threshold:** Sub-Playbook A Solve checkpoint `[x]`; this Master Solve `[x]` mirrors it with cross-reference.

**Checkpoint:** [x] Program invariant proven. Sub-Playbooks B–D remain sequenced behind Sub-Playbook A Final Check, but the Master Solve invariant is proven.

---

## Expand

*Expand at the Master level lists sub-Playbooks, not tasks. Each row is owned by a separate Playbook with its own WISER cycle.*

### Sub-Playbook A — Foundation and config survival

- [ ] **PA** Repo skeleton (M1), config resolver Solve, install prefs (M6), core extraction with manifest (M2)
- File: [`./plans/2026-05-21-foundation.plan.md`](./plans/2026-05-21-foundation.plan.md)

### Sub-Playbook B — Personas and workspace template

- [ ] **PB** Persona contracts + prompts + playbook summaries (M3), workspace template + `cocoder init`/`audit-workspace`/`refresh-memory` (M4)
- File: [`./plans/2026-05-21-personas-template.plan.md`](./plans/2026-05-21-personas-template.plan.md)
- Depends on: A complete

### Sub-Playbook C — Oz MVP

- [ ] **PC** Oz daemon with security hardening, dashboard with workspaces/priorities/runs/settings, Run Inspector (M5)
- File: [`./plans/2026-05-21-oz-mvp.plan.md`](./plans/2026-05-21-oz-mvp.plan.md)
- Depends on: A complete, B Solve checkpoint reached

### Sub-Playbook D — Docs, dogfood, publish

- [ ] **PD** Documentation (M7), dogfood on CoCoder itself (M8), Refine = stranger test, Final Check = public-readiness gates and publish (formerly Authority gate)
- File: [`./plans/2026-05-21-docs-publish.plan.md`](./plans/2026-05-21-docs-publish.plan.md)
- Depends on: A, B, C complete

### Sub-Playbook E — Dogfood ramp (first orchestrated CoCoder-on-CoCoder task)

- [ ] **PE** Pull a thin slice of Sub-Playbook B's persona work forward (Bob + Talia + minimal prompts/profile/route) to prove `cocoder compose-launch` works end-to-end on the CoCoder dogfood workspace itself. First orchestrated task = Talia ports the audit §4 port-first tests into `packages/core/tests/`.
- File: [`./plans/2026-05-22-dogfood-ramp.plan.md`](./plans/2026-05-22-dogfood-ramp.plan.md)
- Depends on: Sub-Playbook A Milestone M4 Checkpoint reached (M4 free-wins + Q1/Q2/Q4 Answered + M4.22/23/24 implemented)
- Forward-compat: borrowed persona artifacts are designed to be extended by Sub-Playbook B's full persona library; Sub-Playbook B's Witness must reference E as upstream reuse

### Sub-Playbook F — Structural cleanup (god-module debt + shared-helper extraction)

- [x] **PF** Surgical decomposition unblocking Sub-Playbook B Expand: shared-helper extraction (FB-1), `cli.mjs` command registry (FB-2), `contracts.mjs` `enum` honoring (FB-3). NOT a comprehensive god-module decomposition — `launch.mjs` / `ledger.mjs` / `launch.test.mjs` split + TS-wrapper identity + inline-prompt-prose extraction + AppleScript-attach strategy split + full Zod migration of orchestration contracts are explicitly deferred to a v0.2 architectural priority. — *Complete 2026-05-23 (PR #28).*
- File: [`./plans/2026-05-23-structural-cleanup.plan.md`](./plans/2026-05-23-structural-cleanup.plan.md)
- Depends on: Sub-Playbook A Refine-complete (✅), Sub-Playbook B Witness/Interrogate/Solve-target landed (✅)
- Unblocks: Sub-Playbook B Solve (B-S2 persona-identity regression test consumes the post-helper-extraction composer output bytes; sequencing F before B-S1 fixture capture avoids regen)

### Documentation Updates (program-level)

- [ ] `../../../ARCHITECTURE.md` amended for any decision changes during execution
- [ ] `../../decisions/README.md` index kept current as new ADRs land
- [ ] Each sub-Playbook references this README as its Parent

**Checkpoint:** [ ] All four sub-Playbooks Complete.

---

## Refine

*Program-level Refine = cross-Playbook integration validation, not sub-Playbook-internal validation.*

- [ ] **P-R1** Founder runs Oz on two real workspaces concurrently (one CoBuilder, one CoCoder dogfood) — different repos, no tmux session collision
- [ ] **P-R2** Stranger test: recruited non-CoCoder developer (not the founder) follows `docs/getting-started.md` from `git clone` to first `cocoder launch` in ≤30 minutes without founder contact
- [ ] **P-R3** Recovery test: delete `<CoCoder>/local/`, restore from Syncthing peer, confirm Oz re-attaches workspaces with correct paths via token resolution
- [ ] **P-R4** Iteration: dashboard UX reviewed against `design-brief.md` restraint principles (no mission-control clutter)

**Checkpoint:** [ ] All four Refine items pass.

---

## Final Check (program-level)

- [ ] Sub-Playbooks A, B, C, D all Status: Complete
- [ ] `../../../ARCHITECTURE.md` and `../../decisions/README.md` current
- [ ] No stale `cobuilder-build` runtime path references in shipped artifacts
- [ ] CI green on `main` (lint, type-check, tests)
- [ ] All checkboxes (Master + sub-Playbooks) reflect actual state
- [ ] Decision Log and Learnings current
- [ ] **Public-readiness gates (all green) — Sub-Playbook D Final Check passed:**
  - [ ] `gitleaks detect --no-banner` returns clean
  - [ ] No absolute `/Volumes/...` paths in `docs/`, `templates/`, or prompt fragments
  - [ ] No `cobuilder-build` runtime path imports in `packages/`
  - [ ] No CoBuilder-private playbook references in `personas/playbooks/`
  - [ ] LICENSE + NOTICE present; FAQ covers commercial use
- [ ] Public git remote created (human-confirmed; see Authority)
- [ ] `git push` to public remote executed (human-confirmed; see Authority)

---

## Decision Log

| Date | Decision | Rationale | Alternatives |
|---|---|---|---|
| 2026-05-21 | Restructure V1 Playbook into Master + 4 sub-Playbooks | V1 had 61 tasks bundling 4 unrelated risks; WISER discipline degrades past ~25 tasks; Refine cannot stress-test mixed concerns | Keep monolithic; trim scope to 1 milestone; defer everything to v0.2 |
| 2026-05-21 | Master Playbook owns cross-cutting decisions (ADR-0003, 0004) and program-level Refine | Cross-Playbook concerns must have a single owner or they fall through the cracks between sub-Playbooks | Lightweight `ROADMAP.md` (rejected — no Witness/Refine for program risks) |
| 2026-05-21 | Binary = `cocoder`, env prefix = `COCODER_*` (ADR-0003) | `coder` collides with Coder.com; locked before extraction so mechanical rename is one pass | `coder` with alias; `cc` short name |
| 2026-05-21 | Extract core as `.mjs` verbatim; new packages TS; Zod-with-JSON-Schema-export (ADR-0004) | Behavior preservation during port; single source of truth for schemas; AJV reads generated artifacts in `.mjs` core | Rewrite core in TS during port; AJV-only with hand-written schemas; Zod-only |
| 2026-05-21 | Priority README.md **is** the priority's master Playbook (not a thin overview that points elsewhere) | Single source of truth per priority; no indirection; README renders natively in IDEs/GitHub | Separate `[priority].plan.md` Master file (rejected — adds a hop without value) |
| 2026-05-21 | Dogfood meta-project (`cocoder/`) established before any code lands | Building the workspace template by living in it first; Sub-Playbook B's template extracts from our real instance | Build template speculatively; dogfood at the end |
| 2026-05-22 | Add Sub-Playbook E (Dogfood ramp) between A close and B start | The product feature that matters is orchestration; structural dogfood alone is insufficient proof for v0.1; pulling 3 of ~7 persona artifacts forward by one Sub-Playbook is a small scope cheat with high leverage (first deliverable is the regression net that protects every subsequent dogfood orchestration) | Wait for full B (rejected — months of latency before first dogfood proof); skip dogfood orchestration in v0.1 (rejected — undermines v0.1 thesis); roll into A as a milestone (rejected — distinct WISER cycle with its own Refine warrants its own Sub-Playbook) |

---

## Learnings

| Date | Learning | Impact |
|---|---|---|
| 2026-05-21 | V1 Playbook had several orphan mitigations (persona identity drift, doc rot) with no Expand tasks | Restructure pairs every risk mitigation to a named task in a sub-Playbook |
| 2026-05-21 | Multi-machine path portability was an implicit assumption in V1 with no proof | Now a named Solve invariant; Sub-Playbook A must prove before B–D start |
| 2026-05-21 | Oz security model was absent from V1 | Now codified in ARCHITECTURE.md; implemented in Sub-Playbook C Solve |
| 2026-05-21 | Thin "priority overview README" + separate master Playbook file added indirection without value | Priority README **is** the master Playbook; sub-plans live in `plans/` |
| 2026-05-22 | Config survival Solve passed locally under Node 25 despite the repo requiring Node 20 | Evidence: `pnpm install`, `pnpm -F core test config-resolver`, `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, `node packages/core/cli.mjs validate-contracts`, and `packages/cocoder-cli/bin/cocoder config get/set`; every pnpm run warned that local Node is v25.1.0 rather than the pinned Node 20 LTS |

---

## Pending Decisions

> Audit-driven founder gates from 2026-05-22. **Specific Sub-Playbook A Milestone M4 tasks are blocked until these are answered.** Free-of-decision M4 tasks (M4.1–M4.21) can proceed in parallel.

Tracked in [`pending-decisions.md`](./pending-decisions.md). **All resolved 2026-05-22.**

| ID | Question | Status | Decision | Blocks |
|---|---|---|---|---|
| Q1 | ADR-0005 enforcement scope — Sub-Playbook A or C? | Answered 2026-05-22 | **B** (minimal `--developer-mode` belt in A) | M4.22 |
| Q2 | `config set` zone defaults | Answered 2026-05-22 | **A** (install-local default; `--workspace-root` flag) | M4.23 |
| Q3 | Ephemeral runs gitignore policy | Answered 2026-05-22 | **A** (`local/workspaces/<slug>/runs/`) | M4.25 |
| Q4 | Workspaces inside install repo — allowed? | Answered 2026-05-22 → **ADR-0006** | **A** (documented constraint; `cocoder init` refuses) | M4.23, M4.24 |
| Q5 | Verification-artifact guard SSOT | Answered 2026-05-22 | **A** (inline string in core; runtime test) | M4.26 |
| Q6 | Stranger-test cwd assumption | Answered 2026-05-22 | **A** (user-app cwd; `--cocoder-home` for install ops) | M4.27 |
| Q7 | Sub-Playbook A close criteria scope | Answered 2026-05-22 | **B** (Standard — free wins + workspace detection + Q1-B belt) | M4 closure |

**Decisions effective immediately.** M4.22–M4.27 carry the chosen-option semantics inline in their task rows (see [`plans/2026-05-21-foundation.plan.md`](./plans/2026-05-21-foundation.plan.md) Milestone M4). [ADR-0006](../../decisions/0006-no-nested-workspaces-inside-install.md) makes the Q4 constraint durable and discoverable per the founder directive ("well documented requirement").

---

## Resume Instructions

1. Read this README end-to-end (Context, Decision Log, Pending Decisions, Progress, Refine, Final Check).
2. Read ADRs 0001–**0005** in [`../../decisions/`](../../decisions/).
3. Read [`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md) — including new Oz daemon security model and Oz improvement routing sections.
4. Check [`pending-decisions.md`](./pending-decisions.md). If Q1–Q7 are Open, founder must answer the ones gating active M4 tasks before those tasks start. Free-wins (M4.1–M4.21) can proceed without decisions.
5. Read the 2026-05-22 audit [`plans/2026-05-22-foundation-audit.md`](./plans/2026-05-22-foundation-audit.md) for context on M4.
6. Open the Progress table below. Find the sub-Playbook with **Status: Active**.
7. Open that sub-Playbook file in [`./plans/`](./plans/). Follow *its* Resume Instructions.
8. When a sub-Playbook completes its Final Check, return to this README:
   - Update its row in Progress to Complete
   - Mark the next Draft sub-Playbook as Active
   - Update Master `Last worked` date
   - Append a SESSION_LOG entry at [`../../SESSION_LOG.md`](../../SESSION_LOG.md)
9. Only after all four sub-Playbooks are Complete does the Master Refine begin.

---

## Progress

**Last worked:** 2026-05-27 (run 1wna3uxq — Sub-Playbook D doc/gate authoring COMPLETE on branch `v0.1-publish`; D-S1 removed from v0.1 scope)
**Current Canon:** v0.1 completion phase. Sub-Playbook F + E Complete. B/C Expand merged — Refines parallel-tracked (founder). **Sub-Playbook D — all doc + CI-gate authoring COMPLETE on branch `v0.1-publish` (off `main`, Option A disentangle); only the founder release sequence remains.** Local Class B checks pass; full-suite + D-S2 gates need a CI run on `main` for Class A.
**Next action (founder release):** review branch `v0.1-publish` → merge to `main` (triggers CI = D-S2 Class A proof) → tag `v0.1.0` + release notes (PD-Q6=A). External stranger test removed (PD-Q1); **D-S1 internal proxy removed (founder 2026-05-27)**. B/C Refines remain founder-only parallel tracks. v0.4 control-plane work stays on `oz-control-plane-design`.

### Sub-Playbook status

| Sub-Playbook | Status | Current Canon | Next action | File |
|---|---|---|---|---|
| A. Foundation + config survival | Active — Refine (M4 Checkpoint reached 2026-05-23; awaiting Final Check ceremony) | All 27 M4 rows done; audit §4 port-first list CLOSED 12/12; suite 249/249 all-passing | Final Check ceremony (manual smoke tests on a clean clone — see Refine section) | [`2026-05-21-foundation.plan.md`](./plans/2026-05-21-foundation.plan.md) |
| **E. Dogfood ramp** | **Complete (2026-05-23)** | Solve + Expand + Refine + Final Check 6/6 all green. 12 audit §4 ports closed across 7 autonomous runs; 9 product-code bugs surfaced + fixed end-to-end; B Witness back-reference closed by Sub-Playbook B activation. | — | [`2026-05-22-dogfood-ramp.plan.md`](./plans/2026-05-22-dogfood-ramp.plan.md) |
| B. Personas + workspace template | **Active — Expand merged (`9bf2433`); Refine pending (founder)** | PR #33 merged; PB-Q1..PB-Q4 answered; B-S1..B-M3 green; suite 265/265 | B Refine (founder) | [`2026-05-21-personas-template.plan.md`](./plans/2026-05-21-personas-template.plan.md) |
| **F. Structural cleanup** | **Complete (2026-05-23)** | Final Check closed; PR #28 merged `58e1fe2`; suite 249/249; compose-launch diff clean | — | [`2026-05-23-structural-cleanup.plan.md`](./plans/2026-05-23-structural-cleanup.plan.md) |
| **C. Oz MVP** | **Active — Expand complete (2026-05-23); Refine pending (founder)** | C-M1..C-M3 green (PRs #42–#47 → `f46dcff`); suite 335/335 + dashboard 8/8 | C Refine (founder) | [`2026-05-21-oz-mvp.plan.md`](./plans/2026-05-21-oz-mvp.plan.md) |
| **D. Docs + dogfood + publish** | **Active — all doc/gate authoring COMPLETE on branch `v0.1-publish` (2026-05-27, run 1wna3uxq); founder release sequence remains** | D-M1.1–1.9 docs + ADR-0001 §6 fix + D-M2.1 dogfood-evidence + D-S2 CI gates all landed on `v0.1-publish`; D-S1 + external stranger test removed from scope (founder); local Class B green, D-S2/full-suite Class A pending CI on `main` | **Founder:** review `v0.1-publish` → merge to `main` (CI = D-S2 Class A) → tag `v0.1.0` | [`2026-05-21-docs-publish.plan.md`](./plans/2026-05-21-docs-publish.plan.md) |
| **v0.1 Completion Plan** (cross-cuts A, B, ticket 0001) | **Active** | Items 1 + 2 CLOSED; Item 2.5 F Complete; Item 3 W/I/S authored | PB-Q1..PB-Q4 + B Solve | [`2026-05-23-v0.1-completion.plan.md`](./plans/2026-05-23-v0.1-completion.plan.md) |

### Canon roll-up (Master only)

| Canon | Items | Done | Status |
|---|---|---|---|
| Witness | 1 | 1 | Complete |
| Interrogate | 13 decisions + 9 risks | 13 + 0 | Complete (decisions locked; risks active) |
| Solve | 2 | 2 | Complete |
| Expand | 6 sub-Playbooks (A, **E**, B, **F**, C, D) | 2 (E + F Complete; A Refine-complete; B + C Expand merged; **D activated**) | Active |
| Refine | 4 | 0 | Not started (gated on A Complete) |
| Final Check | 13 | 0 | Not started |

---

## Success Criteria

- [ ] All four sub-Playbooks reach Status: Complete
- [ ] Stranger test (P-R2) passes: **internal proxy** (PD-Q1 revised 2026-05-27 — external recruit removed from v0.1) clones, inits, launches in ≤30 minutes without doc-clarifying questions
- [ ] Two-workspace concurrency test (P-R1) passes without tmux collision
- [ ] Recovery test (P-R3) passes after `local/` deletion and Syncthing restore
- [ ] All public-readiness gates green on the commit tagged `v0.1.0`
- [ ] CoCoder repo dogfoods its own `cocoder/` folder (Sub-Playbook D M8 — partially satisfied already by this restructure)
- [ ] Public git remote populated and tagged `v0.1.0`
