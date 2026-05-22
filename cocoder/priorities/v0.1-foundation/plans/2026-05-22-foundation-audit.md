# 2026-05-22 Foundation Audit — Sub-Playbook A (pre-Refine)

**Created:** 2026-05-22 | **Type:** Audit (reference file; not a Playbook)
**Status:** Findings recorded; remediation tracked as **Milestone M4** in [`2026-05-21-foundation.plan.md`](./2026-05-21-foundation.plan.md)
**Founder gates:** Q1–Q7 in [`../pending-decisions.md`](../pending-decisions.md)
**Parent priority:** [`../README.md`](../README.md)

> This file is the canonical evidence record for the pre-Refine audit of Sub-Playbook A. Findings are remediation-tracked in the foundation Playbook's Milestone M4. Founder questions block specific M4 tasks per the `gates: Q#` markers in that plan. Do not edit findings retroactively; if a finding turns out to be wrong, add a "**Correction:**" note inline with the date.

## How to use this document

1. Read §1–§6 below for the synthesized findings ordered by severity. Each finding has a stable ID (`B1`, `H3`, `M7`, `Q2`, etc.) that the foundation Playbook's M4 milestone references back to.
2. Open the foundation Playbook (`2026-05-21-foundation.plan.md`) and work the M4 task rows in order. Each task cites the matching audit ID.
3. If you need to know **why** something is a blocker, jump to the relevant section here.
4. If you need the **raw subagent output** that backs a finding, see Appendices A–D at the bottom.

## Resolution status (updated 2026-05-22 evening)

> This audit is the canonical evidence record (frozen at the 2026-05-22 audit pass). For current per-finding resolution status, see `cocoder/priorities/v0.1-foundation/plans/2026-05-21-foundation.plan.md` Milestone M4 task rows and `cocoder/SESSION_LOG.md` entries. Summary of major closures since the audit ran:
>
> - **B1, B3, B4 partial, B7, B8, B9** — closed by M4 free-wins (M4.1–M4.4, M4.15) and M4.22–M4.27 founder-gated tasks; see SESSION_LOG 2026-05-22 (Evening) + (Night).
> - **B4 (test ports)** — 4 of 12 audit §4 port-first files closed (E2.2e.1 `core.test.mjs`, E2.2e.2 `dispatch.test.mjs`, E2.2e.3 `adapters.test.mjs`, E2.2e.4 `composition.test.mjs`); 8 remaining. Closed via the Sub-Playbook E orchestration loop.
> - **B5, B6, H3, H4, H5, H6, H7** — closed by M4.22–M4.27 founder-gated tasks (`--developer-mode` belt, `findCocoderHome` fail-closed, workspace detection + ADR-0006 refusal path, ephemeral runs to `local/workspaces/<slug>/runs/`, verification-artifact guard SSOT inline, friendly cwd error).
> - **H9, M3, M10** — partially closed (CLI rename + path-fix work landed; some medium items remain).
> - **Sub-Playbook E dogfood ramp** surfaced **5 additional core bugs** not in this audit (modelRoles null-vs-undefined, iso-datetime typecheck, PRIVATE_LEGACY false positives, parseArgs path-resolves slug, codex sandbox vs lane role); all fixed in flight with regression coverage at `packages/core/tests/composition-dogfood-bugfixes.test.mjs`. See PORT-NOTES.md §"Source-of-truth conflicts".
> - **Q1–Q7 founder decisions** all answered 2026-05-22 (Late Evening); ADR-0006 graduated from Q4. See README.md Pending Decisions.

## Audit context / caveats

- **Sub-Playbook A status when audit ran:** Expand active, 23/31 tasks marked done; E2.2e (test port) explicitly open.
- **Node version on audit machine:** Node v25.1.0; project policy is Node 20 LTS (ADR-0004). Engine warnings expected; not graded.
- **Sub-Playbook B (workspace template + personas) not started.** Findings scoped to A only; B-blocked items called out.
- **Sub-Playbook C (Oz daemon/dashboard) not started.** ADR-0005 enforcement gaps largely route to C; founder question Q1 disambiguates A vs C scope.
- **Upstream CoBuilder test suite not yet ported.** Comparison is filesystem-only.
- **CoBuilder `debug-runs/`, `runs/`, `consult-runs/` artifacts correctly NOT imported.** Confirmed clean.
- **CoBuilder `orchestration/` tree appears not git-tracked** on this mount → upstream churn detection via `git log` was unreliable; filesystem snapshot used as SSOT.
- **`/Volumes/NAS LOCAL/CoCoder` reported no `.git`** on the audit machine → `git status --ignored` and schema-drift verification could not run via git. Findings are based on on-disk state + `.github/workflows/ci.yml` declared gates.

---

## 1 — Critical blockers (Sub-Playbook A cannot close until resolved)

### B1. Hardcoded legacy CLI path `cocoder/core/cli.mjs` ships in shipped core
The directory does **not exist**; the real CLI lives at `packages/core/cli.mjs` and the TS wrapper resolves it correctly (`packages/cocoder-cli/src/cli.ts:8`). Hits in shipped runtime code:

- `packages/core/lib/launch.mjs:1051, 1276, 1379`
- `packages/core/lib/debugger.mjs:254, 715`
- `packages/core/lib/orchestrator-commit.mjs:18` (`DEFAULT_IMPLEMENTATION_SURFACES` entry `'cocoder/core/'`)

**Why it matters:** Completion watchers, send-message helpers, debugger follow-collector, and dirty-state audits all fail at runtime; orchestration-surface tracking misses `packages/core/`.
**Fix:** Resolve CLI via `import.meta.url` / `${COCODER_HOME}/packages/core/cli.mjs`; add a regression test that the generated scripts contain a path that exists.

### B2. `packages/core/baselines/` missing — `check-immutable-baseline` broken
`cli.mjs:57` defaults to `packages/core/baselines/accepted-reference-baseline.md`; folder is empty.
**Fix:** Port baseline per extraction manifest, or guard/remove the command until E2.2e.

### B3. CoBuilder branding still ships in `packages/core/` (E2.4 checkbox is false)
E2.4 is marked `[x]` (`foundation.plan.md:164`) but the rename pass is incomplete. Sample hits:

- Tmux namespace: `launch.mjs:18` `DEFAULT_SOCKET = 'cobuilder-orchestration'`; `debugger.mjs:301-302` `-L 'cobuilder-orchestration'`
- Prompt headers: `launch.mjs:742, 910, 966, 1408` ("CoBuilder Orchestration Launch", `cobuilder-orch-message-` mkdtemp); `debugger.mjs:579, 604` ("CoBuilder Orchestrator Debugger")
- Commit trailers: `orchestrator-commit.mjs:487, 497` `@cobuilder.local`
- Contract schema description: `packages/core/contracts/persona.schema.json:5` "CoBuilder build persona"
- Quinn defaults: `quinn/run-case.mjs:29` `DEFAULT_IDE_DIR = 'cobuilder-ide'`; `quinn/driver.mjs:15` `cobuilder-dev-console-env`; `quinn/cases/staging-login-smoke.mjs:132` `api-staging.cobuilder.me`
- Git probe: `debugger.mjs:271` `cobuilder-debugger-git-probe-`

**Why it matters:** Violates ARCHITECTURE.md per-workspace tmux namespace (ADR-0001); public release ships private CoBuilder identifiers; preflights probe nonexistent CoBuilder `.command` launchers.
**Fix:** Complete rename pass; add CI gate `rg 'cobuilder' packages/ --glob '!**/*.example.*'` → must be 0; un-check E2.4 until clean.

### B4. Test suite is ~2% of upstream coverage — false-confidence risk
CoCoder: 2 files / 6 tests under `packages/core/tests/`. CoBuilder: 25 files / ~291 tests. `orchestration-improvements.test.mjs` only greps source text; it does not exercise launch behavior.
E2.2e is correctly the next action but the foundation plan also lists Solve fixtures S1.3–S1.6 as `[x]` despite no `tests/fixtures/` tree existing — only inline tests in `config-resolver.test.mjs`.
**Fix:** Port the 12-test port-first list in §4 below before claiming A complete; replace the source-grep test with runtime fixtures.

### B5. `orchestrator-commit` DEFAULT_IMPLEMENTATION_SURFACES allows product paths
`packages/core/lib/orchestrator-commit.mjs:17-28` includes `packages/`, `docs/`, `templates/`, `.github/workflows/`, root `package.json`. Combined with cwd-based `repoRoot` defaults, any orchestration lane launched with cwd = CoCoder install can git-commit into install-public zones with no `cocoder-product` gate.
**Fix:** Gate these surfaces behind developer-mode + dogfood-workspace detection; default adopters to workspace `cocoder/` only.
**Founder gate:** Depends on Q1 (ADR-0005 enforcement scope: A or C?).

### B6. CLI defaults anchored to `process.cwd()`; `findCocoderHome` falls back silently
- `handleConfig` (`cli.mjs:884-898`) sets `cocoderHome = args.cocoderHome || process.cwd()` and never calls `findCocoderHome()`.
- `repoPath()` (`fs-utils.mjs:8-9`) = `process.cwd()`; used throughout `cli.mjs:58, 60-64, 234-237, 453-454, 692-776` for `local/runs`, `cocoder/profiles`, `cocoder/routes`, `cocoder/PRIORITIES.md`, `cocoder/improvements`, `cocoder/runs/.../evidence/report.json`.
- `findCocoderHome()` (`paths.mjs:11-20`) falls back to `path.resolve(startDir)` with no error.

**Effect matrix:**

| cwd | Effect |
|---|---|
| User app repo | `config set` writes wrong path `<app>/local/config.yaml` (should be `<app>/cocoder/local/`) |
| CoCoder install | Run/check artifacts pollute tracked dogfood `cocoder/runs/`; orchestrator-commit can touch `packages/` |
| Nested dir inside CoCoder | Treated as install root; silent zone confusion |

**Fix:** Split `resolveInstallRoot()` vs `resolveWorkspaceRoot()`, fail closed on ambiguity, add `--workspace-root` to `config set` (already on `config get`), and add a "running from CoCoder install" warning when launching against a non-dogfood workspace.
**Founder gates:** Depends on Q2 (`config set` zone defaults) and Q4 (workspaces-inside-install policy).

### B7. Root `.gitignore` missing ARCHITECTURE-mandated secret patterns
ARCHITECTURE.md ignore matrix L75-76 requires `*.env`, `.env.*`, `secrets/` at both levels. Root `.gitignore` has none of these. `cocoder/local/.gitignore` is correct.
**Fix:** Add `*.env`, `.env.*`, `secrets/` to root `.gitignore`; same lines belong in `templates/workspace-cocoder/cocoder/.gitignore` when Sub-Playbook B lands.

### B8. `dist/` blanket ignore conflicts with schema-drift CI gate
Root rule ignores all `dist/`; CI gate (`ci.yml:20-21`) expects committed `packages/schemas/dist/*.schema.json`. Foundation plan E2.7 enforces this. Without a negation rule (`!packages/schemas/dist/*.schema.json`) or per-package scoping, real `git add` would skip the artifacts.
**Fix:** Narrow root `.gitignore` to ignore `packages/schemas/dist/js/` only, or replace `dist/` with `packages/*/dist/` + `!packages/schemas/dist/*.schema.json`.

### B9. Nested Codex review guardrail not in shipped core
Of the five recent improvements: stdin dispatch, lane identity validation, current-action persona audit — all **present**. **Nested Codex guardrail is MISSING from shipped `packages/`**; it lives in CoBuilder `personas/prompts/personas/oscar.md:87` (a prompt fragment). Verification-artifact write guard is **present but diverged** — CoCoder inlined the string in `launch.mjs:993`, CoBuilder uses a composable prompt fragment; CoCoder's only test is a source-grep.
**Fix:** Decide single source (inline in core vs prompt fragment ported in Sub-Playbook B); document the choice in extraction manifest; add a runtime test that the guard fires.
**Founder gate:** Depends on Q5 (verification-artifact write-guard SSOT).

---

## 2 — High-risk correctness gaps

### H1. `resolveSecretReferences()` exists but is never called
`config.mjs:87-111` defines the resolver; `resolveConfig()` (L23-44) never invokes it. Loaded config keeps literal `${env:OPENAI_API_KEY}` strings. Documented in `docs/configuration.md:39-50` as a working feature.
**Fix:** Invoke after merge; add opt-out for `config get` display mode.

### H2. `validateConfig` silently skips when schema artifact missing
`config.mjs:134-136` returns `{ ok: true, skipped: true }` if `packages/schemas/dist/config.schema.json` is absent. Pre-build state passes validation it should fail.
**Fix:** Fail hard outside explicit test mode.

### H3. `config set` has no workspace-local write path
`config.mjs` only exposes `setInstallConfigValue`. `configFileOrder` reads workspace overrides (`config.mjs:156-164`) but no writer exists for `<workspace>/cocoder/local/config.yaml`.
**Fix:** Add `setWorkspaceConfigValue(key, value, { workspaceRoot })` and mirror `--workspace-root` flag on `config set`.
**Founder gate:** Depends on Q2.

### H4. ADR-0005 routing is schema-only — no runtime enforcement, no detection logic
- `packages/schemas/src/oz/improvement-target.ts` + dist artifact exist.
- No `cocoderHome` / `developerMode` / dogfood-workspace detector in `packages/core` (grep clean).
- `packages/core/contracts/self-healing.schema.json` uses legacy `permanentHomeRecommendation` free-text field, no bridge to the routing taxonomy.
- No write gate, no CI gate, no tests.

**Founder gate:** Q1 disambiguates A vs C scope.

### H5. Default report/run paths write to tracked `cocoder/runs/` and `cocoder/debug-runs/`
`cli.mjs:692-776` and `lib/debugger.mjs` write under `repoPath('cocoder/...')`. Root `.gitignore` only ignores `/local/`, not `cocoder/runs/` or `cocoder/debug-runs/`. When cwd = CoCoder dogfood, these pollute the tracked tree.
**Fix:** Move ephemeral artifacts to `local/workspaces/<slug>/runs/` (matches ARCHITECTURE L132-136) or to `cocoder/local/runs/`; the latter requires `cocoder/local/.gitignore` to allow the subdir.
**Founder gate:** Q3 (runs gitignore policy).

### H6. `DEFAULT_RUNS_DIR` is flat, not per-workspace
`cli.mjs:58` = `local/runs`. ARCHITECTURE L132-136 specifies `local/workspaces/[slug]/`.
**Fix:** Resolve from registry entry, not a flat constant.

### H7. Workspace detection / registry integration not wired in CLI
`paths.mjs` + `workspaces-registry.ts` schema are present. No CLI handler loads `local/workspaces.json`. No `--workspace=<slug>` flag on launch/checks. `findCocoderHome` walks ancestors for `cocoder/AGENTS.md` + `ARCHITECTURE.md` — any directory inside the CoCoder clone resolves home to the install, masking nested workspaces.
**Fix:** Implement `resolveActiveWorkspaceRoot()` reading the registry; document "no workspaces inside the install repo" as a constraint or support nesting explicitly.
**Founder gate:** Q4.

### H8. Debugger references deferred CoBuilder `.command` launchers
`debugger.mjs:256-258` shells out to `cocoder/Launch-Orchestrator.command`, `cocoder/ORCH DEBUGGER.command`, `cocoder/Stop-Orchestrator-Run.command`; prompt text at L590, L619 also references them. Extraction manifest says these wrappers are dropped.
**Fix:** Replace with `cocoder` CLI invocations or gate launcher syntax checks behind workspace-template presence.

### H9. Generated bash wrappers — partial argv safety
- `launch.mjs:1156-1157` `exec ${session.command} "$BOOTSTRAP"` — `session.command` not `shellQuote`d. Low risk today (only `codex`/`claude`), brittle if adapter declarations drift.
- `launch.mjs:1394` `node ${shellQuote(cliPath)} send-message ... --message "$*"` — `$*` splits on whitespace; quoted founder messages break dispatch.
- `debugger.mjs:296-297` `bash -lc "command -v ${shellWord(command)}"` — `shellWord` rejects unsafe chars but still uses `bash -lc`; violates Oz invariant #7 in spirit.

**Fix:** Quote `session.command`; replace `$*` with `"$@"`; switch `commandProbe` to `execFile('command', ['-v', cmd])`.

### H10. Master Playbook self-contradicts on current state
`cocoder/priorities/v0.1-foundation/README.md:65` Witness row still claims "no packages/, no CLI"; same doc Progress section L270-278 shows Sub-Playbook A active with 23/31 done. Reuse claims at L129-130 marked `[x]` for ORCH-DEBUGGER reuse despite Sub-Playbook C not started.
**Fix:** Update Witness row + reuse claims to current reality; refresh checkboxes against filesystem.

### H11. PRIORITIES.md SSOT drift
`cocoder/PRIORITIES.md:17` says Canon=`Solve`; Master README L271 says `Expand`.
**Fix:** PRIORITIES.md is the mirror per `cocoder/AGENTS.md` SSOT rule; update.

### H12. Quinn credentials path mismatched with its own comment + ungitignored
`quinn/credentials.mjs:22-24` `DEFAULT_CREDENTIALS_PATH = 'cocoder/orchestration/.quinn-credentials.json'` but the comment says `cocoder/.quinn-credentials.json`. No `.gitignore` entry anywhere.
**Fix:** Pick one canonical path; add ignore rule.

### H13. `composition.mjs` uses `repoPath('decisions')` not `cocoder/decisions`
`packages/core/lib/composition.mjs:13`. CoCoder dogfood ADRs live in `cocoder/decisions/`. Likely also affects other tools that read decisions.
**Fix:** Update default to `cocoder/decisions`.

### H14. Template `$schema` reference path wrong
`templates/install-local/config.example.yaml:1` uses `../packages/schemas/dist/install-config.schema.json`; from `templates/install-local/`, `../` is `templates/`, not repo root.
**Fix:** `../../packages/schemas/dist/install-config.schema.json`.

### H15. Git capability probe writes inside `.git`
`launch.mjs:910-913` `mkdtemp` under `gitDir`. Low product risk; pollutes git metadata.
**Fix:** Write under run evidence dir.

---

## 3 — Medium issues / cleanup

| ID | Issue | File:line | Fix |
|---|---|---|---|
| M1 | E3.5 marked `[x]` but no `templates/install-local/secrets/.gitignore` shipped | `foundation.plan.md:182` | Add file or un-check |
| M2 | Acceptance harness hardcodes CoBuilder priority slug | `acceptance.mjs:73` `'ORCHESTRATION-REBUILD'` | Parameterize |
| M3 | Architecture target sections describe unshipped dirs without `(Target)` label | `ARCHITECTURE.md:112-118` | Tag target vs current |
| M4 | Memory file staleness: extraction manifest listed as "next action" but done | `cocoder/memory/codebase-map.md:52` | Refresh |
| M5 | `packages/schemas/src/oz/README.md` says "empty placeholder" but `improvement-target.ts` exists | — | Update README |
| M6 | ADR-0005 absent from Master "Key files" Interrogate list | `priorities/v0.1-foundation/README.md:21` | Add row |
| M7 | `install-config.ts` is a re-export alias of `cocoderConfigSchema` | `packages/schemas/src/install-config.ts:4` | OK for v0.1; split if intentional |
| M8 | `configFileOrder` includes tracked `cocoder/config.yaml` (not in ARCHITECTURE layout) | `config.mjs:156-159` | Drop or document |
| M9 | `auditWriteBoundary` is path-string matching, not zone-aware | `dispatch.mjs:126-139` | Wire to ADR-0005 taxonomy when C lands |
| M10 | `/Volumes/NAS LOCAL` in tracked example files (by design) | `docs/configuration.md:58`, `templates/install-local/roots.example.yaml:4` | Acceptable; CI gate must scope to `*.example.*` |
| M11 | Cross-doc mismatch on P-S1/P-S2 checkboxes | Master README L149-150 `[x]` vs `foundation.plan.md:280` `[ ]` | Reconcile |
| M12 | No stale-reference CI gate yet (planned for Sub-Playbook D) | `priorities/v0.1-foundation/README.md:212-219` | Add minimal `rg` gate now |

---

## 4 — Test gaps (port-first list)

### Replace immediately
- Replace the source-grep `orchestration-improvements.test.mjs` with a real launch-behavior fixture (dry-run + execute-with-mock-transport pattern from CoBuilder `launch.test.mjs:108-109`).

### Port from CoBuilder `infrastructure/cobuilder-build/orchestration/tests/` (order = priority)

| # | Source file | Why port now |
|---|---|---|
| 1 | `core.test.mjs` | Contracts, persona load, ledger primitives, priority extractor |
| 2 | `dispatch.test.mjs` | Locks, write-boundary audit, verifier packets, teammate classify |
| 3 | `adapters.test.mjs` | Adapter preflight / semantic validation |
| 4 | `composition.test.mjs` | Route/profile compatibility, dry-run, stale-priority guard |
| 5 | `launch.test.mjs` (52 tests) | Dry-run, add-lanes, send-message/stdin, stop-run, finalizer, tmux quotes |
| 6 | `orchestrator-commit.test.mjs` | Route-owned commits, `filesChanged` guards, verification-artifact guard |
| 7 | `debugger.test.mjs` | prepare-debugger, evidence follow, pane/root checks |
| 8 | `flows.test.mjs` | Phase transitions, write-boundary violations, closeout gates |
| 9 | `lead-rescue.test.mjs` + `fixtures/lead-rescue/valid-supersession-record.json` | Supersession, finalize-with-dirty |
| 10 | `session-wrap.test.mjs` | Wrap audit, handoff consistency |
| 11 | `repo-state.test.mjs` | add-lanes repo audit |
| 12 | `launch-command.test.mjs` | Wrapper validity (after path generalization) |

### Add new tests CoCoder needs (no CoBuilder equivalent)

- CLI defaults / `COCODER_ORCH_*` env precedence
- Workspace detection precedence (cwd → registry → `--workspace=` → ambiguous-fail)
- Workspaces registry read/write round-trip with token resolution
- Oz improvement zone classification + `cocoder-product` gate (developer-mode + dogfood detection)
- Stale-reference scanner (`cobuilder-build`, `COB_ORCH_`, raw `cobuilder` outside `*.example.*`, `/Volumes/` outside `*.example.*`) — wire to CI
- Generated launch script verification: every `cliPath` literal resolves to an existing file; argv-safe `send-message`; `session.command` quoted

### Do **not** port from CoBuilder
- `personas.test.mjs`, `personas-oscar.test.mjs` (CoBuilder-specific prompts)
- `check-priorities-last-updated`, `check-session-log-hygiene`, `check-persona-source-boundaries`, `check-write-authority`, `check-doc-*`, `check-adr-status-consistency`, `standards-raci.test.mjs` (CoBuilder doc/priority hygiene — rebuild for CoCoder in Sub-Playbook D)
- `acceptance.test.mjs` (CoBuilder operator harness)

### Useful but defer to v0.2
- `quinn-driver.test.mjs` (34 tests)
- `codex-idle-watchdog.test.ts`
- `self-healing.test.mjs`

---

## 5 — Questions for founder

All seven are tracked in [`../pending-decisions.md`](../pending-decisions.md) with recommended defaults. Listed here for reference:

| ID | Question | Blocks |
|---|---|---|
| **Q1** | ADR-0005 enforcement scope — Sub-Playbook A or strictly C? | B5, H4 |
| **Q2** | `config set` zone defaults — install-local always, or workspace-local when cwd is a workspace? | B6, H3 |
| **Q3** | `cocoder/runs/` and `cocoder/debug-runs/` gitignore policy — move to `local/workspaces/<slug>/` or `cocoder/local/runs/`? | H5 |
| **Q4** | Workspaces inside the install repo — supported or constraint? | B6, H7 |
| **Q5** | Verification-artifact write guard SSOT — inline string or prompt fragment? | B9 |
| **Q6** | Stranger-test cwd assumption — require user-app cwd or support CoCoder-install cwd with flag? | B6 |
| **Q7** | Sub-Playbook A close criteria — test port + path fixes + branding scrub only, or also workspace detection + minimal `cocoder-product` gate? | Defines M4 closure |

---

## 6 — Looks good (brief)

- Mechanical core library port complete: 24/24 upstream `core/lib/*.mjs` present + 3 intentional CoCoder additions (`env.mjs`, `paths.mjs`, `init-merge.mjs`).
- `contracts/`, `adapters/`, `checks/`, `quinn/` runtime helpers all present at manifest depth.
- `COB_ORCH_*` → `COCODER_ORCH_*` rename clean across `packages/` (env var only; CoBuilder identifier scrub still in progress).
- `cobuilder-build` path string absent from `packages/` source.
- Four-zone storage model consistent across ADR-0001, ARCHITECTURE.md, AGENTS.md, ignore matrix.
- ADR index correct; all 5 ADRs accepted; zone enum consistent across ADR-0005 ↔ doc ↔ schema.
- Config resolver, deep-merge, path tokens (`${COCODER_HOME}`, `${root:name}`), multi-machine portability, git-pull survival — implemented and behaviorally tested.
- Workspaces registry schema with tokenized paths + committed JSON artifact.
- Monorepo scaffold (pnpm-workspace, `.nvmrc`, CI workflow with schema-drift gate) aligns with ADR-0004.
- TS wrapper `cocoder-cli` uses `spawn` with argv array — no shell.
- Three of five recent CoBuilder improvements (stdin dispatch, lane identity validation, current-action persona audit) ported identically.
- Talia/Quinn split consistent with ADR-0002.
- Oz daemon security model in ARCHITECTURE is testable-checklist-quality (7 specific invariants), even though implementation is in C.

---

## Recommended next-action order (suggested M4 sequencing)

This is the recommended order Bob should execute M4 in. Each item maps to a `gates:` field in the foundation Playbook so blocked items stay un-started.

1. Refresh lying checkboxes (H10, H11, M11) — **5 min, no decisions needed**
2. Fix root `.gitignore` (B7, B8) — **5 min, no decisions needed**
3. Rename `cocoder/core/cli.mjs` references → resolve via `import.meta.url` (B1) + add regression test
4. Complete CoBuilder identifier scrub: tmux socket, prompt headers, Quinn defaults, commit trailers (B3) + un-check E2.4 until clean
5. **(Gated by Q1)** Add minimal `cocoder-product` deny-gate in `orchestrator-commit.mjs` (B5) — temporary belt until C
6. **(Gated by Q2, Q4)** Fix `findCocoderHome` to fail closed; add `--workspace-root` to `config set`; switch `handleConfig` to use `findCocoderHome` (B6, H3)
7. Wire `resolveSecretReferences` into `resolveConfig`; harden `validateConfig` skip behavior (H1, H2)
8. Port baseline file (B2) + 12-test port-first list (B4) — **the bulk of E2.2e**
9. Add stale-reference CI gate (M12)
10. **(Gated by Q3)** Default report paths (H5, H6)
11. **(Gated by Q5)** Verification-artifact guard decision (B9)
12. Remaining medium items in order of touch-proximity

---

## Appendix A — Subagent 1: Port completeness audit (raw)

**Subagent verdict:** Core port is structurally ~90% extracted but not Sub-Playbook A complete: 25 upstream tests are missing, `cocoder/core/cli.mjs` paths are wrong vs `packages/core`, baselines are absent, and CoBuilder branding/Quinn IDE assumptions leak in shipped packages.

Key evidence beyond the synthesized findings above:

- File-by-file inventory: 24/24 `core/lib/*.mjs` present in CoCoder; identical for `adapters.mjs`, `continuation.mjs`, `contracts.mjs`, `dispatch.mjs`, `flows.mjs`, `lead-rescue.mjs`, `ledger.mjs`, `model-roles.mjs`, `persona-route-audit.mjs`, `priority-boundaries.mjs`, `run-status.mjs`, `self-healing.mjs`, `session-wrap.mjs`.
- Diverged (intentional scrubbing/CoCoder extensions): `cli.mjs`, `acceptance.mjs`, `baseline.mjs`, `composition.mjs`, `config.mjs`, `debugger.mjs`, `fs-utils.mjs`, `launch.mjs`, `orchestrator-commit.mjs`, `personas.mjs`, `repo-state.mjs`.
- CoCoder-only additions: `env.mjs`, `paths.mjs`, `init-merge.mjs`.
- Correctly NOT imported: `debug-runs/`, `runs/`, `consult-runs/`, the `.command` launchers, `build-personas/`, CoBuilder infra docs.
- The five recent improvement checks: stdin dispatch PRESENT (`cli.mjs:493-497,951-959`); lane identity validation PRESENT (`ledger.mjs:284-286,607-618`); current-action persona audit PRESENT (`persona-route-audit.mjs:34-45,80-102,142-157`); nested Codex guardrail MISSING from shipped core (lives only in CoBuilder prompt fragment); verification-artifact write guard PRESENT BUT DIVERGED (inlined vs prompt-fragment).

## Appendix B — Subagent 2: Architecture/docs/CLI consistency (raw)

**Subagent verdict:** CoCoder's docs, schemas, and core config layer are largely aligned on storage zones, load order, merge semantics, and path tokens — but several progress checkboxes overstate completion, ADR-0005 routing exists only as schema/docs with no runtime enforcement, and the extracted core still carries CoBuilder-specific paths and branding that break default CLI flows on the dogfood repo.

Key evidence beyond synthesis:

- CLI subcommand wiring trace: `validate-contracts` (L84-92), `validate-adapters` (L114-126), `preflight-adapters` (L128-136), `config get/set` (L873-901), `list-runs` (L831-835), `compose-launch` (L227-246), `prepare-debug/prepare-debugger` (L838-851) — all wired through `cocoder-cli` → `packages/core/cli.mjs`.
- 50+ internal subcommands exist in core CLI help (L983-1052); user-facing docs only cover `config get/set` and test commands. Acceptable for A; gap for Sub-Playbook D.
- Schema src/dist pairing: 5 TS sources → 5 committed JSON artifacts (`config`, `install-config`, `roots`, `workspaces-registry`, `oz-improvement-routing`). No orphans. Drift not verifiable here (no git on mount).
- Memory accuracy: mostly correct; minor staleness in `codebase-map.md:52` and `oz/README.md`.

## Appendix C — Subagent 3: Tests, gitignore, security audit (raw)

**Subagent verdict:** CoCoder has only 6 real tests in `packages/core` versus ~291 in CoBuilder's orchestration suite — Sub-Playbook A is not test-complete. Root `.gitignore` omits `*.env`/`secrets/` rules from ARCHITECTURE, and blanket `dist/` likely conflicts with CI's tracked `packages/schemas/dist/*.schema.json` gate. Launch/debug code still hardcodes `cocoder/core/cli.mjs` and `cobuilder-orchestration` tmux socket names; one test only greps source text instead of exercising behavior.

Key evidence beyond synthesis — Process spawn inventory (`packages/core`):

| File:line | API | Assessment |
|---|---|---|
| `launch.mjs:900` | `execFileAsync('git', [...])` | Safe (argv) |
| `launch.mjs:1434,1454` | `execFileAsync('/bin/zsh', [scriptPath])` | Medium — runs generated scripts under `runDir`; trust run-dir boundary |
| `launch.mjs:1480` | `execFileAsync(tmuxBin, args)` | Safe |
| `debugger.mjs:797` | `execFileAsync(command, args)` | Safe when args array |
| `debugger.mjs:297` | `bash -lc command -v ...` | Medium (shell) |
| `baseline.mjs:112` | `execFileSync('git', args)` | Safe |
| `orchestrator-commit.mjs:667` | `execFileAsync('git', ...)` | Safe |
| `repo-state.mjs:156` | `execFileAsync('git', ...)` | Safe |
| `continuation.mjs:311` | `execFileAsync('git', ...)` | Safe |
| `scripts/check-mjs.mjs:32` | `spawn(node, ['--check', file])` | Safe |
| `quinn/launch-ide.mjs:72` | `spawn('pnpm', ['dev'], { cwd: ideDir })` | Safe (argv); CoBuilder-only IDE coupling |
| `cocoder-cli/src/cli.ts:10` | `spawn(node, [coreCli, ...argv])` | Safe |

Oz daemon security model assessment: invariants 1–6 are specific and testable (no implementation yet); invariant 7 (argv-only) is partial — `execFile` for tmux/git but generated `.sh` + `bash -lc` in debugger.

## Appendix D — Subagent 4: User-customization boundary audit (raw)

**Subagent verdict:** A normal adopter cannot reach `packages/` or `templates/` through `config set` alone, but the CLI anchors almost everything to `process.cwd()` (not the Oz workspace registry), and `orchestrator-commit` defaults explicitly allow product paths when the repo root is the CoCoder install. ADR-0005 routing is schema-only until Sub-Playbook C; `cocoder init` and `templates/workspace-cocoder/` are not implemented yet.

Key evidence beyond synthesis — Default path → zone map:

| Default | Value | Intended zone | Actual when cwd = user app | Actual when cwd = CoCoder install |
|---|---|---|---|---|
| `config set` | `<cwd>/local/config.yaml` | install-local | **Wrong tree** | install-local OK |
| `config get` merge | install `local/*` + optional workspace | layered | OK if `--workspace-root` set | OK |
| `DEFAULT_RUNS_DIR` | `<cwd>/local/runs` | install-local per slug | wrong path | install-local (flat, not `workspaces/`) |
| Personas/routes/profiles | `<cwd>/cocoder/…` | workspace-shared | user workspace OK | **dogfood `cocoder/` (tracked)** |
| Check reports | `<cwd>/cocoder/runs/…` | should be ephemeral | tracked pollution risk | **dogfood tracked pollution** |
| `orchestrator-commit` surfaces | includes `packages/` | coder-product only | N/A unless repo is CoCoder | **product writable** |
| `findCocoderHome` (internal) | ancestor or cwd | install | usually cwd | install root |

**Direct answer to the audit question — can a user accidentally mutate install-public product?**

| Scenario | Outcome |
|---|---|
| `cocoder config set` from their app repo | No (writes `<app>/local/`, wrong zone but not product) |
| `cocoder config set` from CoCoder install | No to `packages/` (only `local/config.yaml`) |
| Orchestration with `execute` + commit from CoCoder cwd | **Yes** — `orchestrator-commit.mjs` allows `packages/`, `templates/`, `docs/` |
| Oz improvements (today) | N/A — no Oz daemon; no routing enforcement |
| `cocoder init` (today) | N/A — not implemented |

**Strongest accidental-product vector:** cwd = CoCoder install + launch/commit/check defaults — not workspace customization APIs.

---

*End of audit.*
