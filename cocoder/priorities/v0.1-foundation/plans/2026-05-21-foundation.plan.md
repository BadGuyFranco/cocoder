# Sub-Playbook A — CoCoder Foundation: skeleton, config survival, install prefs, core extraction

**Created:** 2026-05-21 | **Updated:** 2026-05-22 (audit-driven Refine; Milestone M4 added; 4 of 12 E2.2e port-first files closed via Sub-Playbook E orchestration; repo published)
**Type:** One-time
**Collaboration:** Collaborative
**Status:** Active (Refine — audit remediation in progress)
**Method:** WISER Playbook (Sub-Playbook; Master = `../README.md`)
**Parent:** [v0.1-foundation priority](../README.md)
**Audit evidence:** [`2026-05-22-foundation-audit.md`](./2026-05-22-foundation-audit.md)
**Founder gates:** [`../pending-decisions.md`](../pending-decisions.md) (Q1–Q7; blocks specific M4 tasks)

## Context

This is **Sub-Playbook A of four** for CoCoder v0.1. It owns the bottom of the stack: repo scaffolding, the config-survival invariant, install-level preferences, and the mechanical extraction of CoBuilder's `.mjs` orchestration core. Everything else (personas, Oz, docs, publish) lives in Sub-Playbooks B, C, D and **cannot start until this Sub-Playbook reaches Final Check**.

The riskiest invariant in the entire v0.1 program lives here: **user preferences must survive `git pull`, multi-machine sync, and `cocoder init --merge` without manual intervention.** If this can't be proven, Sub-Playbooks B–D are not worth starting.

**Key files for resume:**

- Master: `../README.md`
- ADRs: `decisions/0001`, `0003`, `0004` (most relevant to this Sub-Playbook)
- Architecture: `ARCHITECTURE.md` — four-zone model, ignore matrix, multi-machine portability, Oz daemon security
- Extraction source: `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/`

---

## Preconditions

- [x] Master Playbook Interrogate complete; ADRs 0001, 0003, 0004 accepted
- [x] V1 of the all-in-one Playbook archived to `./zArchive/26-05-21 V1 - foundation.plan.md`
- [x] ARCHITECTURE.md ignore matrix locked in
- [x] Root `.gitignore` already enforces `local/` ignore rule (committed during dogfood meta-project setup)
- [x] CoBuilder extraction source readable at `/Volumes/NAS LOCAL/CoBuilder/infrastructure/cobuilder-build/orchestration/` (verified pre-execution)
- [ ] `pnpm` and Node 20 LTS installed locally (verify before E1)

---

## Authority

**Autonomous:** Repo scaffolding, `pnpm-workspace.yaml`, `.nvmrc`, root `.gitignore`, ADR drafts, config resolver implementation, schema authoring in Zod, extraction manifest, mechanical port of `.mjs` files with `COB_ORCH_*` → `COCODER_ORCH_*` rename, tests, CI workflow draft.

**Needs human input:** Any deviation from ADR-0003 (naming) or ADR-0004 (TS/Zod/AJV/pnpm/Node). Any change in extracted-file behavior beyond the manifest's documented transformations.

---

## Witness

### Audit findings

| Area | Verified state | Implication for this Sub-Playbook |
|---|---|---|
| CoBuilder `orchestration/core/lib`, `cli.mjs`, `contracts`, `adapters`, `tests` | Mature `.mjs` with JSON contracts; well-tested | Port verbatim; rename env prefix only; defer TS migration to post-v0.1 |
| CoBuilder `COB_ORCH_*` env vars | Spread across CLI, adapters, prompts, route metadata | Single grep-and-replace pass driven by the extraction manifest |
| CoCoder `/local/` zone | Documented in ARCHITECTURE; **already enforced** by root `.gitignore` (committed during dogfood setup); `cocoder/local/` has its own inner `.gitignore` keeping `README.md` + `.gitignore` tracked | E1 extends `.gitignore` for build artifacts (`dist/`, `*.tsbuildinfo`, `packages/schemas/dist/`); M6 ships `local/config.example.yaml` schema |
| Multi-machine portability | Discussed in ARCHITECTURE; no runtime token-resolver yet | S1.4 creates `${COCODER_HOME}` and `${root:name}` resolution; S1.5 tests across simulated machines |
| `cocoder init --merge` | Conceptual only; no implementation | S1.5 + E4-deferred-to-B; A only proves the resolver invariants; full `init` lives in Sub-Playbook B |

### Objective

Ship a working `cocoder` CLI (validate-contracts, compose-launch, prepare-debug, list-runs, config get/set) on top of an extracted `packages/core`, with a proven config resolver and install-level preferences. No personas, no Oz, no workspace template — those are Sub-Playbooks B and C.

### Scope

**In:** `packages/core` (extracted `.mjs`), `packages/cocoder-cli` (TS wrapper), `packages/schemas` (Zod + JSON Schema export), `packages/utils` if needed, root `pnpm-workspace.yaml`, `.nvmrc`, `.gitignore`, `README.md`, `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `docs/configuration.md`, GitHub Actions CI on push, install-level `local/config.example.yaml` schema.

**Out (defer to other sub-Playbooks):**

- Personas (B), workspace template + `cocoder init` end-to-end (B), `audit-workspace`, `refresh-memory` (B)
- Oz daemon, Oz dashboard, Run Inspector, Settings UI (C)
- `docs/getting-started.md`, `docs/orchestration.md`, `docs/personas.md`, `docs/oz.md`, `docs/faq.md` (D)
- Dogfood, Refine = stranger test, publish gates (D)

**Depends on:** Master Playbook Interrogate complete (it is).

### Current State

Greenfield `packages/` (nothing in CoCoder yet). CoBuilder extraction source intact. ADRs locked.

### Deliverable

Mergeable `main` branch with:
- Working `pnpm install && pnpm -F core test && pnpm -F cocoder-cli build`
- `./packages/cocoder-cli/bin/cocoder validate-contracts` exits 0
- Config survival test green in CI
- Multi-machine portability test green in CI
- ADR-0001 through 0004 all referenced from `ARCHITECTURE.md`

**Checkpoint:** [x] Current state verified. Objective measurable. Scope boundaries explicit.

---

## Interrogate

### Sub-Playbook-local risks (program-level risks live in the Master)

| Risk | Status | Mitigation | Notes |
|---|---|---|---|
| Path-hardcoded CoBuilder assumptions leak through extraction | Active | Path resolver in `packages/core/lib/paths.mjs`; extraction manifest enumerates every file with a transformation column; acceptance tests on temp workspaces | |
| Env-prefix rename misses occurrences (e.g. in prompts, route JSON, doc fragments) | Active | Extraction manifest includes a "validation command" column with a `rg COB_ORCH_` scan per artifact group; CI fails if any tracked artifact still contains `COB_ORCH_` | |
| Zod ↔ AJV schema drift between TS packages and `.mjs` core | Active | `pnpm -F schemas build` is a prereq of `pnpm -F core test`; CI gates verify generated `.schema.json` matches committed artifacts | |
| Config resolver edge case: workspace `cocoder/config.yaml` overrides install-level secret reference | Active | Resolver spec (S1.1) documents override precedence; test case in S1.2 | |
| `cocoder init --merge` idempotency | Active (defer to B for full implementation; A proves the **resolver** side) | S1.5 simulates the merge against the resolver; full `init` command lands in Sub-Playbook B | |
| Multi-machine path portability via Syncthing | Active | S1.4 token resolution + S1.5 cross-machine simulation | |
| CI on macOS-only is fragile | Mitigated | Pin GitHub Actions runner `macos-14`; document Linux as best-effort in docs/faq (Sub-Playbook D) | |

### Reuse check

- [x] CoBuilder `orchestration/core/lib/paths.mjs` pattern (if present) — read before authoring CoCoder's
- [x] CoBuilder `contracts/` JSON Schema files — confirm whether they exist as canonical artifacts or only as ad-hoc validation (informs how aggressively Zod becomes the source of truth)
- [x] Cofounder WISER Playbook Author for discipline

**Checkpoint:** [x] Local risks mapped. Riskiest piece = **config survival + multi-machine portability** (Solve).

---

## Solve

*Prove the resolver behaves correctly across `git pull`, multi-machine sync, and `--merge` re-runs before porting 30k+ lines of orchestration.*

**Riskiest piece:** Config resolver that survives `git pull` on CoCoder, `cocoder init --merge` re-runs in workspaces, and multi-machine Syncthing replication with differing absolute roots.

### Tasks

- [x] **S1.1** Author config resolver spec in `docs/configuration.md`:
  - Load order: `defaults < install template < <CoCoder>/local/* < workspace cocoder/config.yaml < workspace cocoder/local/*`
  - Format support: YAML (primary) and JSON (interchangeable; same schema)
  - Merge semantics: deep-merge for objects, **replace** for arrays (no concat surprises), explicit `__merge: append` or `__merge: replace` per-array opt-in for advanced cases
  - Secret reference syntax: `${env:NAME}`, `${file:relative/path}`, `${keychain:service/account}` (keychain stub in v0.1, errors gracefully)
  - Schema validation failure: refuse to start; print which file + JSON Pointer + violated constraint
  - Ownership: `cocoder config get/set` writes to `<CoCoder>/local/config.yaml` only; Oz writes are routed through the same code path
- [x] **S1.2** Implement resolver in `packages/core/lib/config.mjs`; author Zod schema in `packages/schemas/src/config.ts`; CI step `pnpm -F schemas build` emits `config.schema.json`
- [ ] **S1.3** Write fixture: `tests/fixtures/git-pull-survival/` with a workspace whose `cocoder/local/overrides.json` is intentionally non-default; simulated `git pull` (tracked-only overwrite) leaves `local/` byte-identical → *audit §B4: only inline test exists in `config-resolver.test.mjs`; fixture tree not created; un-check until materialized*
- [x] **S1.4** Implement path token resolver in `packages/core/lib/paths.mjs`: resolves `${COCODER_HOME}`, `${root:name}` (from `local/roots.yaml`), and absolute paths as fallback; emits warning when absolute path is stored
- [ ] **S1.5** Write fixture: `tests/fixtures/multi-machine/` with two `local/workspaces.json` files representing the same logical workspace at different absolute roots on machine A vs machine B; resolver returns identical workspace identity on both → *audit §B4: same as S1.3 — inline only, no fixture tree*
- [ ] **S1.6** Write fixture: `tests/fixtures/init-merge-idempotency/` — workspace with a user-edited tracked file (e.g. `cocoder/PRIORITIES.md`) and a `git pull`–introduced new tracked file (`cocoder/standards/raci.md`); `cocoder init --merge` adds the new file and **does not** clobber the edited one (proof requires only the `--merge` planner from core; full apply lands in Sub-Playbook B) → *audit §B4: inline only*
- [x] **S1.7** All Solve fixtures run in CI on every push; failure blocks merge

**Pass threshold:** `pnpm -F core test config-resolver` exits 0 on macOS-14 runner; all six fixtures green; manual checklist (delete tracked `cocoder/PRIORITIES.md`, restore from git, confirm `local/` unchanged byte-for-byte) succeeds.

**Checkpoint:** [x] Config survival + portability + merge idempotency proven. Master `P-S1` mirrors this checkpoint.

---

## Expand

### Milestone 1 — Repository skeleton and governance

- [x] **E1.1** `README.md` — what CoCoder is, 5-minute mental model, requirements (Node 20+, pnpm, tmux, iTerm2, CLIs)
- [x] **E1.2** `LICENSE` (Apache-2.0) + `NOTICE` template
- [x] **E1.3** `CONTRIBUTING.md` + `CODE_OF_CONDUCT.md`
- [x] **E1.4** Extend root `.gitignore` for build artifacts. Current root ignores `local/`, `node_modules/`, `dist/`, package JS build outputs, `.DS_Store`, `.stfolder/`, and `*.tsbuildinfo`; `packages/schemas/dist/` is intentionally trackable for the schema-drift gate. **Do NOT add `cocoder/` or `cocoder/local/`** — the dogfood meta-project is tracked; `cocoder/local/` is governed by its own inner `.gitignore` per ARCHITECTURE.md ignore matrix. Verify with `cat .gitignore` and compare to ARCHITECTURE.md before adding entries.
- [x] **E1.5** `pnpm-workspace.yaml` listing `packages/*`; root `package.json` with `engines.node: ">=20.10 <21"`, scripts (`build`, `test`, `lint`, `typecheck`)
- [x] **E1.6** `.nvmrc` pinned to `20`
- [x] **E1.7** `tsconfig.base.json` for TS packages; `tsconfig.json` per TS package extending base

### Milestone 2 — Extract orchestration core (manifest-driven)

- [x] **E2.1** **Author extraction manifest** at `priorities/v0.1-foundation/plans/extraction-manifest.md` (path is unambiguous — alongside this Playbook, not at workspace root). Non-Playbook reference file (no WISER ceremony). Table with columns: `source path | target path | transformation | validation command | dropped CoBuilder behavior`. Covers every file under CoBuilder `orchestration/core/lib`, `orchestration/contracts`, `orchestration/adapters`, `orchestration/cli.mjs`, `orchestration/tests`.
- [x] **E2.2** Execute extraction in five mechanical sub-passes (each pass has its own commit and validation):
  - [x] E2.2a `contracts/` → `packages/core/contracts/` — verify all JSON parses
  - [x] E2.2b `core/lib/` → `packages/core/lib/` — verify all imports resolve under pnpm
  - [x] E2.2c `core/cli.mjs` → `packages/core/cli.mjs` — verify it loads (no runtime call yet)
  - [x] E2.2d `adapters/` → `packages/core/adapters/` — verify adapter registry parses
  - [x] E2.2e `tests/` → `packages/core/tests/` — port the **12 port-first files** identified in audit §4 (port-first list), in this order; **do not port** the CoBuilder-specific tests called out in audit §4 "Do not port": **CLOSED 2026-05-23 — all 12 ports landed; E2.2e.12 retired per ticket 0001 Path B (Path B = terminal-only; no `.command` wrappers in v0.1).**
    - [x] E2.2e.1 `core.test.mjs` (contracts, persona load, ledger primitives, priority extractor) — **ported by Talia 2026-05-22 via Sub-Playbook E E3.3** ([`run-20260522T133403Z-rwrkcfcg`](../../../local/workspaces/cocoder-dogfood/runs/); `pnpm -F core test core` = 75/75 pass; 446 lines / 18,195 bytes; both lanes PASS; first orchestrated dogfood task)
    - [x] E2.2e.2 `dispatch.test.mjs` (locks, write-boundary audit, verifier packets) — **ported by Talia 2026-05-22 via Sub-Playbook E Refine** ([`run-20260522T135126Z-t4rnd35z`](../../../local/workspaces/cocoder-dogfood/runs/), `pnpm -F core test dispatch` = 86/86 pass; PASS from both lanes; 11/11 source test names preserved per Bob's parity check)
    - [x] E2.2e.3 `adapters.test.mjs` (preflight/semantic validation) — **ported by Talia 2026-05-22 via Sub-Playbook E orchestration loop** ([`run-20260522T160453Z-nsluixnb`](../../../local/workspaces/cocoder-dogfood/runs/); Talia PASS + Bob CONDITIONAL_PASS on the schemas/dist mtime side effect; `pnpm -F core test adapters` = 93/93 pass; 7/7 source test names preserved; CONDITIONAL flag tracked as `PORT-NOTES.md` finding F, v0.2 follow-up — not a real schema drift, bytes verified byte-stable)
    - [x] E2.2e.4 `composition.test.mjs` (route/profile compatibility, dry-run, stale-priority guard) — **ported by Talia 2026-05-22 via Sub-Playbook E orchestration loop** ([`run-20260522T161135Z-i3wg7ti9`](../../../local/workspaces/cocoder-dogfood/runs/); both lanes PASS; `pnpm -F core test composition` = 110/110 pass; 17/17 source test names preserved)
    - [x] E2.2e.5 `launch.test.mjs` (52 upstream tests; dry-run, add-lanes, send-message/stdin, stop-run, finalizer, tmux quotes) — **landed via PR #3 (2026-05-22) — largest single port; pair with M4.3 CLI path rename done; port surfaced + closed 4 product-code bugs in the same PR (attachAddedLanes TTY targeting, DURABLE_ORCHESTRATION_PREFIXES, activeRunPreflight + findActiveRunsForPriority, `--allow-concurrent-priority-run` CLI flag).** 55/55 tests pass.
    - [x] E2.2e.6 `orchestrator-commit.test.mjs` (route-owned commits, filesChanged guards, verification-artifact guard) — **landed via PR #7 + bounded-commit dirty-check fix.**
    - [x] E2.2e.7 `debugger.test.mjs` (prepare-debugger, evidence follow, pane/root checks) — **landed via PR #8.**
    - [x] E2.2e.8 `flows.test.mjs` (phase transitions, write-boundary violations, closeout gates) — **landed via PR #9.**
    - [x] E2.2e.9 `lead-rescue.test.mjs` + fixture `fixtures/lead-rescue/valid-supersession-record.json` — **landed via PR #10.**
    - [x] E2.2e.10 `session-wrap.test.mjs` (wrap audit, handoff consistency) — **landed via PR #11.**
    - [x] E2.2e.11 `repo-state.test.mjs` (add-lanes repo audit) — **landed via PR #12.**
    - [x] E2.2e.12 `launch-command.test.mjs` — **Retired 2026-05-23 (Path B per ticket 0001).** CoCoder ships terminal-only; the upstream `.command` double-click wrappers were intentionally dropped during extraction and are not coming back. The ported test file (which only asserted wrapper-script validity) was deleted via PR #16; resolution recorded in `tickets/closed/0001-cocoder-command-wrapper-decision.md`.
    - [ ] E2.2e.replace Replace shallow `orchestration-improvements.test.mjs` source-grep with runtime launch-behavior fixtures (dry-run + execute-with-mock-transport per upstream `launch.test.mjs:108-109`)
- [x] **E2.3** Rename `COB_ORCH_*` → `COCODER_ORCH_*` throughout (`packages/core/lib/env.mjs` exports constants; no hardcoded literals). Validation: `rg 'COB_ORCH_' packages/` returns zero matches.
- [x] **E2.4** Generalize CoBuilder-specific paths: introduce `packages/core/lib/paths.mjs` (already created in Solve); rename `cobuilder-build` → `cocoder` across paths. Validation: `rg 'cobuilder-build' packages/ docs/ templates/` returns zero matches **AND** `rg 'cobuilder' packages/ --glob '!**/*.example.*'` returns zero matches → *closed 2026-05-22 by M4.4: both gates return 0 hits; the upstream CoBuilder attribution in `packages/core/quinn/README.md` boundary note is intentional (CapitalCase, doesn't match the gate).*
- [x] **E2.5** Generalize RACI/write-boundary standards to workspace-relative `cocoder/standards/` references (defer the actual standards docs to Sub-Playbook B; here we only fix path references in core)
- [x] **E2.6** Public CLI entry `packages/cocoder-cli/bin/cocoder` (TS-built) exposing `validate-contracts`, `compose-launch`, `prepare-debug`, `list-runs`, `config get`, `config set`. The TS CLI is a thin wrapper that invokes `packages/core/cli.mjs` subcommands.
- [x] **E2.7** GitHub Actions workflow `.github/workflows/ci.yml`: matrix on `macos-14` Node 20; jobs:
  - `pnpm install --frozen-lockfile`
  - `pnpm -F schemas build`
  - **Schema-drift gate:** `git diff --exit-code packages/schemas/dist/` — fails CI if generated `.schema.json` differs from committed; this enforces the Zod-as-SSOT contract from ADR-0004 (without this gate, `.mjs` core and TS packages can disagree silently)
  - `pnpm typecheck`
  - `pnpm -r test`
  - `pnpm -F core test config-resolver`
  - Public-readiness-gate placeholder (real gates in Sub-Playbook D)

### Milestone 6 (renumbered as A-M3 inside this sub-Playbook) — Install preferences

- [x] **E3.1** `templates/install-local/config.example.yaml` — tracked example with documented keys: workspaces registry, default adapters, Oz port (placeholder), theme, secret reference samples
- [x] **E3.2** `packages/schemas/src/install-config.ts` — Zod schema for `<CoCoder>/local/config.yaml`; build emits `install-config.schema.json` for `$schema` autocomplete
- [x] **E3.3** `packages/schemas/src/roots.ts` — Zod schema for `<CoCoder>/local/roots.yaml` (multi-machine token resolution); document in `docs/configuration.md`
- [x] **E3.4** `cocoder config get <key>` / `cocoder config set <key> <value>` — round-trips through resolver, writes to `<CoCoder>/local/config.yaml` only
- [x] **E3.5** `local/secrets/.gitignore` shipped via template copy so the directory always exists with the right ignore rule; document keychain integration as v0.2 in `docs/configuration.md` → *closed 2026-05-23 by M4.10 (Group B): `templates/install-local/secrets/.gitignore` shipped (ignore-everything-except-self pattern); keychain doc note already present.*
- [x] **E3.6** `packages/schemas/src/workspaces-registry.ts` — Zod schema for `<CoCoder>/local/workspaces.json` (the Oz workspace registry — data Oz reads/writes; HTTP API for Oz lands in Sub-Playbook C). Also reserve namespace `packages/schemas/src/oz/` (empty placeholder + README) so Sub-Playbook C can extend without restructuring the schemas package.

### Milestone 4 — Audit remediation (added 2026-05-22 from foundation audit)

> Driven by [`2026-05-22-foundation-audit.md`](./2026-05-22-foundation-audit.md). Each task cites its audit ID. All Q1–Q7 answered 2026-05-22 ([`../pending-decisions.md`](../pending-decisions.md)); Q4=A graduated to ADR-0006. The previously-gated tasks M4.22–M4.27 now carry the chosen-option semantics inline. Order below matches the audit's recommended sequencing.

#### Free wins (no founder decision needed)

- [x] **M4.1** Refresh lying checkboxes across Master README + this plan + PRIORITIES.md (audit §H10, §H11, §M11). Verify every `[x]` matches reality before moving on. — *Initial audit pass closed 2026-05-22 (Evening) per SESSION_LOG; second sweep closed 2026-05-23 covering the E2.2e port-row drift and the M4 free-win rows landed but not ticked.*
- [x] **M4.2** Root `.gitignore`: add `*.env`, `.env.*`, `secrets/`; replace blanket `dist/` with `packages/*/dist/` + `!packages/schemas/dist/*.schema.json` (audit §B7, §B8). Verify with `git check-ignore` on a real clone. — *Closed 2026-05-22 (Evening); per-package `packages/*/dist/` + schemas un-ignore + `js/` re-ignore landed so the schema-drift gate sees the tracked `*.schema.json` artifacts.*
- [x] **M4.3** Rename `cocoder/core/cli.mjs` references in shipped runtime → resolve via `import.meta.url` / install-relative path (audit §B1). Files: `packages/core/lib/launch.mjs:1051,1276,1379`; `packages/core/lib/debugger.mjs:254,715`; `packages/core/lib/orchestrator-commit.mjs:18`. Add regression test asserting each generated `cliPath` literal resolves to an existing file. — *Closed 2026-05-22 (Evening); `CORE_CLI_PATH` module constant introduced; 4 regression tests in `tests/cli-path-resolution.test.mjs`.*
- [x] **M4.4** Complete CoBuilder identifier scrub in `packages/` (audit §B3): tmux socket (`cobuilder-orchestration` → `cocoder-orchestration`), prompt headers, mkdtemp prefix, commit trailers (`@cobuilder.local` → configurable), contract schema descriptions, Quinn defaults (`cobuilder-ide`, `cobuilder-dev-console-env`, `api-staging.cobuilder.me`), git probe filename. **Re-check E2.4 when `rg 'cobuilder' packages/ --glob '!**/*.example.*'` returns 0.** — *Closed 2026-05-22 (Evening); `rg 'cobuilder' packages/ --glob '!**/*.example.*'` returns 0 case-sensitive matches; E2.4 ticked with cross-reference.*
- [x] **M4.5** Wire `resolveSecretReferences()` into `resolveConfig()` (audit §H1). Add opt-out path for `config get` display mode. — *Closed 2026-05-23 (Group C): `resolveConfig` now resolves secrets after merge + validate (gated by `options.resolveSecrets`, default `true`). `config get` CLI defaults to UNRESOLVED display so `${env:OPENAI_API_KEY}` doesn't leak to stdout/JSON; new `--reveal-secrets true` flag opts back in for debugging. 4 regression tests in `tests/config-secret-resolution.test.mjs`.*
- [x] **M4.6** Harden `validateConfig` to fail closed when schema artifact missing (audit §H2); allow skip only in explicit test mode. — *Closed 2026-05-23 (Group C): `validateConfig` throws with a friendly "run pnpm -F schemas build" message when the schema is missing; preserved skip behavior gated behind `allowMissingSchema: true`. 3 regression tests in `tests/config-secret-resolution.test.mjs` covering fail-closed, opt-out, and the real-schema path.*
- [x] **M4.7** Quinn credentials path — align with comment + add `.gitignore` rule (audit §H12). — *Closed 2026-05-23 (Group D): canonical path is now `cocoder/local/.quinn-credentials.json` (workspace-private zone, gitignored automatically by `cocoder/local/.gitignore`); README, code comment, and constant all aligned; tracked template ships at `cocoder/.quinn-credentials.example.json`; belt-and-braces `.quinn-credentials.json` rule added to root `.gitignore` so misplaced copies elsewhere also stay out of git.*
- [x] **M4.8** `composition.mjs:13` default → `cocoder/decisions` (audit §H13). — *Closed 2026-05-23 (Group D): audit cited the wrong file — the `repoPath('decisions')` defaults are actually in `cli.mjs:744,757,770` (handlers for `check-doc-refs`, `check-adr-status-consistency`, `check-doc-freshness`). All three updated to `repoPath('cocoder/decisions')` so the dogfood `cocoder/decisions/` directory is the default (there is no `decisions/` at repo root). Operators can still pass `--decisions-dir` to override.*
- [x] **M4.9** Template `$schema` reference path fix: `templates/install-local/config.example.yaml:1` → `../../packages/schemas/dist/install-config.schema.json` (audit §H14). — *Closed 2026-05-23 (Group B): one `../` was missing; from `templates/install-local/`, `../` is `templates/`, not the repo root. Fixed.*
- [x] **M4.10** Ship `templates/install-local/secrets/.gitignore` (audit §M1). Re-check E3.5. — *Closed 2026-05-23 (Group B): shipped with the standard "ignore everything except self" pattern + a comment block explaining the directory's role. E3.5 re-ticked.*
- [x] **M4.11** Generated bash safety: quote `session.command` in `launch.mjs:1156`; replace `$*` with `"$@"` in `launch.mjs:1394`; switch `debugger.mjs:296-297` `commandProbe` from `bash -lc` to `execFile('command', ['-v', cmd])` (audit §H9). — *Closed 2026-05-23 (Group F): `session.command` is now `shellQuote`d in the `*)` fallthrough branch of `renderSessionWrapper` (line numbers shifted post-extraction; the claude/codex explicit branches don't need quoting). `commandProbe` switched from `bash -lc "command -v ..."` to `/usr/bin/which` — no shell spawn, no login-file sourcing, no Oz-invariant-7 violation. The `--message "$*"` → `"$@"` recommendation was inverted for this dispatcher's "all args → one --message value" contract — kept `"$*"` (quoted) with an inline JS comment explaining why; the audit's suggested fix would have broken multi-word messages.*
- [ ] **M4.12** Port `packages/core/baselines/accepted-reference-baseline.md` per extraction manifest (audit §B2). `check-immutable-baseline` works with default args after.
- [x] **M4.13** Remove deferred `.command` launcher references in `debugger.mjs:256-258,590,619` (audit §H8). Replace with `cocoder` CLI invocations or gate behind workspace-template presence. — *Closed 2026-05-23 (Group E): the three `zsh -n` probes in `collectLaunchPreflight` against the (now-retired-Path-B) wrapper files have been deleted — they always failed since extraction. The two debugger-prompt sections that claimed `ORCH DEBUGGER.command` exports `COCODER_ORCH_DEBUGGER_GIT_WRITE` were rewritten to describe what actually happens post-Path-B: the wrapper script generated by `cocoder prepare-debug` reads the env var at exec time and the founder sets it in their shell. `debugger.test.mjs` updated to assert the new prompt language + the absence of all three retired wrapper-file references.*
- [x] **M4.14** Move `launch.mjs:910-913` git capability probe out of `.git` dir into run evidence dir (audit §H15). — *Closed 2026-05-23 (Group F): the probe stays inside `.git/` (moving it outside would produce a false positive — workspace-write sandboxes can write under the workspace tree but not under `.git/`, so the probe must target `.git/` to actually test git-write capability), but it now writes into a dedicated `.git/cocoder-capability-probes/` subdirectory instead of directly at the top of `.git/` where the `.lock` filename could be mistaken for git's own internals. The subdir + file are removed in both success and failure paths. Same pattern applied to the parallel `debugger.mjs collectAdapterProbes` git probe (`.git/cocoder-debugger-git-probe-...tmp` → same subdir, naming scheme `debugger-<pid>.tmp`).*
- [x] **M4.15** Add stale-reference CI gate: `rg 'cobuilder|COB_ORCH_' packages/ docs/ templates/ --glob '!**/*.example.*'` must return 0 (audit §M12). Add `/Volumes/` gate scoped to allow only `*.example.*`. — *Closed 2026-05-22 (Evening); CI workflow at `.github/workflows/ci.yml` runs both gates. **Note 2026-05-22:** the gates initially exited 127 (no ripgrep) for several days before [PR #14](https://github.com/BadGuyFranco/cocoder/pull/14) installed `ripgrep` in CI — they now actually enforce.*
- [x] **M4.16** Acceptance harness — parameterize hardcoded `'ORCHESTRATION-REBUILD'` slug (audit §M2; `acceptance.mjs:73`). — *Closed 2026-05-23 (Group D): `startupPacketProof` now takes `options.acceptanceFixtureSlug` with default `ACCEPTANCE-STARTUP-PROOF` (CoCoder-neutral). Slug appears verbatim in fixture PRIORITIES.md heading + assertion, so a single override keeps both ends consistent.*
- [x] **M4.17** ARCHITECTURE.md target sections — label unshipped dirs as `(Target — Sub-Playbook B/C/D)` (audit §M3). — *Closed 2026-05-23 via this batch (Group A): `packages/oz-daemon/`, `packages/oz-dashboard/` → "(Target — Sub-Playbook C)"; `templates/workspace-cocoder/` → "(Target — Sub-Playbook B)"; `examples/personas/phil-primitive-builder/` → "(Target — Sub-Playbook B)". `templates/install-local/` added to the layout block since it has shipped.*
- [x] **M4.18** Memory file refresh: `cocoder/memory/codebase-map.md:52` and `packages/schemas/src/oz/README.md` (audit §M4, §M5). — *Closed 2026-05-23: codebase-map.md regenerated end-to-end to reflect current reality (Sub-Playbook A mid-Refine, Sub-Playbook E effectively Complete, 229 tests pass, 12/12 ports landed); the Key modules table extended to cover launch / orchestrator-commit / composition / dispatch / debugger / ledger and the ADR-0005 schema. `packages/schemas/src/oz/README.md` rewritten with separate "Landed" + "Target (Sub-Playbook C)" sections — improvement-target.ts is now documented.*
- [x] **M4.19** Master README "Key files" — add ADR-0005 row (audit §M6). — *Closed 2026-05-23: ADR-0001..0006 are now listed individually with one-line summaries rather than the implicit "0001 through 0006" sweep.*
- [x] **M4.20** Cross-doc P-S1/P-S2 mismatch resolution (audit §M11): pick Master `[x]` as canonical, mirror in foundation Final Check. — *Closed 2026-05-22 (Late Evening): foundation Final Check line 280 already reads "Master Playbook's P-S1 and P-S2 checked (audit §M11: Master [x] is canonical; mirrored here 2026-05-22)". This M4 row was simply un-ticked while its actual content closed back in May; ticking now to reflect reality (same class of drift M4.1 was supposed to catch).*
- [x] **M4.21** `configFileOrder` either drop tracked `cocoder/config.yaml` from precedence or document it in ARCHITECTURE (audit §M8). — *Closed 2026-05-23 (Group B): document path chosen. ARCHITECTURE.md `<your-app>/cocoder/` directory-layout block now shows `config.yaml` (optional team-shared tracked defaults) alongside `local/config.yaml` (per-machine overrides). Matches `docs/configuration.md` Load Order step 4 + `packages/core/lib/config.mjs:164` `configFileOrder()`. Adopters get a tracked layer for team defaults that doesn't require Syncthing or per-machine overrides; most workspaces leave the file absent.*

#### Founder-gated tasks (cannot start until pending-decisions.md Q# is answered)

- [x] **M4.22** Q1=B applied — Add minimal `cocoder-product` deny-gate in `orchestrator-commit.mjs` `DEFAULT_IMPLEMENTATION_SURFACES`: require explicit `--developer-mode` flag (or `COCODER_DEVELOPER_MODE=1` env) to permit writes under `packages/`, `templates/`, `docs/`, `.github/` (audit §B5, §H4). Belt-only; full taxonomy enforcement remains Sub-Playbook C.
- [x] **M4.23** Q2=A applied (Q4=A also informs this) — `findCocoderHome` fails closed (returns null on no-match) (audit §B6, §H7). Split `resolveInstallRoot()` vs `resolveWorkspaceRoot()`. `handleConfig` switches to `findCocoderHome()`. `config set` gains `--workspace-root` flag mirroring `config get`; bare `config set` always writes install-local; `--install` accepted as no-op alias. Add `setWorkspaceConfigValue()` (audit §H3). Document the model in `docs/configuration.md`.
- [x] **M4.24** Q4=A applied (→ ADR-0006) — Implement `resolveActiveWorkspaceRoot()`: precedence is `--workspace-root=<path>` → cwd ancestor walk for `cocoder/AGENTS.md` (the install dogfood is the only legitimate workspace-inside-install case) → fail with a friendly error (audit §H7). `cocoder init` refuses inside install repo with the canonical error from ADR-0006 §Decision step 3. Ship regression tests that exercise both the refusal path and the dogfood pass-through. Document the constraint prominently in `docs/configuration.md`.
- [x] **M4.25** Q3=A applied — Default ephemeral run/report paths move to `local/workspaces/<slug>/runs/` per ARCHITECTURE L132-136 (audit §H5, §H6). Update `DEFAULT_RUNS_DIR` resolution to read from the registry entry, not the flat `local/runs` constant.
- [x] **M4.26** Q5=A applied — Keep the verification-artifact write-guard inline string in `launch.mjs` as canonical SSOT. Replace `orchestration-improvements.test.mjs` source-grep with a runtime test that the guard string appears in generated launch prompts (audit §B9). Prompt-fragment SSOT remains an explicit v0.2 option if per-workspace override becomes necessary.
- [x] **M4.27** Q6=A applied — CLI emits a friendly error when invoked against workspace-scope intent from inside the CoCoder install repo without an explicit `--workspace-root=<path>` (audit §H7). Pair with the ADR-0006 error text so the wording is consistent.

#### Documentation updates (rolling)

- [ ] `docs/configuration.md` complete and current (per audit §M10 + Q-resolutions reflected)
- [ ] ARCHITECTURE.md "Validation and language policy" cross-references implemented packages
- [ ] `decisions/README.md` updated if any new ADR is authored from Q1–Q7 graduations
- [ ] `pending-decisions.md` top-line status flipped to "Resolved YYYY-MM-DD" once all Q answered
- [ ] `cocoder/PRIORITIES.md` Canon and blocked-on note updated to reflect M4 progress

**M4 Checkpoint:** [ ] All Free-wins (M4.1–M4.21) done; all Founder-gated tasks (M4.22–M4.27) either done or formally deferred via founder approval logged in Decision Log.

---

**Checkpoint:** [ ] All Expand milestones complete per Success Criteria below.

---

## Refine

*Sub-Playbook-internal Refine only. Program-level Refine (stranger test, two-workspace concurrency) lives in the Master.*

- [x] Audit pass completed and recorded in [`2026-05-22-foundation-audit.md`](./2026-05-22-foundation-audit.md) (2026-05-22)
- [ ] [`../pending-decisions.md`](../pending-decisions.md) Q1–Q7 resolved (top-line status "Resolved")
- [ ] Milestone M4 Checkpoint reached (free wins + founder-gated tasks done or formally deferred)
- [ ] Founder runs `pnpm install && pnpm -r test` on a clean clone — green
- [ ] Founder runs `cocoder validate-contracts` against the extracted core — green
- [ ] Founder runs `cocoder config get/set` round-trip and confirms `<CoCoder>/local/config.yaml` updated correctly
- [ ] Founder simulates multi-machine path portability by relocating the CoCoder folder to a different absolute path; resolver still finds registered workspaces via token expansion

**Checkpoint:** [ ] Sub-Playbook A locally validated AND audit remediation complete.

---

## Final Check

- [ ] Documentation Updates from Expand complete
- [ ] No `COB_ORCH_`, `cobuilder-build`, `cobuilder` (outside `*.example.*`), or `coder ` (the alias) references in `packages/`, `docs/`, or `templates/` — enforced by M4.15 CI gate
- [ ] CI green on `main`
- [ ] All checkboxes match reality
- [ ] Decision Log and Learnings current
- [ ] `<CoCoder>/local/` still gitignored; root `.gitignore` includes `*.env`, `.env.*`, `secrets/` (M4.2)
- [ ] [`../pending-decisions.md`](../pending-decisions.md) top-line status = "Resolved"; any graduated ADRs landed in `cocoder/decisions/`
- [ ] M4 Checkpoint reached
- [ ] Master Playbook's Progress table row for Sub-Playbook A flipped to **Complete**
- [x] Master Playbook's `P-S1` and `P-S2` checked *(audit §M11: Master `[x]` is canonical; mirrored here 2026-05-22)*
- [ ] [`2026-05-22-dogfood-ramp.plan.md`](./2026-05-22-dogfood-ramp.plan.md) Preconditions unblocked — Sub-Playbook E may start immediately upon A close

---

## Decision Log

| Date | Decision | Rationale | Alternatives |
|---|---|---|---|
| 2026-05-21 | Sub-Playbook A scope = M1 + Solve + M6 + M2 only | Personas, Oz, docs, dogfood each have distinct risks better served by separate sub-Playbooks | All-in-one (original V1) |
| 2026-05-21 | Extraction is manifest-driven (E2.1) | A 30k-line port without a written manifest leaks stale assumptions; the manifest forces explicit per-file transformation decisions | Sub-task-only decomposition without manifest |
| 2026-05-21 | TS CLI wrapper sits on `.mjs` core (ADR-0004 confirmed at sub-Playbook level) | Behavior preservation in core; types at the public boundary | Rewrite core in TS during port |
| 2026-05-21 | `--merge` planner proves out here; apply lands in Sub-Playbook B | Resolver-side proof unblocks B; full `init` integrates with workspace template | Defer entirely to B |
| 2026-05-22 | Audit run mid-Expand; Milestone M4 added; Canon advanced to Refine | Audit found 9 critical + 15 high-risk gaps that block A closure; remediation tracked as a dedicated milestone preserves WISER discipline rather than retrofitting tasks into M1–M3 | Defer findings to v0.2 (rejected — orchestration-from-install foot-gun is real); slam through in single session (rejected — Q1–Q7 need founder decisions) |
| 2026-05-22 | Sub-Playbook E (Dogfood Ramp) opened as a downstream sub-Playbook gated on A's M4 Checkpoint | Orchestration on self is the v0.1 product proof and must not wait for full Sub-Playbook B; E pulls a thin slice of B forward (Bob+Talia+minimal artifacts) so the loop can be exercised | Roll into A as a new milestone (rejected — distinct WISER cycle with its own Refine warrants its own Sub-Playbook); wait for B (rejected — months of latency before first dogfood proof) |

---

## Learnings

| Date | Learning | Impact |
|---|---|---|
| 2026-05-21 | V1 Solve had three tasks; resolver needed seven sub-tasks to actually prove the invariant | Solve task count is driven by edge cases, not aesthetic minimalism |
| 2026-05-22 | Audit pass surfaced 9 critical blockers under apparently-green Expand (CoBuilder branding incomplete, CLI path stale, `findCocoderHome` falls back silently, `orchestrator-commit` allows product writes) | Refine-phase audit before claiming completion is non-negotiable on a port of this size; "tests pass" ≠ "invariants hold" |
| 2026-05-22 | Inline tests claimed Solve fixtures S1.3/S1.5/S1.6 done without materializing `tests/fixtures/` trees | Strict task wording matters; inline tests prove invariants but don't satisfy "write fixture" language. Bias toward materializing the artifact the task actually describes, not the nearest functional equivalent. |

---

## Resume Instructions

1. Read the Master Playbook (`../README.md`) Decision Log and Progress.
2. Read ADRs 0001, 0003, 0004, **0005** (Oz improvement routing; gates M4.22).
3. Read `ARCHITECTURE.md` ignore matrix, multi-machine portability, validation policy, **Oz daemon security model**, and **Oz improvement routing** sections.
4. Read this Sub-Playbook end-to-end.
5. Read [`2026-05-22-foundation-audit.md`](./2026-05-22-foundation-audit.md) — the canonical evidence backing Milestone M4.
6. Check [`../pending-decisions.md`](../pending-decisions.md). If any of Q1–Q7 are still Open, founder must answer before any M4 task tagged `gates: Q#` starts. Free-of-decision M4 tasks (M4.1–M4.21) can proceed in parallel.
7. Check Progress below for current task; continue from documented next action.
8. If resuming mid-M4: re-run `pnpm -r test` first; then execute M4 tasks in the order shown.
9. When all of M4 is done + Q1–Q7 resolved: re-run Refine and Final Check; flip Master Playbook row to Complete.

---

## Progress

**Last worked:** 2026-05-23 (v0.1 completion plan Item 1 closed — ticket 0001 Path B retire — and Item 2 checkbox-refresh batch landed; foundation plan now reflects reality after the 8 audit §4 port-row + 5 M4 free-win drifts were ticked)
**Current Canon:** Refine (audit remediation; all founder-gated tasks done; audit §4 port-first list CLOSED 12 of 12; remaining free-wins M4.5–M4.14, M4.16–M4.21 still open and tracked under [v0.1 Completion Plan Item 2](./2026-05-23-v0.1-completion.plan.md#item-2--sub-playbook-a-m4-free-wins-cleanup))
**Next action:** Continue Item 2 — group remaining M4 items (M4.5–M4.14, M4.16–M4.21) by file and land each as its own auto-merge PR. After M4 Checkpoint, Sub-Playbook B (Item 3 — adopter onboarding) activates.

| Canon | Items | Done | Status |
|---|---|---|---|
| Witness | 1 | 1 | Complete |
| Interrogate | 7 risks + reuse check | 7 + 1 | Complete |
| Solve | 7 | 4 (S1.1, S1.2, S1.4, S1.7) | Mostly complete; S1.3/S1.5/S1.6 fixture trees rescoped under M4.E2.2e |
| Expand | M1: 7 · M2: 11 · M3: 6 · **M4: 27** | M1: 7, M2: 11 (E2.2e fully closed 2026-05-23; E2.4 closed by M4.4), M3: 6 (E3.5 re-ticked 2026-05-23 by M4.10), M4: 26 (M4.1–M4.11, M4.13–M4.27 except M4.12) | **Active** |
| Refine | 7 (was 4; 3 audit-driven added) | 1 (audit complete) | Active |
| Final Check | 9 (was 7; 2 audit-driven added) | 1 (M11 P-S1/P-S2 mirror) | Not started |
| **Total** | **74** (was 42; M4 + audit additions) | **68** | **Active (Refine)** |

---

## Success Criteria

- [x] `pnpm install` succeeds on a clean clone of CoCoder
- [ ] `pnpm -r test` green on macOS-14 Node 20 (CI) — includes ported tests E2.2e.1–E2.2e.11 (E2.2e.12 retired 2026-05-23 per ticket 0001 Path B)
- [x] `pnpm -F core test config-resolver` green (Solve fixtures — inline; fixture trees pending M4 if Q7-Standard chosen)
- [x] `cocoder validate-contracts` exits 0
- [x] `cocoder config get/set` round-trips successfully
- [ ] Zero `COB_ORCH_`, `cobuilder-build`, or `cobuilder` (outside `*.example.*`) references in tracked CoCoder artifacts — enforced by M4.15 CI gate
- [x] Multi-machine portability proven via inline test (full fixture tree in M4 if Q7-Standard chosen)
- [x] `cocoder init --merge` planner correctly identifies new tracked files vs user-edited tracked files (inline test)
- [ ] [`../pending-decisions.md`](../pending-decisions.md) resolved
- [ ] M4 Checkpoint reached
- [ ] Master Playbook P-S1 and P-S2 checked
