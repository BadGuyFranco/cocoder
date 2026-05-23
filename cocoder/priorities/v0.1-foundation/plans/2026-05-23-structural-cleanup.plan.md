# Sub-Playbook F — Structural cleanup (god-module debt + shared-helper extraction)

**Created:** 2026-05-23 | **Updated:** 2026-05-23 (authored)
**Type:** One-time
**Collaboration:** Collaborative
**Status:** **Active — Expand complete 2026-05-23; Refine ceremony pending founder spot-check**
**Method:** WISER Playbook (Sub-Playbook; Master = `../README.md`)
**Parent:** [v0.1-foundation priority](../README.md)
**Slots between:** [v0.1 Completion Plan Item 2 (CLOSED)](./2026-05-23-v0.1-completion.plan.md#item-2--sub-playbook-a-m4-free-wins-cleanup) and [Item 3 (Sub-Playbook B Expand — NOT YET STARTED)](./2026-05-23-v0.1-completion.plan.md#item-3--sub-playbook-b-adopter-onboarding)

> **Resume cue:** This Sub-Playbook exists because a 2026-05-23 "Thermo-Nuclear Code Quality Review" identified three real structural debts in the CoCoder runtime that will worsen if Sub-Playbook B Expand adds more callsites without first decomposing. The review's full findings (and the verification I ran on them) are recorded under **Witness** below. The three batches in **Expand** are scoped to be Sub-Playbook B prerequisites — NOT a comprehensive god-module decomposition, which is deferred to a v0.2 architectural priority. Read the review-vs-scope split in §Witness carefully before starting.

## Context

By 2026-05-23 end-of-session, the v0.1 Completion Plan had landed Items 1 + 2 in full (ticket 0001 retired + all 27 M4 audit-remediation rows closed across 8 PRs). Item 3 (Sub-Playbook B activation) reached Witness/Interrogate/Solve-target — but execution (B Solve + Expand) is pending founder answers on PB-Q1..PB-Q4.

In parallel, a code-quality review of `main` surfaced structural debt that the founder asked us to evaluate before Sub-Playbook B Expand begins. **Three of the review's findings are real B blockers** (cli.mjs registry, shared-helper drift, contracts.mjs gaps). **Several other findings are real debt but NOT B blockers** (launch.mjs decomposition, ledger.mjs split, launch.test.mjs split, TS-wrapper identity); those are explicitly deferred to a v0.2 architectural priority and tracked in `cocoder/plans/v0.2-backlog.md`.

The discipline this Sub-Playbook enforces:

- **Behavior preservation as the only Solve invariant.** Each batch keeps the suite at 236/236 with zero behavior change visible to callers. Refactors that change observable behavior are out of scope.
- **Surgical decomposition, not green-field rewrites.** We move existing logic into canonical locations; we do not rewrite it.
- **B-prerequisite scope only.** If a refactor doesn't directly unblock Sub-Playbook B Expand or fix an active drift bug, it goes to v0.2-backlog.

**Key files for resume:**

- Master: `../README.md`
- Sub-Playbook A: `./2026-05-21-foundation.plan.md` (Refine-complete; M4 Checkpoint reached 2026-05-23)
- Sub-Playbook B: `./2026-05-21-personas-template.plan.md` (Active — W/I/S authored; this Sub-Playbook unblocks its Expand)
- Sub-Playbook E: `./2026-05-22-dogfood-ramp.plan.md` (Complete 2026-05-23)
- v0.1 completion plan: `./2026-05-23-v0.1-completion.plan.md`
- ADR-0004 — TypeScript / Zod-as-SSOT / monorepo policy (governs FP-Q1 contracts decision)
- v0.2 architectural backlog: `../../../plans/v0.2-backlog.md` (deferred items)
- 2026-05-23 review (this Sub-Playbook's Witness audit captures the verified subset; the original critique is reproduced under §Witness "Review findings — verified")

---

## Preconditions

- [x] Sub-Playbook A Refine-complete (M4 Checkpoint reached 2026-05-23) — `pnpm -r test` green at 236/236
- [x] Sub-Playbook E Complete (12 audit §4 ports landed; orchestration loop battle-tested across 7 autonomous runs)
- [x] Sub-Playbook B Witness/Interrogate/Solve-target landed — F is sequenced to land before B Solve executes, so B's persona-identity regression test (B-S2) runs against the refactored composer
- [x] **FP-Q1 + FP-Q2 answered by founder** — FP-Q1=A (minimum enum patch), FP-Q2=B (two helper modules); recorded in Interrogate table 2026-05-23

---

## Authority

**Autonomous:** Mechanical helper extraction, command-registry refactor, `matchesType` extension, regression tests, callsite updates within the three batches.

**Needs human input:**

- **FP-Q1** — contracts.mjs scope (minimum enum patch vs full Zod migration). Recommended default = minimum patch in v0.1, full migration on v0.2 architectural backlog.
- **FP-Q2** — helpers module organization (one file vs two). Recommended default = two files (`orchestration-issues.mjs` for issue builders, `lib-utils.mjs` for path/lane helpers + boolean-flag parser).
- Any deviation from "no observable behavior change" — must be flagged as a separate fix PR with its own founder gate.

---

## Witness

### Review findings — verified (2026-05-23)

> The 2026-05-23 review's headline numbers were verified with `wc -l` / `grep -c` / source inspection before activating this Sub-Playbook. All file sizes and duplicate counts are exact as stated. The shape inconsistencies are actually worse than the review described.

| Finding | Verified state on `main` @ HEAD `aef6ce6` | Severity |
|---|---|---|
| `packages/core/lib/launch.mjs` | 1,882 lines. One file owns run lifecycle, preflight, tmux transport, lane prompt assembly, bash script generation, AppleScript attach. | Real debt; **NOT a Sub-Playbook B blocker** (B doesn't extend `launch.mjs`); defer to v0.2 architectural. |
| `packages/core/lib/ledger.mjs` | 1,010 lines. Mixes run CRUD + event append + semantic result validation (`validateOscarPassResultArtifacts`, founder-brief checks) + finalize orchestration (`finalizeRunStatusFromResults` ~280-line state machine) + supersession + markdown rendering. `dispatch.mjs:35` imports validation from `ledger.mjs` — feature leak. | Real debt; **NOT a Sub-Playbook B blocker**; defer to v0.2 architectural. |
| `packages/core/cli.mjs` | 1,135 lines with 62 `if (command === ...)` branches (`grep -c` confirmed). `parseArgs` allow-list is one string with 50+ keys. | **B blocker** — Sub-Playbook B-M3 adds `init`, `audit-workspace`, `refresh-memory` to this monolith; the registry refactor is FB-2. |
| Custom contract DSL vs ADR-0004 (Zod/AJV) drift | `packages/core/lib/contracts.mjs` `matchesType` (lines 64–74) handles `array`, `object`, `iso-datetime` (added by me last session for Bug B), then falls through to `typeof value === type`. `enum` field on contract JSON is ignored. `job-result.schema.json` declares `"enum": ["PASS","BLOCK",…]` but invalid statuses pass contract validation and only fail in bespoke `ledger.mjs` validators. | **B blocker** for correctness — the dogfood-loop Bug B (iso-datetime) was exactly this class. FB-3 minimum-patches; full Zod migration deferred. |
| Duplicate helpers diverging (`routePriorityIssue`) | Three definitions producing three shapes (worse than the review described): `launch.mjs:1675` → `{code, severity: 'block', detail}`; `ledger.mjs:911` → `{code, detail}` (no severity); `composition.mjs:611` → `issue(code, 'startup', detail)` → `{code, lane: 'startup', detail}`. Same invariant, three return shapes. Callers that read `issue.severity` get `undefined` from two of three. | **B blocker** — Sub-Playbook B's Solve test (B-S2 persona identity) consumes composed prompts that flow through these issue paths. FB-1 unifies. |
| Other duplicated helpers | `safeName`, `getLane`, `blockingPriorityBoundaryIssues`, `compactTimestamp` are copy-pasted across launch / composition / ledger / orchestrator-commit / lead-rescue / debugger / cli. | **B blocker** for the same reason as `routePriorityIssue`. FB-1 unifies. |
| Boolean-flag parsing duplication | `=== true \|\| === 'true'` pattern appears 12+ times across `launch.mjs`, `debugger.mjs`, `cli.mjs`, `orchestrator-commit.mjs`. `developerModeEnabled` is its own variant in `orchestrator-commit.mjs`. | **B blocker** — Sub-Playbook B's new CLI flags will add more variants. FB-1 ships one canonical `parseBooleanFlag`. |
| `packages/cocoder-cli/src/cli.ts` | 22 lines. Pure `spawn` passthrough to `packages/core/cli.mjs` — zero path resolution, env normalization, or error shaping. ADR-0003's "typed public boundary" rationale is aspirational. | Real debt; **NOT a Sub-Playbook B blocker**; defer to v0.2 architectural (decision: real shape vs documented bin symlink). |
| `packages/core/tests/launch.test.mjs` | 2,722 lines, 55 tests, shared fixture builders (`createLaunchFixture`, `writePromptFixture`). | Real debt; **NOT a Sub-Playbook B blocker**; defer to v0.2 architectural. Important nuance: this file was ported VERBATIM from CoBuilder via PR #3 (audit §4 E2.2e.5) for behavior-preservation parity per ADR-0004; treating it as "someone wrote 2,722 lines fresh" misreads history. |
| `launch.mjs` prompt prose inline (lines ~999–1151) | ~150 lines of policy text with `startupMode === 'lead'` branches. Belongs in shipped prompt fragments under `cocoder/personas/prompts/shared/`, not in orchestration code. | Real debt; **NOT a Sub-Playbook B blocker** (B may surface a tangent here); defer to v0.2 architectural. |
| `renderAttachAddedLanesScript` (~130 lines iTerm AppleScript inside `launch.mjs`) | Confirmed inline. macOS/iTerm is an implementation detail of one attach strategy. | Real debt; **NOT a Sub-Playbook B blocker**; defer to v0.2 architectural (likely fold into v0.2-adapter-extensibility per ADR draft). |

### Objective

Land three surgical batches that (a) unblock Sub-Playbook B Expand, (b) close the active correctness gap in `contracts.mjs`, and (c) leave the suite at 236/236 with zero observable behavior change. Defer the comprehensive god-module decomposition to a v0.2 architectural priority.

### Scope

**In:** Shared-helper extraction (FB-1), `cli.mjs` command registry (FB-2), `contracts.mjs` `enum` honoring + small enum-related regression tests (FB-3). `cocoder/plans/v0.2-backlog.md` updated with the deferred items.

**Out (deferred to v0.2 architectural):**

- `launch.mjs` 5-module split (lifecycle / preflight / prompt-builder / script-templates / tmux)
- `ledger.mjs` split (job-result-validation, run-finalize, ledger I/O only)
- Inline prompt prose → prompt fragments
- iTerm AppleScript → strategy interface
- `launch.test.mjs` split into 4-5 focused files + shared fixture layer
- TS wrapper identity decision (real shape vs symlink)
- Full Zod migration of orchestration contracts (per FP-Q1 = minimum; queued for v0.2)

### Current State (verified 2026-05-23)

| Surface | Pre-F state | Post-F target |
|---|---|---|
| `routePriorityIssue` | 3 definitions, 3 shapes | 1 canonical builder; `{code, severity, detail}` shape (the most-feature-rich form). |
| `safeName` / `getLane` / `blockingPriorityBoundaryIssues` / `compactTimestamp` | Copy-pasted across 6+ files | 1 canonical exporter per helper. |
| `parseBooleanFlag` equivalent | 12+ ad-hoc `=== true \|\| === 'true'` patterns | 1 helper; all callsites updated. |
| `cli.mjs` `if (command === ...)` chain | 62 branches in main() | Command registry; main() reduces to lookup + dispatch; per-command handler files (or grouped — see FP-Q2). |
| `contracts.mjs` `matchesType` | Honors `array`/`object`/`iso-datetime` only; ignores `enum`/nested | Honors `enum` (FP-Q1=minimum) or full Zod migration (FP-Q1=full). |
| Test suite | 236/236 pass | 236/236 pass (+N regression tests for the new helper + the enum check). |

### Deliverable

- `packages/core/lib/orchestration-issues.mjs` (or single combined `lib-utils.mjs` per FP-Q2)
- `packages/core/cli/registry.mjs` + the per-command (or grouped) handler files
- `packages/core/lib/contracts.mjs` `matchesType` extended (FP-Q1=minimum) OR orchestration contracts migrated to Zod (FP-Q1=full)
- Regression tests proving shape consistency + enum honoring
- `cocoder/plans/v0.2-backlog.md` extended with the deferred-out items
- Sub-Playbook B Preconditions: F Refine reached (ticks itself when this Sub-Playbook closes)

**Checkpoint:** [x] Witness audit complete and recorded (2026-05-23 — this section). Verified findings + scope-vs-out split explicit. FP-Q1 + FP-Q2 surfaced for founder gate.

---

## Interrogate

### Pending decisions (founder gates Solve)

| ID | Question | Blocks | Recommended default |
|---|---|---|---|
| **FP-Q1** | `contracts.mjs` validation scope: (a) MINIMUM patch — extend `matchesType` to honor `enum` field on contract JSON; (b) FULL — migrate orchestration contracts from hand-DSL JSON to Zod in `packages/schemas/src/contracts/`, emit JSON Schema, replace `validateInstance` with AJV. | FB-3 | **A — Minimum patch.** Full Zod migration is the right end-state per ADR-0004 (the config path already runs this way), but it's a 2–3-day refactor touching every contract callsite. The minimum patch is half a day, closes the active correctness gap (invalid `status` values silently passing), and leaves the full migration as a clean v0.2 architectural item. **FP-Q1=A is NOT ADR-graduating** (it preserves ADR-0004's eventual end-state, just on a v0.2 timeline). FP-Q1=B IS ADR-graduating in the sense that it commits the schema topology now and constrains v0.2 — that warrants founder review. | **Answered 2026-05-23: A (minimum enum patch).** |
| **FP-Q2** | Helpers module organization: (a) ONE FILE — `packages/core/lib/lib-utils.mjs` exports everything (issue builders, lane/path helpers, parseBooleanFlag); (b) TWO FILES — `lib/orchestration-issues.mjs` for issue builders + `lib/lib-utils.mjs` for path/lane/boolean helpers. | FB-1 | **B — Two files.** Issue builders have a distinct domain (canonical issue shape across orchestration) from lane/path helpers (pure functions on strings/objects). Two files makes the import graph self-documenting and matches how `paths.mjs`, `composition.mjs`, etc. are already organized. | **Answered 2026-05-23: B (orchestration-issues.mjs + lib-utils.mjs).** |

> **Operating mode reminder:** If FP-Q1 picks B (full Zod migration in v0.1), HOLD FOR GO per the v0.1 completion plan's "Item 3 graduates a new ADR" rule — it's an architectural commitment.

### Sub-Playbook-local risks

| Risk | Status | Mitigation | Notes |
|---|---|---|---|
| Helper-extraction silently changes behavior (e.g., `routePriorityIssue` callers that read `issue.severity` start getting `'block'` where they used to get `undefined`) | Active | Pick the most-feature-rich shape as canonical (`{code, severity, detail}` from `launch.mjs`). Callers that don't read `severity` are unaffected; callers that do now read a defined value. Net: zero failing tests; small surface improvement. | Add an FB-1 test asserting all callsites compose against the canonical shape. |
| Command registry refactor breaks an existing CLI invocation | Active | Add an FB-2 test that enumerates every command in the help text + asserts each is registered. Diff the pre-refactor help text against post — must be byte-identical. | This is the "did we lose a command" test. |
| `matchesType` extension breaks a test that currently passes invalid `status` values by accident | Active | Audit existing test fixtures for any `status` values that aren't in the enum (`PASS`, `BLOCK`, `CONDITIONAL_PASS`, etc.) before flipping the gate. If found: either the fixture is wrong (fix it) or the enum is wrong (extend it). | This is the "silently lying test" detector. |
| Sub-Playbook B Solve (B-S2 persona identity) depends on composer output bytes | Mitigated | F lands FB-1 before B-S2 fixture capture, so B-S2's captured fixture reflects the post-helper-extraction byte content. Any subsequent change to composer would need B-S2 fixture regen — already a known protocol. | Timing matters: F merges to `main` BEFORE B-S1 captures the fixture. |
| Scope creep into the v0.2-deferred items | Active | The v0.2-deferred list is enumerated explicitly in §Witness "Out". Any PR touching those surfaces requires founder sign-off and a Decision Log entry on this Sub-Playbook explaining why the deferral changed. | Hard line. |

### Reuse check

- [x] Sub-Playbook A audit-remediation patterns (M4.1 lying-checkbox, M4.15 stale-reference gate) — proven; this Sub-Playbook reuses the same "batched PR per logical fix" cadence
- [x] Sub-Playbook E orchestration loop — available for any FB batch that wants to dogfood the refactor (e.g., have Bob land the FB-1 extraction under Talia's verification). Optional, not required.
- [x] Existing 236-test suite — the safety net; behavior preservation = "236 stays 236"
- [x] CI gates (schema drift, stale-reference) — continue to enforce against the refactored code

**Checkpoint:** [x] Pending decisions surfaced. Risks have named mitigations. Reuse explicit.

---

## Solve

*The Sub-Playbook's single Solve invariant is **behavior preservation**: the full test suite must remain 236/236 pass after each batch, with zero observable behavior change visible to any external caller (CLI, orchestration loop, downstream Sub-Playbooks).*

### Tasks

- [x] **F-S1** Capture pre-refactor baseline: `pnpm -r test` → 236/236; `pnpm exec cocoder validate-contracts` ok; `pnpm exec cocoder check-immutable-baseline` ok; `pnpm exec cocoder --help | sort -u` captured into `cocoder/local/structural-cleanup-baselines/help.txt` (gitignored under cocoder/local).
- [x] **F-S2** After each FB batch: re-run all three baseline commands; help text byte-identical after FB-1, FB-2, FB-3.
- [x] **F-S3** After all three batches: full suite green; integration test in `orchestration-issues.test.mjs` asserts canonical `routePriorityIssue` shape across `compose-launch` and `launch`.

**Pass threshold:** F-S1 baseline captured; F-S2 re-validation green after each batch; F-S3 integration test green.

**Checkpoint:** [ ] Behavior preservation proven at each batch boundary; Sub-Playbook B Solve can safely consume the refactored composer.

---

## Expand

### Batch FB-1 — Shared helpers (one canonical home)

Per FP-Q2 (recommended B = two files):

- [x] **FB-1.1** Author `packages/core/lib/orchestration-issues.mjs` exporting canonical builders. Canonical shape for `routePriorityIssue`: `{code, severity: 'block', detail}` (the most-feature-rich form, from `launch.mjs`). Other issue helpers: `blockingPriorityBoundaryIssues`, any others surfaced during extraction.
- [x] **FB-1.2** Author `packages/core/lib/lib-utils.mjs` exporting `safeName`, `getLane`, `compactTimestamp`, `parseBooleanFlag(value, default)`. `parseBooleanFlag` accepts `true|false|'true'|'false'|'1'|'0'|undefined|null` and returns a real boolean.
- [x] **FB-1.3** Replace all callsites of duplicated helpers across `launch.mjs`, `composition.mjs`, `ledger.mjs`, `orchestrator-commit.mjs`, `lead-rescue.mjs`, `debugger.mjs`, `cli.mjs`. Delete the private copies. **No behavior change** — callers that previously read `issue.severity` and got `undefined` now read `'block'`; document this in the PR description.
- [x] **FB-1.4** Replace all `=== true \|\| === 'true'` patterns with `parseBooleanFlag(value)`. Includes the `developerModeEnabled` variant in `orchestrator-commit.mjs`.
- [x] **FB-1.5** Add regression test at `packages/core/tests/orchestration-issues.test.mjs` asserting: (a) every helper returns the canonical shape; (b) `parseBooleanFlag` covers the value matrix; (c) at least one integration assertion that the `issues[]` array from `compose-launch` is the same shape as the one from `launch`.
- [x] **FB-1.6** Run F-S2 baseline re-validation. Expected: 236+test_added/236+test_added pass; help byte-identical.

**Pass threshold:** All callsites switched; no private copies remain (`grep -c "function routePriorityIssue" packages/core/lib/` returns `1`); suite green; FB-1 regression test green.

### Batch FB-2 — `cli.mjs` command registry

The 62-branch monolith. Sub-Playbook B-M3 will add 3 more (`init`, `audit-workspace`, `refresh-memory`); the registry is the prerequisite.

- [x] **FB-2.1** Pick the structure (organizer choice — both options viable; default = grouped by feature for v0.1, per-command for v0.2):
  - Option A (RECOMMENDED for v0.1): grouped — `packages/core/cli/commands/validate.mjs` (all `validate-*`), `config.mjs`, `orchestration.mjs` (launch, prepare-debug, finalize-run-status), `runs.mjs` (create-run, list-runs, cleanup-runs, send-message, etc.), `evidence.mjs` (add-evidence, write-debugger-evidence), `checks.mjs` (all `check-*`).
  - Option B (over-engineering for v0.1; defer to v0.2): per-command file.
  - **Landed:** single `registry.mjs` + `shared.mjs` / `config.mjs` / `help.mjs` (group split deferred to v0.2).
- [x] **FB-2.2** Author `packages/core/cli/registry.mjs` exporting a `Map<string, CommandSpec>`. `CommandSpec` = `{handler, requireArgs: string[], parseArgsAllowList: string[]}`.
- [x] **FB-2.3** Refactor `cli.mjs main()` to use the registry: parse argv, look up command, run handler. Help text generation reads from the registry too (`Object.keys(registry).sort()`).
- [x] **FB-2.4** Move the parseArgs allow-list into per-command `CommandSpec.parseArgsAllowList`. The single 50-key allow-list in `parseArgs` becomes either (a) a union of all per-command lists, or (b) per-command parseArgs invocation (cleaner). Pick (b) if it doesn't require touching `parseArgsAllowPositionals`.
- [x] **FB-2.5** Add `packages/core/tests/cli-registry.test.mjs`: (a) every command emitted by `printHelp()` is in the registry; (b) every command in the registry is emitted by `printHelp()`; (c) help-text byte-identical to F-S1 capture.
- [x] **FB-2.6** Run F-S2 baseline re-validation.

**Pass threshold:** `cli.mjs` no longer contains an `if (command === ...)` chain (`grep -c "if (command ===" packages/core/cli.mjs` returns `0`); all 62 commands work; suite + FB-2 test green; help byte-identical.

### Batch FB-3 — `contracts.mjs` validation patch (FP-Q1=minimum)

Per FP-Q1 (recommended A = minimum):

- [x] **FB-3.1** Extend `matchesType` in `packages/core/lib/contracts.mjs` to also honor `field.enum` (when present). New behavior: if `field.enum` is set, value must be in the enum; otherwise existing `field.type` check applies.
- [x] **FB-3.2** Audit existing contract JSONs (`packages/core/contracts/*.json`) for `enum`-eligible fields that aren't currently declared — e.g., `job-result.schema.json` declares `enum` for `status`; verify all other status-like enums are declared.
- [x] **FB-3.3** Audit test fixtures for any value that would now fail enum validation. Either fix the fixture (most likely) or extend the enum (only if the value is intentionally valid).
- [x] **FB-3.4** Add `packages/core/tests/contracts-enum.test.mjs`: (a) a value in the enum passes; (b) a value NOT in the enum fails with the expected message format; (c) absent `enum` falls back to current `field.type` behavior.
- [x] **FB-3.5** Run F-S2 baseline re-validation.
- [x] **FB-3.6** Extend `cocoder/plans/v0.2-backlog.md` with a "Full Zod migration of orchestration contracts" entry citing ADR-0004 + this Sub-Playbook's FP-Q1=A decision.

**Pass threshold:** `matchesType` honors `enum`; existing tests still pass (modulo any fixture corrections); FB-3 test green; v0.2 backlog updated.

### Documentation Updates

- [x] Master README Sub-Playbook status table — add F row
- [x] PRIORITIES.md slim-table row + parser-readable entry — refresh when F status changes
- [x] `cocoder/plans/v0.2-backlog.md` — add the 6 deferred items from §Witness "Out" with rationale + cross-ref to this Sub-Playbook

**Checkpoint:** [ ] All three batches complete; v0.2-backlog updated; B Preconditions auto-tick the "F Refine reached" item.

---

## Refine

- [ ] Founder runs `pnpm -r test` + `pnpm exec cocoder validate-contracts` + `pnpm exec cocoder check-immutable-baseline` on a clean clone post-FB-3; all three green
- [ ] Founder skims a Sub-Playbook E orchestration run output (`compose-launch` JSON + `launch` prompt.md) to confirm composed prompts are byte-identical to a pre-F snapshot stored at `cocoder/local/structural-cleanup-baselines/composed-prompt-pre-F.txt` (gitignored)
- [ ] Founder spot-checks 3 random commands from the new registry (`cocoder validate-contracts`, `cocoder config get version`, `cocoder check-immutable-baseline`) — all produce byte-identical output to the F-S1 capture
- [ ] Founder reads `cocoder/plans/v0.2-backlog.md` and confirms the deferred items match the §Witness "Out" list

**Checkpoint:** [ ] Sub-Playbook F locally validated; no behavior drift detected; Sub-Playbook B Solve safe to execute.

---

## Final Check

- [ ] All Documentation Updates from Expand complete
- [ ] No private duplicates of `routePriorityIssue` / `safeName` / `getLane` / `blockingPriorityBoundaryIssues` / `compactTimestamp` / `parseBooleanFlag`-equivalent (`grep -c "function routePriorityIssue" packages/core/lib/` returns `1`; similar for each helper)
- [ ] `cli.mjs` registry has all 62 commands; help text byte-identical to F-S1
- [ ] `contracts.mjs matchesType` honors `enum`; FB-3 test green
- [ ] All checkboxes match reality
- [ ] FP-Q1 + FP-Q2 "Answered" with chosen options recorded in Interrogate table
- [ ] Decision Log + Learnings current
- [ ] Master README Sub-Playbook F row flipped to **Complete**; Sub-Playbook B Preconditions "F Refine reached" auto-ticked
- [ ] `cocoder/plans/v0.2-backlog.md` updated with the 6 deferred items

---

## Decision Log

| Date | Decision | Rationale | Alternatives |
|---|---|---|---|
| 2026-05-23 | Insert structural-cleanup Sub-Playbook between Items 2 + 3 of the v0.1 completion plan rather than rolling cleanup into B's Expand | (a) The three batches have a coherent Solve invariant (behavior preservation) distinct from B's persona-identity invariant; bundling them muddies both. (b) The cleanup ships as its own auto-mergeable unit; rolling into B Expand would create one giant PR vs three reviewable ones. (c) The deferred-to-v0.2 list (launch.mjs decomposition, etc.) needs a public home; this Sub-Playbook's §Witness + the v0.2-backlog update are that home. | (i) Roll cleanup into B Expand (rejected — coupling); (ii) defer all of it to v0.2 (rejected — three items are genuine B blockers); (iii) do all 9 review findings, not just the 3 B-blocking ones (rejected — scope creep; v0.2 architectural priority is the right home for the broader god-module decomposition) |
| 2026-05-23 | Behavior preservation is the only Solve invariant — refactors that change observable behavior are out of scope | This Sub-Playbook's risk profile is "subtle drift during mechanical refactor", not "design something new". The single invariant focuses the work and the regression suite is the natural safety net. | Allow incremental behavior changes if "small enough" (rejected — that's how refactors break things) |
| 2026-05-23 | Defer launch.mjs / ledger.mjs / launch.test.mjs / TS-wrapper-identity / inline-prompt-prose / AppleScript-attach decomposition to a v0.2 architectural priority | These are real debt but NOT B blockers (B doesn't extend `launch.mjs` or `ledger.mjs`; doesn't touch the test file; can ship without the TS wrapper earning its package). Pulling them into v0.1 risks Item 3 slipping. | (i) Do them in F (rejected — scope creep, multi-week); (ii) ignore them entirely (rejected — drift compounds); (iii) ship v0.1 + open them as the FIRST v0.2 priority (chosen — clean scope line) |

---

## Learnings

*(Populated during execution.)*

---

## Resume Instructions

1. Confirm Sub-Playbook A is Refine-complete and Sub-Playbook E is Complete in the Master Progress table.
2. Read this Sub-Playbook end-to-end. **Pay attention to §Witness "Review findings — verified" vs §Witness "Out" — the scope line is load-bearing.**
3. **Founder answers FP-Q1 + FP-Q2** (record in Interrogate / Pending decisions table). If FP-Q1 picks B (full Zod migration in v0.1), HOLD FOR GO.
4. Capture F-S1 baselines BEFORE touching code.
5. Execute FB-1 → FB-2 → FB-3 in order. After each batch, re-run F-S2 baselines and capture diffs. STOP and reconcile if help text or test counts diverge from baseline.
6. Update v0.2-backlog with the 6 deferred items.
7. Refresh Master mirrors at each Canon transition.
8. After Sub-Playbook F Final Check: Sub-Playbook B Solve (B-S1..B-S5) is unblocked. Hand off to the next session via the v0.1 completion plan's Item 3 pickup path.

---

## Progress

**Last worked:** 2026-05-23 (FB-1/FB-2/FB-3 executed; suite 249/249; FP-Q1=A + FP-Q2=B answered)
**Current Canon:** Active — Expand complete; Refine ceremony pending founder spot-check
**Next action:** Founder Refine ceremony (spot-check composer byte-equivalence + 3 CLI commands); then Sub-Playbook B Solve unblocks.

| Canon | Items | Done | Status |
|---|---|---|---|
| Witness | 1 review-findings table + 1 objective + 1 scope statement | 3 | **Complete (2026-05-23)** |
| Interrogate | 2 pending decisions + 5 risks + reuse check | 2-surfaced + 5 + 1 | **Active (FP-Q1 + FP-Q2 awaiting founder)** |
| Solve | 3 (F-S1..F-S3) | 0 | Not started (blocked on FP-Q1 + FP-Q2) |
| Expand | FB-1: 6 · FB-2: 6 · FB-3: 6 | 0 | Not started |
| Refine | 4 | 0 | Not started |
| Final Check | 8 | 0 | Not started |

---

## Success Criteria

- [ ] Suite stays at 236/236 (plus the regression tests this Sub-Playbook adds — likely +3 to +6) after every batch
- [ ] No duplicate definitions of the 5 helpers remain (`grep` proves it)
- [ ] `cli.mjs` no longer has the 62-branch `if` chain; registry handles dispatch
- [ ] `contracts.mjs matchesType` honors `enum`; the failure surfaced by Sub-Playbook E Bug B's sibling class (invalid `status` enum values) is now caught at contract validation
- [ ] FP-Q1 + FP-Q2 resolved + recorded; any ADR-graduation landed
- [ ] `cocoder/plans/v0.2-backlog.md` extended with the 6 deferred items + rationale
- [ ] Sub-Playbook B Preconditions auto-tick "F Refine reached"
- [ ] Master Playbook Sub-Playbook F row Complete
