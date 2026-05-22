# CoCoder Foundation — Extract, Generalize, Open-Source

**Created:** 2026-05-21 | **Updated:** 2026-05-21
**Type:** One-time
**Collaboration:** Collaborative
**Status:** Active (Interrogate complete; ready for Solve)
**Method:** WISER Playbook

## Context

CoBuilder's `cobuilder-build/` orchestration stack (iTerm2 + tmux, multi-model adapters, personas, priorities, tickets, ADRs, evidence-led runs, debugger) is production-proven. CoCoder generalizes that stack into a **public, documented, solo/small-team product** that works on arbitrary software repos — with user-specific settings surviving upstream updates.

**Key files (source of truth today):**
- `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/AGENTS.md`
- `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/ARCHITECTURE.md`
- `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/core/`
- `/Volumes/NAS LOCAL/CoBuilder/marketing/brand/design-brief.md` (Oz visual language)
- `/Volumes/NAS LOCAL/Shared/cofounder/tools/Playbook Author/AGENTS.md` (WISER methodology)

**Deliverable:** Shippable CoCoder repo + workspace template + Oz MVP + license + docs sufficient for strangers to adopt.

---

## Preconditions

- [x] License: **Apache-2.0** (founder 2026-05-21)
- [x] Install preferences: **`<CoCoder>/local/`** gitignored (founder 2026-05-21)
- [x] Workspace folder: visible **`cocoder/`** (founder 2026-05-21)
- [ ] CoCoder git remote strategy decided (new public repo; no secrets in history)

---

## Authority

**Autonomous:** Research, ADR drafts, scaffolding, porting orchestration with mechanical renames, tests, docs, example workspace template, Oz UI prototypes on localhost.

**Needs human input:** Publishing repo, telemetry defaults (if any), commercial trademark for "CoCoder" name.

---

## Witness

### Audit findings

| Area | Verified state | Implication for CoCoder |
|------|----------------|-------------------------|
| Orchestration control plane | Mature Node CLI: contracts, adapters, routes, profiles, launch, debugger, run ledger, session-wrap, route-owned commits | **Extract** `orchestration/core` + schemas; generalize paths from `cobuilder-build/` to `cocoder/` |
| Personas | Dual surface: `build-personas/*.md` (private playbooks) + `orchestration/personas/prompts/` (runtime SSOT) | Keep the split; ship public prompts + checklist templates; document custom persona pattern via Phil example |
| Debugger | `ORCH DEBUGGER.command` + `debugger.mjs` — single-run Codex lane with evidence bundles | **Oz supersedes** as multi-run overseer; retain debugger primitives as Oz backend |
| Launch | `Launch-Orchestrator.command` — priority picker, Oscar bootstrap, tmux 120x40 | Oz should replace manual `.command` launches for priorities |
| CoCoder repo | Essentially empty (Syncthing marker only) | Greenfield; no migration debt |
| Talia vs Quinn (CoBuilder) | Talia = broad QA orchestration; Quinn = CDP IDE scripts | User wants Talia = unit tests, Quinn = UX interaction — **document divergence** or realign in ADR |

### Objective

Ship **CoCoder v0.1**: installable orchestration framework any dev can point at a repo, with Oz dashboard for multi-workspace/multi-priority control, git-safe local overrides, and documentation that stands alone without CoBuilder context.

### Scope

**In:** Persona system (Oscar, Ian, Bob, Talia, Quinn, Oz; Phil as example custom), multi-model adapters, workspace `cocoder/` folder, install `local/` preferences, priorities/tickets/ADRs/memory, workspace onboarding, Oz local dashboard, Apache-2.0, recursive dogfooding folder on CoCoder repo.

**Out (v0.1):** Hosted SaaS, team RBAC, cloud sync of runs, marketplace for personas, full codebase visualization (Oz stretch), Windows parity beyond documented best-effort, CoBuilder IDE coupling.

**Depends on:** macOS + iTerm2 + tmux for parity with current launch path; CLIs user installs (Claude, Codex, Grok, etc.).

### Current State

CoCoder is an empty repo target. CoBuilder orchestration is the extraction source. Cofounder WISER Playbook Author defines execution discipline for this build.

### Deliverable

Public git repository with architecture docs, ADRs, working CLI (`coder` or `cocoder` — name TBD), Oz dashboard, workspace template, and one reference onboarding of CoCoder itself (`cocoder/` inside CoCoder repo).

**Checkpoint:** [x] Current state verified. Objective measurable. Scope boundaries explicit.

---

## Interrogate

### Founder decisions (2026-05-21)

| # | Decision |
|---|----------|
| 1 | **Apache-2.0** — recognizable standard; contribution-back via culture/CONTRIBUTING, not copyleft |
| 2 | **`<CoCoder>/local/`** gitignored inside install repo; multi-machine via folder sync (Syncthing etc.), not `~/.config` |
| 3 | Visible **`cocoder/`** in workspaces |
| 4 | Talia = test layer, Quinn = experience layer — see `decisions/0002-talia-quinn-boundary.md` |
| 5 | Phil = **example only** |
| 6 | Oz = master persona, **no separate brand** |
| 7 | macOS-first — accepted |
| 8 | git clone + pnpm — accepted |
| 9 | Per-workspace tmux socket — accepted (see ARCHITECTURE.md plain-language section) |
| 10 | CoCoder independent OSS; **CoBuilder migrates** after CoCoder v0.1 |

### Execution risks

| Risk | Status | Mitigation | Notes |
|------|--------|------------|-------|
| Git pull overwrites user prefs | Active | Split **tracked template** vs **gitignored `cocoder/local/`**; ship root `.gitignore` + `cocoder/.gitignore` patterns; document `git update` flow | Git never touches ignored paths — verified pattern |
| Path-hardcoded CoBuilder assumptions | Active | Mechanical port with `packages/core/lib/paths.mjs` resolver; acceptance tests on temp workspaces | |
| Oz scope explosion | Active | MVP = workspace list, model map, priority launch, run status; defer codebase viz | |
| Multi-workspace tmux collisions | Active | Per-workspace tmux socket + session prefix in Oz registry | |
| Persona identity drift (session 583 class) | Active | Port argv + private playbook rules verbatim; add regression test in prompt composition | |
| Open-source doc rot | Active | ADR + ARCHITECTURE verification stamps; Oz "doc freshness" panel later | |
| Extract breaks CoBuilder | Active | Copy-first in CoCoder; CoBuilder keeps canonical until cutover ADR | |
| License scares enterprise | Active | MPL not AGPL; publish FAQ on "building commercial apps with CoCoder" | |

**Checkpoint:** [x] Founder decisions recorded. Riskiest piece = **git-safe split + preferences resolver** (Solve).

---

## Solve

*Prove user settings survive repo updates before porting 30k lines of orchestration.*

**Riskiest piece:** Local/global configuration architecture that survives `git pull` on CoCoder and init in arbitrary workspaces.

### Tasks

- [ ] **S1.1** Implement config resolver spec (ADR-0001): load order `defaults < install template < CoCoder/local/* < workspace cocoder/config.yaml < workspace cocoder/local/*`
- [ ] **S1.2** Create fixture workspace with intentional `cocoder/local/overrides.json` and run simulated `git pull` (overwrite tracked files only) — assert local intact
- [ ] **S1.3** Document in `docs/configuration.md` with "what survives updates" table

**Pass threshold:** Automated test green; manual checklist: delete tracked `cocoder/PRIORITIES.md`, restore from git, `local/` unchanged.

**Checkpoint:** [ ] Config survival proven.

---

## Expand

### Milestone 1 — Repository skeleton and governance

- [ ] **E1.1** `README.md` — what CoCoder is, 5-minute mental model, requirements (Node 20+, tmux, iTerm2, CLIs)
- [ ] **E1.2** `ARCHITECTURE.md` — two-layer model (CoCoder install vs workspace `cocoder/`)
- [ ] **E1.3** `LICENSE` (Apache-2.0) + `NOTICE` template
- [ ] **E1.4** `decisions/README.md` + ADR-0001 (config), ADR-0002 (directory layout), ADR-0003 (persona dual-surface)
- [ ] **E1.5** `CONTRIBUTING.md` + `CODE_OF_CONDUCT.md`
- [ ] **E1.6** Root `.gitignore` — `node_modules`, Oz build artifacts, **never** ignore `cocoder/local/`

### Milestone 2 — Extract orchestration core (from CoBuilder)

- [ ] **E2.1** Copy `orchestration/contracts`, `core/lib`, `core/cli.mjs`, `adapters`, `tests` → `packages/core/` with path abstraction
- [ ] **E2.2** Rename cobuilder-specific paths: `cobuilder-build` → `cocoder`, `COB_ORCH_*` → `CODER_ORCH_*` env prefix
- [ ] **E2.3** Generalize RACI/write-boundary standards to workspace-relative `cocoder/standards/`
- [ ] **E2.4** CLI entry: `packages/core/bin/coder.mjs` (`validate-contracts`, `compose-launch`, `prepare-debug`, `list-runs`)
- [ ] **E2.5** Port focused tests; CI workflow (GitHub Actions) on push

### Milestone 3 — Persona system

- [ ] **E3.1** Core persona contracts: oscar, ian, bob, talia, quinn, oz (new contract — read-only + control actions)
- [ ] **E3.2** Prompt manifest + shared fragments (port from CoBuilder; strip CoBuilder-only references)
- [ ] **E3.3** Public playbook summaries in `personas/playbooks/`; document that operators may maintain private `local/playbooks/`
- [ ] **E3.4** `examples/personas/phil-primitive-builder/` — template + checklist + sample route
- [ ] **E3.5** Custom persona guide: `docs/custom-personas.md` (schema, checklist dir, route eligibility, Oz registration)
- [ ] **E3.6** ADR: Talia vs Quinn boundaries for CoCoder

### Milestone 4 — Workspace `cocoder/` template and onboarding

- [ ] **E4.1** `templates/workspace-cocoder/` — AGENTS.md, PRIORITIES.md, TICKETS.md, SESSION_LOG.md, plans/, decisions/, memory/, personas/custom/, standards/, local/.gitkeep
- [ ] **E4.2** `coder init` — scaffold into target repo, merge `.gitignore`, conflict report
- [ ] **E4.3** `coder audit-workspace` — stack detection, AGENTS.md chain, test commands, architecture doc gaps, open questions file `memory/onboarding-questions.md`
- [ ] **E4.4** `coder refresh-memory` — update `memory/codebase-map.md`, `memory/tech-stack.md` from audit (bounded, deterministic + LLM-assisted with evidence)
- [ ] **E4.5** Onboarding playbook template for humans/Oscar: `templates/playbooks/new-workspace-setup.md`

### Milestone 5 — Oz dashboard MVP

- [ ] **E5.1** `packages/oz-daemon` — HTTP API: list workspaces, list runs (all sockets), read `status.json`, launch priority, stop run
- [ ] **E5.2** `packages/oz-dashboard` — Fusion light/dark; pages: Workspaces, Priorities, Runs, Settings (model map)
- [ ] **E5.3** Concurrency indicator per priority (route metadata + Oz registry)
- [ ] **E5.4** Replace double-click launch for priorities (keep CLI fallback)
- [ ] **E5.5** Port debugger evidence collector as Oz "Run Inspector" view (read-only first)
- [ ] **E5.6** Settings UI: per-persona model roles, subagent models, adapter preflight status

### Milestone 6 — Install preferences (`<CoCoder>/local/`)

- [ ] **E6.1** `local/config.example.yaml` + schema — workspaces registry, default adapters, Oz port, theme
- [ ] **E6.2** `local/secrets/` gitignored — API key paths only, never values in public repo
- [ ] **E6.3** Oz reads/writes `local/`; CLI `coder config get/set`; docs for multi-machine Syncthing sync

### Milestone 7 — Documentation (open-source grade)

- [ ] **E7.1** `docs/getting-started.md` — install, init workspace, first priority, first launch
- [ ] **E7.2** `docs/orchestration.md` — tmux model, runs, evidence, session wrap
- [ ] **E7.3** `docs/personas.md` — who does what, dispatch rules
- [ ] **E7.4** `docs/oz.md` — dashboard operations
- [ ] **E7.5** `docs/faq.md` — license, commercial use, what to commit vs not
- [ ] **E7.6** Architecture diagram (Mermaid) in ARCHITECTURE.md

### Milestone 8 — Dogfood (recursive improvement)

- [ ] **E8.1** Run `coder init` on CoCoder repo itself
- [ ] **E8.2** Priority in `cocoder/PRIORITIES.md`: "CoCoder v0.1 foundation"
- [ ] **E8.3** Oscar session builds next milestone using CoCoder on CoCoder
- [ ] **E8.4** SESSION_LOG + plan Progress kept current

### Documentation Updates

- [ ] All ADRs referenced from ARCHITECTURE.md
- [ ] Playbook Progress updated each session

**Checkpoint:** [ ] All milestones complete per Success Criteria.

---

## Refine

- [ ] Founder runs Oz on 2 real workspaces concurrently (different repos)
- [ ] External reader test: clone fresh, follow getting-started without founder help
- [ ] Iterate dashboard UX against design-brief restraint (no mission-control clutter)

**Checkpoint:** [ ] External validation passed.

---

## Final Check

- [ ] Documentation Updates from Expand complete
- [ ] No stale `cobuilder-build` path references in CoCoder
- [ ] Tests pass in CI
- [ ] Checkboxes match reality
- [ ] Decision Log current
- [ ] `cocoder/local/` still gitignored after all merges

---

## Decision Log

| Date | Decision | Rationale | Alternatives |
|------|----------|-----------|--------------|
| 2026-05-21 | Apache-2.0 license | Most recognizable OSS standard for tooling | MPL-2.0, custom license |
| 2026-05-21 | Install prefs in `<CoCoder>/local/` gitignored | Same folder as engine; survives pull; sync across machines via Syncthing | `~/.config/cocoder/` |
| 2026-05-21 | Three zones: install tracked, install `local/`, workspace `cocoder/` + `cocoder/local/` | Clear separation of OSS vs user vs project | Single hidden `.cocoder` at repo root only |
| 2026-05-21 | `cocoder/local/**` gitignored by default | User prefs immune to pull | Git skip-worktree on tracked files (fragile) |
| 2026-05-21 | CoBuilder migrates after CoCoder v0.1 | Independent OSS product | CoCoder as subdirectory of CoBuilder forever |
| 2026-05-21 | Oz evolves from ORCH DEBUGGER multi-run | Proven evidence model; needs cross-workspace scope | New greenfield supervisor with no evidence lineage |
| 2026-05-21 | Phil = example custom persona, not core | Keeps CoCoder domain-agnostic | Port Phil as core (CoBuilder-coupled) |

---

## Learnings

| Date | Learning | Impact |
|------|----------|--------|
| 2026-05-21 | CoBuilder orchestration already model-neutral with JSON contracts | Extraction is feasible without rewrite |
| 2026-05-21 | Debugger owns orchestration repair; Oscar explicitly excluded | Oz should inherit repair authority boundaries |

---

## Resume Instructions

1. Read this Playbook end-to-end; founder decisions are in Interrogate table and ADR-0001/0002.
2. Read CoBuilder `orchestration/ARCHITECTURE.md` and `plans/2026-05-17-orchestration-rebuild.md` for port boundaries.
3. Check Progress — continue from current Canon.
4. If resuming Solve: run/config tests before Milestone 2 port.
5. Update Decision Log when founder confirms license and paths.

## Progress

**Last worked:** 2026-05-21
**Current Canon:** Solve
**Next action:** Execute S1.1 config resolver + S1.2 git-pull survival test

| Canon | Items | Done | Status |
|-------|-------|------|--------|
| Witness | 1 | 1 | Complete |
| Interrogate | 10 | 10 | Complete |
| Solve | 3 | 0 | Active |
| Expand | 35 | 0 | Not started |
| Refine | 3 | 0 | Not started |
| Final Check | 6 | 0 | Not started |
| **Total** | **61** | **1** | **Active** |

---

## Success Criteria

- [ ] New developer clones CoCoder, inits a workspace, launches a priority via Oz without reading CoBuilder source
- [ ] `git pull` on CoCoder updates tracked templates without touching `<CoCoder>/local/` or `<app>/cocoder/local/`
- [ ] Two workspaces run concurrent priorities without tmux session collision
- [ ] Core personas documented; Phil example demonstrates custom persona
- [ ] License file present; FAQ answers commercial use + contribution obligation
- [ ] CoCoder repo dogfoods its own `cocoder/` folder for ongoing development
