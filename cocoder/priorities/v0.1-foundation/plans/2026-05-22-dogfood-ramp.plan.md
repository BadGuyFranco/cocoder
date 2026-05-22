# Sub-Playbook E — Dogfood Ramp: first orchestrated CoCoder-on-CoCoder task

**Created:** 2026-05-22 | **Updated:** 2026-05-22
**Type:** One-time
**Collaboration:** Collaborative
**Status:** Active — Final Check (E3.3 PASSED + Refine PASSED 2026-05-22; both `core.test.mjs` and `dispatch.test.mjs` ported under autonomous orchestration)
**Method:** WISER Playbook (Sub-Playbook; Master = `../README.md`)
**Parent:** [v0.1-foundation priority](../README.md)
**Audit evidence:** [`2026-05-22-foundation-audit.md`](./2026-05-22-foundation-audit.md)
**Founder gates:** [`../pending-decisions.md`](../pending-decisions.md) (Q1, Q2, Q4 must be Answered for M4.22–M4.24 → required by this Sub-Playbook)

> **Resume cue:** This Sub-Playbook proves CoCoder can orchestrate work on itself. It exists because the 2026-05-22 audit found we're dogfooding the *structure* (priorities, plans, ADRs, session log) but not the *orchestration* — the only product feature that actually matters. Until Talia runs a Codex pane from a CoCoder profile and ports a test file into `packages/core/tests/`, the v0.1 product is unproven on its own author.

## Context

CoCoder v0.1 succeeds or fails on whether a user can sit at a terminal and have Bob/Talia/Quinn work autonomously on their codebase. **We have not yet done this on ourselves.** Sub-Playbook B owns the full workspace template (personas + scaffolds + `cocoder init`); Sub-Playbook C owns Oz. This Sub-Playbook pulls forward the smallest possible slice of B's persona work so the founder can prove the orchestration loop end-to-end on the CoCoder dogfood workspace itself, **before** B and C absorb scope and timeline.

The first orchestrated task is deliberately Talia (not Bob) and deliberately mechanical: **port the 12 CoBuilder test files identified in audit §4 into `packages/core/tests/`** (Sub-Playbook A E2.2e — currently un-done). Talia's natural zone (`packages/core/tests/`) sits outside the orchestration-from-install foot-gun (audit §B5). The deliverable is regression coverage — the very thing that protects every future dogfood orchestration. Self-leveraging by design.

This is **not** the full Sub-Playbook B. We borrow exactly three persona artifacts from CoBuilder (Bob persona file, Talia persona file, their prompts) plus one profile, one route, and one manifest. Full B (workspace template, `cocoder init`, audit-workspace, refresh-memory, public docs of personas) still lands later.

**Key files for resume:**

- Audit: [`./2026-05-22-foundation-audit.md`](./2026-05-22-foundation-audit.md) (§§1, 4 most relevant)
- Pending decisions: [`../pending-decisions.md`](../pending-decisions.md) (Q1, Q2, Q4 required)
- Sub-Playbook A: [`./2026-05-21-foundation.plan.md`](./2026-05-21-foundation.plan.md) Milestone M4 (prerequisites)
- Sub-Playbook B: [`./2026-05-21-personas-template.plan.md`](./2026-05-21-personas-template.plan.md) (full personas/template scope — this Playbook pulls a thin slice forward; the slice should be designed for forward-compat with B)
- ADR-0001 storage zones, ADR-0002 Talia/Quinn boundary, ADR-0003 binary name, ADR-0004 TS/Zod/AJV/pnpm, ADR-0005 Oz improvement routing
- ARCHITECTURE.md "Multi-workspace concurrency", "Multi-machine path portability", "Oz daemon security model", "Oz improvement routing"
- CoBuilder personas source: `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/personas/`

---

## Preconditions

- [x] Sub-Playbook A Milestone M4 free-wins (M4.1, M4.2, M4.3, M4.4, M4.15) complete — eliminates the `cocoder/core/cli.mjs` hardcoded path bug, the CoBuilder identifier leakage, and the secret-pattern gitignore gap, all of which would otherwise blow up the first orchestrated invocation *(closed 2026-05-22 evening; see SESSION_LOG)*
- [x] [`../pending-decisions.md`](../pending-decisions.md) Q1 Answered (drives M4.22 product-write gate) — **Option B** (minimal `--developer-mode` belt) — closed 2026-05-22
- [x] [`../pending-decisions.md`](../pending-decisions.md) Q2 Answered (drives M4.23 `config set` zone defaults) — **Option A** (install-local default + `--workspace-root` flag) — closed 2026-05-22
- [x] [`../pending-decisions.md`](../pending-decisions.md) Q4 Answered (drives M4.24 workspace detection / "no workspace inside install" stance) — **Option A** → **ADR-0006** — closed 2026-05-22
- [x] Sub-Playbook A Milestone M4 founder-gated tasks M4.22, M4.23, M4.24 complete — the safety belts that prevent this Sub-Playbook from mutating product source by accident *(closed 2026-05-22; M4.25, M4.26, M4.27 also landed; see SESSION_LOG)*
- [x] `pnpm install` clean on Node 20 LTS (engine warnings under Node 25 acceptable per ADR-0004 and prior session notes) *(verified via pretest schemas build 2026-05-22)*
- [x] `pnpm -F core test config-resolver` green *(5/5 tests pass 2026-05-22 evening)*
- [x] `cocoder validate-contracts` exits 0 *(verified 2026-05-22 evening)*

---

## Authority

**Autonomous:**
- Borrowing CoBuilder personas (`bob.json`, `talia.json`, their prompt files) into `cocoder/personas/`
- Authoring minimal `cocoder/profiles/cocoder-dogfood.yaml`, `cocoder/routes/dogfood-port-tests.yaml`, persona manifest
- Running `cocoder compose-launch` in dry-run mode against the new artifacts
- Capturing run evidence into `local/workspaces/cocoder-dogfood/runs/`
- Talia-authored test files going into `packages/core/tests/` (per audit §4 port-first list)

**Needs human input:**
- Any persona artifact change that diverges from CoBuilder source beyond mechanical scrubbing
- Any `--developer-mode` invocation (per M4.22 belt; per ADR-0005 contributor-only routing)
- Any write outside `packages/core/tests/` during the first orchestrated task — STOP and ask
- Any decision that would graduate to a new ADR (e.g., persona contract format changes)

---

## Witness

### Audit findings

| Area | Verified state | Implication for this Sub-Playbook |
|---|---|---|
| Meta-project dogfood (structure, ADRs, sessions, pending-decisions) | **Live since 2026-05-21 restructure**; proven by today's audit surfacing real bugs | Level 0 dogfood works; this Sub-Playbook upgrades to Level 2 (orchestration) |
| Orchestration on self | **Not yet exercised** — `cocoder compose-launch` exists in code but no profile/route/persona is present in dogfood `cocoder/` | E1 ports minimum-viable persona library; E2 authors one profile + route |
| Persona source (CoBuilder `personas/`) | Bob, Talia, Quinn, Oscar, Phil, Ian, Bea each have `*.json` contract + prompt fragment; manifest at `orchestration/personas/manifest.json` | Borrow Bob + Talia + their prompts only; defer Quinn/Oscar/Phil/Ian/Bea to Sub-Playbook B |
| CLI surface for compose-launch | Wired in `packages/cocoder-cli/src/cli.ts` → `packages/core/cli.mjs` `compose-launch` | After M4 prerequisites, command should function on dogfood profile |
| Test gap (audit §B4) | `packages/core/tests/` has 6 tests vs CoBuilder ~291 | First orchestrated task = Talia ports core.test.mjs (E2.2e.1) — fastest path to regression net |
| Foot-gun: orchestration-from-install (audit §B5) | `orchestrator-commit.mjs` default surfaces include `packages/`, `docs/`, `templates/`, `.github/` | M4.22 belt MUST be in place before this Sub-Playbook executes Refine |

### Objective

End-to-end proof that `cocoder compose-launch --profile cocoder-dogfood --route dogfood-port-tests` produces a working Talia tmux pane that ports one or more CoBuilder test files into `packages/core/tests/` without mutating anything outside Talia's expected zone, with run evidence captured and SESSION_LOG documented.

### Scope

**In:**
- `cocoder/personas/bob.json`, `cocoder/personas/talia.json` (borrowed + scrubbed)
- `cocoder/personas/prompts/personas/bob.md`, `cocoder/personas/prompts/personas/talia.md`
- `cocoder/personas/prompts/shared/` — minimum-set fragments referenced by Bob/Talia prompts (composition.mjs will tell us which when compose-launch is dry-run)
- `cocoder/personas/manifest.json` — minimal manifest for the two personas
- `cocoder/profiles/cocoder-dogfood.yaml` — one profile
- `cocoder/routes/dogfood-port-tests.yaml` — one route, single Talia lane
- `cocoder/standards/` — minimum write-boundary fragment referenced by Talia (if compose-launch demands it)
- First orchestrated task: Talia ports audit §4 E2.2e.1 (`core.test.mjs`) into `packages/core/tests/core.test.mjs`
- `local/workspaces/cocoder-dogfood/` — run evidence directory
- One SESSION_LOG entry documenting the first successful orchestrated dogfood task

**Out:**
- Quinn, Oscar, Phil, Ian, Bea personas (Sub-Playbook B)
- Workspace template at `templates/workspace-cocoder/` (Sub-Playbook B)
- `cocoder init` / `audit-workspace` / `refresh-memory` (Sub-Playbook B)
- Oz daemon, dashboard, run inspector (Sub-Playbook C)
- Public docs for personas, getting-started, faq (Sub-Playbook D)
- E2.2e.2 through E2.2e.12 (handled via repeat invocations after this Sub-Playbook proves the loop; tracked in Sub-Playbook A)

### Boundaries (what the dogfood workspace is/is not)

- **Install root:** `/Volumes/NAS LOCAL/CoCoder/`
- **Workspace root for this Sub-Playbook:** `/Volumes/NAS LOCAL/CoCoder` (the install root itself; the install's `cocoder/` subdirectory IS its meta-project workspace per ADR-0006 §Decision step 1) — passed explicitly via `--workspace-root` AND `--workspace-slug=cocoder-dogfood` per Q4 decision to avoid ambiguity. **Do not pass `--workspace-root` pointing at `<install>/cocoder` itself**: the config resolver expects `<workspaceRoot>/cocoder/<file>`, so an extra `cocoder/` level would make every workspace-tracked lookup miss.
- **Workspace slug:** `cocoder-dogfood` — drives the install-local artifact zone at `local/workspaces/cocoder-dogfood/` per M4.25 / Q3-A
- **Talia's allowed write zone:** `/Volumes/NAS LOCAL/CoCoder/packages/core/tests/` only (this is a one-time exception to the four-zone rule — Talia is writing product test code, which is install-public-tracked; gated by M4.22 `--developer-mode` flag per Q1 Option-B)
- **Run evidence zone:** `/Volumes/NAS LOCAL/CoCoder/local/workspaces/cocoder-dogfood/runs/`
- **Audit log:** `/Volumes/NAS LOCAL/CoCoder/local/audit/oz-actions.jsonl` (Oz daemon not running; CLI writes the audit entry directly)

---

## Interrogate

### Risks

| Risk | Probability | Mitigation | Owner |
|---|---|---|---|
| Borrowing CoBuilder personas pulls Sub-Playbook B work forward | Certain | Acceptable — these artifacts must be ported eventually; pulling 3 of ~7 forward by one Sub-Playbook is a small scope cheat for proving the orchestration loop. The remaining personas + the workspace template still live in B. | This Playbook |
| Talia auto-commit mutates `packages/` outside `packages/core/tests/` | Medium | M4.22 product-write belt requires explicit `--developer-mode`; route declares Talia's allowed write paths; orchestrator-commit `filesChanged` guard rejects out-of-scope writes (audit §B4 — covered by ported `orchestrator-commit.test.mjs`) | M4.22 + E4 |
| `compose-launch` fails due to undocumented missing prompt fragments | High initially | Solve task is a dry-run that surfaces every missing artifact before execute; iterate borrowing until composition succeeds | E-S1 |
| CoBuilder persona prompts reference CoBuilder-specific paths, scripts, or playbooks not present in CoCoder | Medium | Scrub pass on each borrowed file; document divergences in `cocoder/personas/PORT-NOTES.md` for Sub-Playbook B to extend | E1 |
| Q1/Q2/Q4 founder defaults change scope mid-flight | Low (defaults recommended) | Preconditions block this Sub-Playbook from starting until decisions Answered | Preconditions |
| Talia's ported test fails on macOS-14 Node 20 because of fixture-path differences (`cobuilder-build/...` vs `packages/core/...`) | High | Talia's prompt explicitly references the audit §4 port-first list and the layout mapping; Solve task confirms one happy-path fixture mapping before launching | E-S1 |
| Run dir / audit log path collisions with future Sub-Playbook C Oz daemon | Low | Run dir under `local/workspaces/cocoder-dogfood/` is the canonical zone; Oz daemon will read this; no collision | None |

### Decisions

| Decision | Rationale | Alternatives |
|---|---|---|
| First persona is Talia (test work), not Bob (code work) | Lowest blast radius; allowed write zone narrow (`packages/core/tests/`); deliverable (regression coverage) protects all future dogfood orchestration | Bob first on a small refactor (rejected — larger blast radius) |
| First task is E2.2e.1 `core.test.mjs` port | Audit §4 ranks it first; covers contracts/persona load/ledger primitives/priority extractor — the surface most exercised by other ports later | Pick a smaller test for lower risk (rejected — diminishes proof value) |
| Borrow 3 persona artifacts from CoBuilder verbatim (then scrub) | ADR-0004 extraction strategy (copy-first, modify-later); preserves behavior; forward-compatible with Sub-Playbook B full port | Hand-author CoCoder-native personas (rejected — premature, costly, untested) |
| Workspace root explicit via `--workspace-root=/Volumes/NAS LOCAL/CoCoder` + `--workspace-slug=cocoder-dogfood` | Q4-Option-A / ADR-0006: install's own `cocoder/` IS the dogfood workspace; the workspace root is therefore the install root itself, and the slug differentiates the artifact zone from any future install-local namespaces. Originally drafted as `--workspace-root=/Volumes/NAS LOCAL/CoCoder/cocoder` — corrected 2026-05-22 after M4.23/M4.24 implementation made the config-resolver workspace-root semantic concrete (config resolver looks for `<workspaceRoot>/cocoder/config.yaml`, so a `<install>/cocoder` workspace-root would miss every lookup). | Implicit cwd detection (rejected — exactly the foot-gun Q4 addresses); `--workspace-root=<install>/cocoder` (rejected — workspace lookups miss) |
| Talia uses `--developer-mode` flag for this invocation only | M4.22 belt gates any write under `packages/`; Talia legitimately writes `packages/core/tests/`; explicit opt-in keeps the gate meaningful | Carve `packages/core/tests/` out of M4.22 gate (rejected — special-case erodes the belt) |
| Run evidence goes to `local/workspaces/cocoder-dogfood/runs/` per ARCHITECTURE L132-136 | Matches the four-zone model; Q3 Option-A | `cocoder/local/runs/` (Q3 Option-B; rejected — workspace-private state should travel with install per multi-machine sync) |

### Reuse check

- [x] CoBuilder personas + prompt fragments — borrowed verbatim with scrubbing
- [x] CoBuilder `personas/manifest.json` format — referenced as schema
- [x] `cocoder compose-launch` + `cocoder/core/lib/composition.mjs` — runtime already present (from Sub-Playbook A)
- [x] Audit §4 port-first list — task definition for Talia

**Checkpoint:** [ ] Risks have owners; decisions logged; reuse identified.

---

## Solve

*The riskiest invariant: composition succeeds. If `compose-launch` cannot assemble a working prompt + manifest from the borrowed CoBuilder artifacts, this Sub-Playbook fails before Expand starts.*

### Tasks

- [x] **E-S1** Borrow Bob persona + minimum prompt set into `cocoder/personas/` (just enough to compose a launch-time Bob prompt). Two-step proof:
   1. `compose-launch` (readiness probe — returns JSON, no `--dry-run` flag; `compose-launch` IS the dry-run path. `--profile` / `--route` are file paths, not slug names. `--priority-slug` is required.):
      ```
      cd /Volumes/NAS LOCAL/CoCoder
      pnpm exec cocoder compose-launch \
        --profile cocoder/profiles/cocoder-dogfood.profile.json \
        --route cocoder/routes/dogfood-port-tests.json \
        --priority-slug v0.1-foundation \
        --workspace-root "/Volumes/NAS LOCAL/CoCoder" \
        --workspace-slug cocoder-dogfood
      ```
      Iterate borrowing/scrubbing until result `ok: true, status: ready, issues: []`. Capture JSON at `local/workspaces/cocoder-dogfood/solve-evidence/composed-prompt-dry-run.json`.
   2. `launch` (renders the actual prompt; defaults to `--execute=false` which writes artifacts without starting tmux):
      ```
      pnpm exec cocoder launch \
        --profile cocoder/profiles/cocoder-dogfood.profile.json \
        --route cocoder/routes/dogfood-port-tests.json \
        --priority-slug v0.1-foundation \
        --workspace-root "/Volumes/NAS LOCAL/CoCoder" \
        --workspace-slug cocoder-dogfood
      ```
      Returns `ok: true, status: ready`. Capture `<runDir>/jobs/bob/prompt.md` → `local/workspaces/cocoder-dogfood/solve-evidence/composed-prompt-dry-run.txt`. **Completed 2026-05-22 (Sub-Playbook E Solve);** 4 core bugs surfaced + fixed (see [`cocoder/personas/PORT-NOTES.md`](../../../personas/PORT-NOTES.md)).
- [x] **E-S2** Verify composed prompt contains: (1) persona identity (Bob at E-S1; Talia argv arrives at E3.3 once Talia is borrowed), (2) playbook excerpt, (3) route lane definition, (4) workspace context summary, (5) audit §4 task hint (port-first list reference) — **deferred to E3.1** since Talia's route is what declares the source/target paths; not applicable at E-S1 Bob-only scope, (6) allowed-write-zone declaration (`packages/core/tests/` — appears in `startup-packet.json` next to prompt.md), (7) refusal protocol for out-of-zone writes (`VERIFICATION_ARTIFACT_GUARD_LINE` canonical inline). **Completed 2026-05-22:** 6/7 green; 5/7 correctly deferred to E3.

**Pass threshold:** compose-launch exits 0 with `ok: true`; `launch` (default no-execute) writes a complete prompt.md; 6 of 7 `rg` verifications return ≥1 hit and the 7th (Talia task hint) is documented as deferred to E3 since E-S1 borrows Bob-only.

**Checkpoint:** [x] Composition proven 2026-05-22; ready for Expand to borrow Talia and execute.

---

## Expand

### Milestone E1 — Persona artifacts (borrow + scrub)

- [x] **E1.1** Copied `bob.json` → `cocoder/personas/bob.json`; scrubbed `allowedRoutes` to dogfood-only.
- [x] **E1.2** Copied `talia.json` → `cocoder/personas/talia.json`; same scrub; `writePolicy` flipped from `read-only` to `task-scoped` so Talia can write `packages/core/tests/` for the dogfood port.
- [x] **E1.3** Copied `personas/bob.md` + `personas/talia.md` verbatim into `cocoder/personas/prompts/personas/`.
- [x] **E1.4** Copied 6 shared fragments (`startup-packet.md`, `write-boundaries.md`, `result-contract.md`, `closeout.md`, `private-playbook-boundary.md`, `evidence-classes.md`) into `cocoder/personas/prompts/shared/`. Two scrubs: `ORCHESTRATION-REBUILD` → `v0.1-foundation`; the verification-artifact guard line scrubbed per Q5=A (canonical inline at `VERIFICATION_ARTIFACT_GUARD_LINE`).
- [x] **E1.5** Authored `cocoder/personas/PORT-NOTES.md` — full borrow/scrub log + the 5 bugs Sub-Playbook E surfaced, with v0.2 follow-ups for Sub-Playbook B.
- [x] **E1.6** Authored `cocoder/personas/prompts/manifest.json` listing Bob + Talia; both reference the same 6 shared fragments + their own persona prompt.
- [x] **E1.7** `cocoder validate-profiles`, `validate-routes`, `validate-priority-boundaries` all `ok: true`. `validate-personas` returns `ok: false` only because oscar/quinn/ian/phil/verifier are not borrowed (deferred to Sub-Playbook B per scope); the borrowed personas (bob + talia) validate clean.

### Milestone E2 — Profile, route, priority-boundary, standards

> **Format correction (Solve-driven):** profile/route/boundary files must be **JSON** (`loadProfile`/`loadRoute` go through `readJson`). The plan originally said `.yaml`; reality is `.json`. The dogfood files are at `cocoder/profiles/cocoder-dogfood.profile.json`, `cocoder/routes/dogfood-port-tests.json`, and `cocoder/priority-boundaries/v0.1-foundation.boundary.json`.

- [x] **E2.1** Author `cocoder/profiles/cocoder-dogfood.profile.json` (authored at E-S1 with all 11 required lane sub-keys stubbed — Bob is the only live writer; the other 10 lanes stub `persona: 'bob'` to satisfy persona-existence checks until Talia + the rest of the persona library land at E1 / Sub-Playbook B). Profile carries adapter (codex), priority slug `v0.1-foundation`, and a `modelRoles` block (`builder: { lane: 'bob' }, fallbackPolicy: 'ask-founder', substitutionPolicy: 'strict'`).
- [x] **E2.2** Route extended to `lead: bob, teammates: [talia], lanes: [bob, talia]`, one-writer (Talia). Task hint encoded in the priority excerpt at `cocoder/PRIORITIES.md` (under "Parser-readable priority entries") rather than the route file itself — the route doesn't have a free-text task slot, and the priority excerpt is the natural place because it surfaces in the startup-packet which both Bob and Talia load. Profile flipped Bob to read-only and Talia to writer with `writeBoundary: packages/core/tests/`. Priority-boundary updated to make Talia the writer lane.
- [x] **E2.3** Authored `cocoder/priority-boundaries/v0.1-foundation.boundary.json` (writer lane Bob with allowed=[`packages/core/tests/`] and excluded=all-other-product-surfaces — this is the priority-boundary file `validateRouteSemantics` requires; the plan originally didn't name it). The `cocoder/standards/write-boundaries.md` standards doc is INTENTIONALLY NOT authored (per Q5=A the verification-artifact write-guard is canonical inline at `VERIFICATION_ARTIFACT_GUARD_LINE` in `packages/core/lib/launch.mjs`); the borrowed `cocoder/personas/prompts/shared/write-boundaries.md` covers the priority-boundary behavioral rule.
- [x] **E2.4** Validation green: `cocoder validate-profiles`, `cocoder validate-routes`, `cocoder validate-personas` (Bob only — full set when Talia adds), `cocoder validate-priority-boundaries` all return `ok: true` for the dogfood files.

### Milestone E3 — First orchestrated launch (Talia, dogfood-only)

- [x] **E3.1** Dry-render invocation completed 2026-05-22 — `launch` (no execute) returned `ok: true, status: ready, issues: []`; both Bob's (156-line) and Talia's (148-line) `prompt.md` rendered. 7/7 E-S2 rg verifications green against Talia's prompt + startup-packet (priority excerpt carries source path, target path, translation rules, do-not-port list, and DoD inline). Invocation (`launch` default writes prompt.md without starting tmux; `compose-launch` is JSON-only readiness probe):
   ```
   cd /Volumes/NAS LOCAL/CoCoder
   pnpm exec cocoder launch \
     --profile cocoder/profiles/cocoder-dogfood.profile.json \
     --route cocoder/routes/dogfood-port-tests.json \
     --priority-slug v0.1-foundation \
     --workspace-root "/Volumes/NAS LOCAL/CoCoder" \
     --workspace-slug cocoder-dogfood \
     --developer-mode
   ```
   Expect: `ok: true, status: ready`. Composed prompt at `local/workspaces/cocoder-dogfood/runs/<run-id>/jobs/talia/prompt.md` (Bob's prompt also rendered as lead).
- [x] **E3.2** Talia's prompt.md confirmed structurally equivalent to E-S1 Bob artifact (modulo identity + run-id + startup-mode); task hint surfaces via `startup_packet:` reference → `startup-packet.json` → priority excerpt. Snapshot at `local/workspaces/cocoder-dogfood/solve-evidence/composed-prompt-dry-run.txt`.
- [x] **E3.3** Executed 2026-05-22. First attempt (`run-20260522T132854Z-j55rci2s`) blocked on **Bug E** (codex `--sandbox workspace-write` denies tmux IPC). Bob followed his "do not repair orchestration mechanics" guard, wrote `status: BLOCK` with diagnostic findings, Talia stayed correctly idle in `wait-for-lead-dispatch`. Bug E fixed in `packages/core/lib/launch.mjs` `renderSessionWrapper` (gate codex sandbox on `session.startupMode`; lead → `danger-full-access`, teammate/writer → `workspace-write`); regression test added. Second attempt (`run-20260522T133403Z-rwrkcfcg`) **PASSED** — Talia ported `core.test.mjs` (446 lines), Bob accepted with independent audit, both wrote `status: PASS` results. Test count after port: **75/75 pass · 0 fail**.
   ```
   pnpm exec cocoder launch \
     --profile cocoder/profiles/cocoder-dogfood.profile.json \
     --route cocoder/routes/dogfood-port-tests.json \
     --priority-slug v0.1-foundation \
     --workspace-root "/Volumes/NAS LOCAL/CoCoder" \
     --workspace-slug cocoder-dogfood \
     --developer-mode \
     --execute true
   ```
   Talia tmux pane launches under socket `cocoder-orchestration` (default; reconciled with ADR-0001 in Sub-Playbook B if per-workspace sockets land), reads its prompt, begins porting `core.test.mjs`.
- [ ] **E3.4** Founder shadow attach during the run — **deferred**: founder was unavailable during the 2026-05-22 execute (at gym per session note); the run completed autonomously without shadow. Founder can review the full evidence pack at `local/workspaces/cocoder-dogfood/solve-evidence/` (prompts, results, ported test snapshot) post-hoc. Shadow attach will land on the Refine repeat against `dispatch.test.mjs`.

### Milestone E4 — Validate the deliverable

- [x] **E4.1** Talia produced `packages/core/tests/core.test.mjs` (446 lines, 18,195 bytes) with paths translated from `cobuilder-build/orchestration/` to `packages/core/`. Test names + assertions preserved verbatim; assertion *messages* updated to match current CoCoder behavior; baseline tests wrap themselves in temporary git fixtures so they pass in this non-git workspace.
- [x] **E4.2** `pnpm -F core test core.test` exits 0 with **75 tests passing, 0 failing** (engine warning under local Node 25.1.0 expected per ADR-0004).
- [x] **E4.3** No mutation outside `packages/core/tests/` per Talia's self-attested `filesChanged` (only `core.test.mjs` + her own gitignored run-dir result artifacts). Bob's independent audit (source-vs-target `diff -u`, stale-reference `rg`) confirmed. `git status` evidence unavailable (the workspace is not a git worktree on this mount).
- [ ] **E4.4** Audit log entry at `local/audit/oz-actions.jsonl` — **deferred to Sub-Playbook C**. Per `ARCHITECTURE.md` "Oz daemon security model" §6, that audit file is written by the Oz daemon, which lands in Sub-Playbook C. The CLI does not write it directly in v0.1. Sub-Playbook C must backfill historical entries on first Oz launch or accept that pre-C runs are unindexed.
- [x] **E4.5** Run dir contains all required artifacts: `startup-packet.json`, `route.snapshot.json`, `profile.snapshot.json`, `launch.json`, both `jobs/<lane>/prompt.md`, both `jobs/<lane>/result.json` + `result.md`, helper scripts, watcher scripts, `events.jsonl`, `status.json` (terminal: `complete`). Pane log evidence captured via `tmux capture-pane` during the run.

### Milestone E5 — Session log + learnings

- [x] **E5.1** SESSION_LOG entry at top of `cocoder/SESSION_LOG.md` ("Sub-Playbook E E3.3 PASS — CoCoder built CoCoder end-to-end").
- [ ] **E5.2** Memory file updates (`cocoder/memory/codebase-map.md`, `cocoder/memory/tech-stack.md`) — **deferred to next session**; the validated orchestration loop is a learning worth capturing but doesn't block Refine. Will land alongside the Refine session log entry.
- [x] **E5.3** Sub-Playbook A E2.2e.1 closed with proof = `packages/core/tests/core.test.mjs` (this run's deliverable) + `pnpm -F core test core.test` PASS evidence.
- [x] **E5.4** Decision Log entry below documents which CoBuilder artifacts ported wholesale vs needed adjustment, for Sub-Playbook B intake.

**Checkpoint:** [x] Sub-Playbook A E2.2e.1 closed; first orchestrated dogfood task PASSED. E4.4 + E5.2 deferred to Sub-Playbook C and follow-up session respectively, neither blocks Refine.

---

## Refine

- [x] Repeat E3 invocation against `dispatch.test.mjs` (audit §4 E2.2e.2). Run `run-20260522T135126Z-t4rnd35z` completed PASS in ~7 minutes with no manual intervention; Bob and Talia both wrote PASS. Talia ported 12,219 bytes; 11/11 source test names preserved; `pnpm -F core test dispatch` exits 0 (86/86 tests pass post-port).
- [x] `local/workspaces/cocoder-dogfood/runs/` has two distinct execute run dirs with non-overlapping result artifacts: `run-20260522T133403Z-rwrkcfcg` (core.test.mjs) and `run-20260522T135126Z-t4rnd35z` (dispatch.test.mjs). (A third dir `run-20260522T135114Z-2a946tah` is the Refine dry-render that preceded the execute; it has no result.json files.)
- [ ] Audit log entries — **deferred to Sub-Playbook C** per `ARCHITECTURE.md` "Oz daemon security model" §6. The Oz daemon owns `local/audit/oz-actions.jsonl`; Sub-Playbook C must backfill historical entries when it lands.
- [x] No mutation outside `packages/core/tests/` across both runs. Verified via Talia's self-attested `filesChanged` (each run lists only the target test file + her own gitignored run-dir artifacts) plus Bob's independent audit (source-vs-target diff, stale-reference rg, test-name parity script — Bob found "only `packages/core/tests/dispatch.test.mjs` appeared as newer non-generated source surface" in the mtime boundary check).

**Checkpoint:** [x] Orchestration loop reproducible. Two distinct ports, two PASS results, no out-of-zone writes. Dogfood validated 2026-05-22.

---

## Final Check

- [x] Sub-Playbook A E2.2e.1 and E2.2e.2 closed (proof = run-`rwrkcfcg` for E2.2e.1 / run-`t4rnd35z` for E2.2e.2)
- [x] No `packages/` mutation outside `packages/core/tests/` across both runs (Talia self-attest + Bob audit + mtime boundary check)
- [x] No install-zone (`<install>/local/`) mutation outside `local/workspaces/cocoder-dogfood/` and the gitignored `local/audit/` (which Sub-Playbook C will own)
- [x] `cocoder/personas/PORT-NOTES.md` documents every CoBuilder→CoCoder divergence + the 5 core bugs surfaced by the dogfood ramp + v0.2 follow-ups for Sub-Playbook B
- [ ] Sub-Playbook B Witness section updated with reuse-check entry: "Sub-Playbook E borrowed Bob, Talia, and shared fragments; B re-ports the remaining personas (oscar, ian, phil, quinn, verifier) and full workspace template" — **deferred to Sub-Playbook B start** (its Witness is the natural place to record the inheritance)
- [x] PRIORITIES.md and Master README updated to reflect Sub-Playbook E E3.3 PASSED + Refine PASSED

---

## Decision Log

| Date | Decision | Rationale | Alternatives |
|---|---|---|---|
| 2026-05-22 | Open Sub-Playbook E (Dogfood Ramp) between Sub-Playbook A close and Sub-Playbook B start | The product feature that matters is orchestration; dogfooding only the structure is insufficient proof for v0.1; pulling 3 persona artifacts forward is a small scope cheat with high leverage | Wait for full Sub-Playbook B (rejected — months of latency before first dogfood proof); skip dogfood orchestration in v0.1 (rejected — undermines the v0.1 thesis) |
| 2026-05-22 | First task is Talia + audit §4 E2.2e.1 (`core.test.mjs`) | Smallest blast radius; deliverable is regression coverage that protects future dogfood orchestration; self-leveraging | Bob first on a small refactor (rejected — larger blast radius, no protective deliverable) |
| 2026-05-22 | Sub-Playbook E Solve close: reconcile plan-vs-reality in-place; fix four core bugs surfaced by the dogfood ramp | The plan was authored before the CLI shape was concretely known. Sub-Playbook E was designed to surface exactly these integration gaps. Founder go-signal to fix all four bugs in this session (with regression tests under `packages/core/tests/composition-dogfood-bugfixes.test.mjs`) and update the plan in-place rather than parking the dogfood ramp on a documentation issue. See `cocoder/personas/PORT-NOTES.md` §"Source-of-truth conflicts" and §"Plan-vs-reality reconciliation". | Park Sub-Playbook E at the doc mismatch (rejected — kills dogfood momentum); route the bug fixes through a new Sub-Playbook A free-win milestone (rejected — adds latency without value, since fixes are tiny and Sub-Playbook E is the artifact that justifies them) |
| 2026-05-22 | Bob = lead/orchestrator (`startupMode: lead`, `canWrite: false`); Talia = writer (`startupMode: wait-for-lead-dispatch`, `canWrite: true`, `writeBoundary: packages/core/tests/`) | Matches CoBuilder's mature lead/dispatch pattern and respects ADR-0002 (Talia is the test-layer writer). Bob orchestrates and audits; Talia writes. Proved robust under failure: Bob blocked correctly when dispatch IPC failed, Talia stayed idle, no out-of-zone mutation. | Single-pane Talia (rejected — doesn't exercise multi-lane orchestration, which IS the v0.1 thesis); Bob as writer with Talia as audit-only (rejected — inverts ADR-0002 + concentrates blast radius) |
| 2026-05-22 | Bug E fix: gate codex sandbox on lane role rather than move dispatch outside the codex sandbox | Cheapest fix that unblocks dogfood today; v0.2 follow-up captured in PORT-NOTES.md for the architectural redesign (file-based or watcher-driven dispatch). Founder explicitly chose this path over "park dogfood and redesign dispatch" or "bypass via manual tmux send-keys" | Move dispatch entirely outside codex sandbox (rejected for v0.1 — requires architectural change before any dogfood run can complete); bypass for this run only via manual override (rejected — doesn't fix the product, just hides the bug) |
| 2026-05-22 | First orchestrated dogfood run PASSED — Talia ported `core.test.mjs`, Bob accepted with independent audit | Sub-Playbook E thesis proven: CoCoder orchestrates work on itself. Founder gym-test passed: the run completed autonomously without supervision; full evidence pack preserved for review. | n/a — this is the outcome, not a decision |
| 2026-05-22 | Sub-Playbook B intake guidance — port observations for full persona library: Bob/Talia ported with minimal scrub (only `allowedRoutes` + `ORCHESTRATION-REBUILD` → `v0.1-foundation`); `talia.json.writePolicy` needed flip from `read-only` to `task-scoped` for the dogfood writer scenario; verification-artifact guard already canonical inline per Q5=A; CoBuilder `shared/write-boundaries.md` needs the guard-line scrub note pattern applied to every fragment Sub-Playbook B borrows; the priority-boundary file format (`writerLanes` + `allowed`/`excluded`) is the right shape and worth standardizing in `templates/workspace-cocoder/` | Operational intake for Sub-Playbook B Witness section | n/a |

---

## Learnings

*To be populated during Expand and Refine. Expected categories:*

- Which CoBuilder persona fragments need re-authoring for CoCoder vs which can ship verbatim
- Where `compose-launch` defaults assume CoBuilder workspace layout — surfaces feedback into Sub-Playbook A M4 if more fixes needed
- What `cocoder/standards/` content actually needs to exist for v0.1 (informs Sub-Playbook B scope)
- Founder experience watching Talia work autonomously — first real "is this product good?" data point

---

## Resume Instructions

1. Read [`../README.md`](../README.md) Pending Decisions section. If Q1, Q2, or Q4 are still Open, **STOP**. Ask the founder. Do not start this Sub-Playbook until the recommended defaults (or alternates) are recorded in [`../pending-decisions.md`](../pending-decisions.md).
2. Read [`./2026-05-22-foundation-audit.md`](./2026-05-22-foundation-audit.md) §§1, 4 — the safety belts in M4.22–M4.24 depend on understanding the audit's findings.
3. Read [`./2026-05-21-foundation.plan.md`](./2026-05-21-foundation.plan.md) Milestone M4. If M4.1, M4.2, M4.3, M4.4, M4.15 (free-wins) are not done, **do them first**. If M4.22, M4.23, M4.24 (founder-gated) are not done and Q1/Q2/Q4 are Answered, do those next. Sub-Playbook E cannot start until M4 Checkpoint is reached.
4. Read ADRs 0001–0005 in [`../../decisions/`](../../decisions/).
5. Read [`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md) — focus on Multi-workspace concurrency, Oz daemon security model, and Oz improvement routing sections.
6. Read CoBuilder source: `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/personas/bob.json`, `talia.json`, `prompts/personas/bob.md`, `talia.md`, `manifest.json`.
7. Execute Solve task E-S1 first. If composition dry-run fails, iterate borrowing/scrubbing until it succeeds — that is the gating proof, not Expand task volume.
8. Execute Expand milestones E1 → E2 → E3 → E4 → E5 in order. Do not skip ahead.
9. Refine repeats E3 for a second test file. Do not declare done after one run.
10. Final Check: update Sub-Playbook A E2.2e.1 + E2.2e.2 checkboxes; update Sub-Playbook B Witness; update PRIORITIES.md; update Master README; SESSION_LOG entry.

---

## Progress

**Last worked:** 2026-05-22 (E3.3 PASSED; Talia ported `core.test.mjs`; Bob audited + accepted; 75/75 tests green; 5 core bugs fixed end-to-end)
**Current Canon:** Refine — orchestration loop proven; reproduce against a second test file
**Next action:** Founder review of the 5 product-code edits + dogfood config files, then authorize Refine repeat against `dispatch.test.mjs` (audit §4 E2.2e.2). Update PRIORITIES.md "Active task" hint to the new target file before launch, then `pnpm exec cocoder launch ... --execute true` as in E3.3.

| Canon | Items | Done | Status |
|---|---|---|---|
| Witness | 1 audit findings table + 1 objective + 1 scope statement | 3 | Complete |
| Interrogate | 7 risks + 11 decisions + reuse check | 7 + 11 + 1 | Complete |
| Solve | 2 | 2 | **Complete 2026-05-22** (compose-launch + launch dry-render both green; 4 core bugs fixed; 7/7 E-S2 rg checks green by E3.1) |
| Expand | E1: 7 · E2: 4 · E3: 4 · E4: 5 · E5: 4 | 22 of 24 (E1.1–E1.7 ✓; E2.1–E2.4 ✓; E3.1, E3.2, E3.3 ✓; E3.4 deferred to Refine for founder shadow; E4.1, E4.2, E4.3, E4.5 ✓; E4.4 deferred to Sub-Playbook C; E5.1, E5.3, E5.4 ✓; E5.2 deferred to follow-up) | **Complete 2026-05-22** (first orchestrated dogfood task PASSED; Bug E surfaced + fixed in flight; 5 core bugs total) |
| Refine | 4 | 3 (repeat run ✓; two distinct run dirs ✓; no out-of-zone mutation ✓; audit log deferred to C) | **Complete 2026-05-22** (`dispatch.test.mjs` ported autonomously in ~7 min, 86/86 tests post-port, Bob+Talia both PASS, no out-of-zone writes) |
| Final Check | 6 | 5 (Sub-Playbook A E2.2e.1+E2.2e.2 ✓; no out-of-zone mutation ✓; PORT-NOTES ✓; state mirrors ✓; Sub-Playbook B Witness update deferred to B start) | Effectively complete; only deferred items remain (Sub-Playbook B Witness backref) |
| **Total** | **52** | **35** | E3.3 PASSED + Refine PASSED; only deferred items (Sub-Playbook C audit log, Sub-Playbook B Witness backref, follow-up memory updates) remain |

---

## Success Criteria

- [x] `cocoder compose-launch --profile cocoder/profiles/cocoder-dogfood.profile.json --route cocoder/routes/dogfood-port-tests.json --priority-slug v0.1-foundation --workspace-root "/Volumes/NAS LOCAL/CoCoder" --workspace-slug cocoder-dogfood` returns `ok: true, status: ready, issues: []` *(closed 2026-05-22 at E-S1)*. The plan originally listed slug-style `--profile` / `--route` args, no `--priority-slug`, and `--dry-run` — all reconciled to CLI reality.
- [x] Talia tmux pane runs to completion autonomously *(run `run-20260522T133403Z-rwrkcfcg`; Talia wrote `status: PASS` and her own result artifacts; Bob accepted with independent audit)*
- [x] `pnpm -F core test core.test` green *(75 tests, 0 failures, post-port)*
- [x] Refine repeat invocation green *(run `run-20260522T135126Z-t4rnd35z`: Talia ported `dispatch.test.mjs`, Bob accepted with independent audit, `pnpm -F core test dispatch` = 86/86 pass post-port)*
- [x] No mutation outside `packages/core/tests/` and gitignored `local/` *(per Talia's `filesChanged` + Bob's independent audit)*
- [ ] Audit log entries recorded — **deferred to Sub-Playbook C** (Oz daemon owns `local/audit/oz-actions.jsonl` per ARCHITECTURE.md)
- [x] Sub-Playbook A E2.2e.1 closed *(2026-05-22)*; E2.2e.2 pending Refine repeat
- [ ] Founder reports "I watched CoCoder build itself" — **founder was at gym during execute**; the qualitative checkpoint shifts to "founder reviews the evidence pack and gives go for Refine"
