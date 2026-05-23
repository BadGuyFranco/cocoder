# Session Log — CoCoder Meta-Project

Append-only log of work sessions. New entries at the **top**. One entry per meaningful session (not per tool call).

**Entry format:**

```
## YYYY-MM-DD — <one-line summary>

**Persona:** <who> | **Priority:** <slug> | **Plan:** <path-or-name>
**Outcomes:** <2–5 bullets>
**Next:** <specific next action>
```

---

## 2026-05-23 (continuation) — **v0.1 Completion Plan Item 3 — Sub-Playbook B Activated (Witness/Interrogate/Solve-target authored); Sub-Playbook E formally Complete**

**Persona:** AI (Bob) + Founder | **Priority:** v0.1-foundation | **Plan:** [`priorities/v0.1-foundation/plans/2026-05-21-personas-template.plan.md`](./priorities/v0.1-foundation/plans/2026-05-21-personas-template.plan.md) (activated) + [`priorities/v0.1-foundation/plans/2026-05-23-v0.1-completion.plan.md`](./priorities/v0.1-foundation/plans/2026-05-23-v0.1-completion.plan.md) Item 3

**Outcomes:**
- **Sub-Playbook B Status flipped Draft → Active.** Full Witness audit, Interrogate (6 risks + 4 pending decisions PB-Q1..PB-Q4 + reuse check), and Solve target (TWO invariants — persona identity preservation AND `cocoder init` idempotency — with B-S1..B-S5 task list) all authored in one pass. Replaces the 2026-05-21 placeholder Witness.
- **Four pending decisions surfaced for founder gate (PB-Q1..PB-Q4):**
  - PB-Q1 — workspace template: static fileset vs generated-from-dogfood (recommended A — static, dogfood validates rather than sources).
  - PB-Q2 — persona library scope in v0.1: all 7 vs minimum subset of oscar+bob+talia+phil (recommended B — minimum subset; **ADR-graduation candidate**; HOLD FOR GO if it ADR-graduates).
  - PB-Q3 — Phil custom-persona example: schema-only vs full working example (recommended B — full).
  - PB-Q4 — `docs/getting-started.md`: B-side stub now vs full Sub-Playbook D ownership (recommended A — B-side stub).
- **Solve invariants** (one new, one extending the existing stub):
  - B-S2: persona-identity regression test — composed prompt for a known Sub-Playbook E orchestration run is byte-identical to a captured reference fixture. Negative control: mutate slug → test fails.
  - B-S4: `cocoder init` idempotency regression test — re-run on the same target produces zero diff; user-edited tracked file is preserved on `--merge`; nesting attempt hits the ADR-0006 `COCODER_NESTED_WORKSPACE_FORBIDDEN` error.
- **Sub-Playbook E formally flipped Complete (2026-05-23).** Its Final Check item 6 (Sub-Playbook B Witness back-reference) was the sole remaining item; landed automatically when B activated. Status header + Progress table + Final Check checkbox all refreshed.
- **State mirrors refreshed:** Master README (Sub-Playbook A + E + B rows + Last worked + Next action), PRIORITIES.md slim-table row, v0.1 completion plan (Item 3 task list ticked through 3.6; 3.7 deferred to Expand).
- **Reuse check explicit:** Sub-Playbook B's Witness audit table directly references Sub-Playbook E's borrowed artifacts (Bob + Talia + 6 shared fragments) and inherits A's `--merge` planner + `assertWorkspaceNotNestedInsideInstall` + `setWorkspaceConfigValue` without modification. Closes the "B re-does E" risk explicitly.
- **No code changes; no test changes.** Suite remains 236/236 all-passing.

**Resume cue / Next:** **Founder reviews + answers PB-Q1..PB-Q4 in `2026-05-21-personas-template.plan.md` Interrogate section.** If PB-Q2 graduates to an ADR (v0.1-vs-v0.2 persona scope), HOLD FOR GO. Then a fresh session executes B Solve (B-S1..B-S5 — capture persona-identity reference fixture from a Sub-Playbook E run, author persona-identity + `cocoder init` idempotency regression tests, implement `cocoder init` apply step, manual smoke-test on a fresh out-of-tree repo). Sub-Playbook A Final Check ceremony (founder-driven manual smoke tests on a clean clone per Refine section) can parallel-track and does not block B.

---

## 2026-05-23 (continuation) — **v0.1 Completion Plan Item 2 CLOSED — Sub-Playbook A M4 Checkpoint reached (all 27 audit-remediation rows)**

**Persona:** AI (Bob) + Founder | **Priority:** v0.1-foundation | **Plan:** [`priorities/v0.1-foundation/plans/2026-05-23-v0.1-completion.plan.md`](./priorities/v0.1-foundation/plans/2026-05-23-v0.1-completion.plan.md) Item 2

**Outcomes:**
- **Sub-Playbook A Milestone M4 Checkpoint reached.** All 27 audit-remediation rows now `[x]`. Free-wins (M4.1–M4.21 minus the already-done founder-gated ones) landed across 7 batched auto-merged PRs in sequence:
  - **PR #17 — Checkbox refresh** (chore/m4-checkbox-refresh): the foundation plan's E2.2e.1, E2.2e.5–E2.2e.11 port rows + M4.1/M4.2/M4.3/M4.4/M4.15 free-win rows were ticked to match reality (they were done weeks earlier but the rows had never been flipped). Master README + PRIORITIES.md mirrors refreshed too.
  - **PR #18 — Group A (docs only)** (M4.17, M4.18, M4.19, M4.20): ARCHITECTURE.md target-section labels; `cocoder/memory/codebase-map.md` regenerated end-to-end; `packages/schemas/src/oz/README.md` split into Landed + Target sections; Master README "Key files" lists ADR-0001..0006 individually; P-S1/P-S2 reconciliation closure logged.
  - **PR #19 — Group B (templates + config)** (M4.9, M4.10, M4.21): `templates/install-local/config.example.yaml` `$schema` path fix (one `../` was missing); `templates/install-local/secrets/.gitignore` shipped with belt-and-braces root negation; ARCHITECTURE.md `<your-app>/cocoder/` layout block now documents the optional tracked `config.yaml` defaults layer.
  - **PR #20 — Group C (config hardening)** (M4.5, M4.6): `resolveConfig` now invokes `resolveSecretReferences` after merge + validate (gated by `resolveSecrets: true` default); `config get` defaults to UNRESOLVED display with `--reveal-secrets true` opt-in; `validateConfig` fails closed when schema missing with friendly "run `pnpm -F schemas build`" message + `allowMissingSchema: true` opt-out for test fixtures. 7 new regression tests.
  - **PR #21 — Group D (small surgical)** (M4.7, M4.8, M4.16): Quinn credentials canonical path moved to `cocoder/local/.quinn-credentials.json` (workspace-private, gitignored by inner rule) + tracked example template + belt-and-braces root rule; `cli.mjs check-doc-refs/check-adr-status-consistency/check-doc-freshness` default `decisionsDir` swapped from `repoPath('decisions')` (no such dir) to `repoPath('cocoder/decisions')`; `acceptance.mjs startupPacketProof` slug parameterized via `options.acceptanceFixtureSlug` (default `ACCEPTANCE-STARTUP-PROOF`, CoCoder-neutral).
  - **PR #22 — Group E (debugger cleanup)** (M4.13): `collectLaunchPreflight` no longer runs `zsh -n` against the three retired `.command` wrapper files (Path B fallout from ticket 0001); debugger prompt "## Debugger Git Authority" sections rewritten to describe the actual mechanism — the generated wrapper script reads `COCODER_ORCH_DEBUGGER_GIT_WRITE` at exec time and the founder sets it in the shell. `debugger.test.mjs` asserts new language + absence of all three retired wrapper-file refs.
  - **PR #23 — Group F (bash safety + git probe isolation)** (M4.11, M4.14): `session.command` shellQuote'd in renderSessionWrapper fallthrough; `commandProbe` switched from `bash -lc "command -v ..."` to `/usr/bin/which`; git capability probes in launch.mjs + debugger.mjs both isolated into `.git/cocoder-capability-probes/` subdirectory instead of dropping `.lock`-looking files at the top of `.git/`. Audit's `--message "$@"` recommendation was INVERTED for this dispatcher's "all args → one --message value" contract; kept `"$*"` with inline justification comment. Bonus: caught a leaked-fixture issue mid-batch (`packages/core/tests/.tmp-launch-prompts-*` dirs from an aborted test run got swept into the commit) → squashed cleanup commit + added `.tmp-*/` ignore rule.
  - **PR #24 — Group G (baseline port)** (M4.12): authored `packages/core/baselines/regenerate.mjs` as the source-of-truth regenerator + intent doc; ran it to produce the initial 19-entry frozen snapshot at `packages/core/baselines/accepted-reference-baseline.md`. `pnpm exec cocoder check-immutable-baseline` now returns `ok: true` (was: parse-error / missing file). Initial CI fail because the regenerator's comment block contained a `cobuilder-build/build-personas/` literal that tripped M4.15's stale-reference gate; scrubbed the comment to use a generic phrasing in a follow-up commit. Both commits squash-merged.
- **Test suite progression in this session:** 229 → 236 (+7 from the M4.5/M4.6 regression tests in `tests/config-secret-resolution.test.mjs`). All passing across all 7 batches; no skips, no failures. `pnpm exec cocoder validate-contracts` ok at every batch boundary.
- **Sub-Playbook A is now Refine-complete.** Only remaining sub-Playbook A work is the Final Check ceremony (founder-driven manual smoke tests on a clean clone, listed in the Refine section). That can run in parallel with Sub-Playbook B activation.
- **Audit-vs-reality reconciliation:** in two cases the audit citations were inaccurate. M4.8 cited `composition.mjs:13` but the actual `repoPath('decisions')` defaults are in `cli.mjs:744,757,770`. M4.11 sub-fix #2 recommended `"$@"` but that would break the multi-word-message dispatcher contract; kept `"$*"` with inline rationale. Both noted in the respective PR descriptions + foundation plan closure rows so future readers don't get confused.

**Resume cue / Next:** **v0.1 Completion Plan Item 3 — Sub-Playbook B activation (Witness/Interrogate/Solve-target).** Multi-session work; this next session populates W/I/S only (Expand + Refine come later). HOLD FOR GO if any ADR-graduating decision surfaces (workspace-template structure is a likely candidate). After B reaches Solve checkpoint, Sub-Playbook A Final Check ceremony can close in parallel — both fold into v0.1 ship.

---

## 2026-05-23 — **v0.1 Completion Plan Item 1 closed — ticket 0001 resolved Path B (Retire); CoCoder is terminal-only**

**Persona:** AI (Bob) + Founder | **Priority:** v0.1-foundation | **Plan:** [`priorities/v0.1-foundation/plans/2026-05-23-v0.1-completion.plan.md`](./priorities/v0.1-foundation/plans/2026-05-23-v0.1-completion.plan.md) Item 1

**Outcomes:**
- **Founder picked Path B (Retire)** for ticket 0001 (`.command` wrapper restore/retire decision). CoCoder v0.1 ships terminal-only — `pnpm exec cocoder launch …` is the only invocation surface. Adopters wanting a one-click entry point can wrap it in a personal alias / Raycast script / Automator action.
- **`packages/core/tests/launch-command.test.mjs` deleted** (the 6 skipped tests asserted behavior of absent wrappers; no value remaining). Test totals: **235 → 229 (all passing)**, 0 skipped, 0 fail. `pnpm exec cocoder validate-contracts` ok.
- **Ticket 0001 moved** `cocoder/tickets/open/0001-...md` → `cocoder/tickets/closed/`; front matter updated (`status: Closed`, `closed: 2026-05-23`, `resolution: Path B — Retire`); History line appended; `cocoder/tickets/INDEX.md` mirror refreshed per SSOT rule (open table now empty; new "Recently Closed" row with resolution).
- **Sub-Playbook A foundation plan** E2.2e.12 row flipped `[ ]` → `[x]` with "Retired 2026-05-23 (Path B per ticket 0001)" note + cross-ref to closed ticket. Success Criteria port range updated to E2.2e.1–E2.2e.11 (E2.2e.12 explicitly retired). Sub-Playbook B (Item 3) inherits the terminal-only stance — no wrapper files in the workspace template.
- **`docs/configuration.md`** gained an "Invocation" section codifying terminal-only as the v0.1 product stance, with a pointer at the resolved ticket for the reasoning. Last-verified date refreshed to 2026-05-23 (and run count updated from 4 → 7 autonomous Sub-Playbook E runs, matching reality).
- **Drift surfaced (NOT fixed in this PR — Item 2 territory):** the foundation plan's E2.2e.1, E2.2e.5–E2.2e.11 rows are still `[ ]` even though SESSION_LOG + completion plan say all 12 ports landed across 7 autonomous runs. This is "lying checkboxes" of the same class M4.1 fixed back in May. Recommended: roll into the Item 2 (M4 free-wins) batch as a checkbox-refresh task — should take ~15 min.
- **Investigation note (not a product bug, but worth recording):** While verifying the suite, `launch.test.mjs:918` (`finalize-run-status refuses terminal teardown without founder approval`) failed reproducibly while the working tree had uncommitted edits in `cocoder/` or `packages/core/`. Root cause: `finalizeRunStatusFromResults` calls `auditDirtyBeforeTerminalize({ repoRoot })`, which is the post-2026-05-22 hardening that extended `DURABLE_ORCHESTRATION_PREFIXES` to include `packages/core/`. The test assumes a clean tree; it passes once changes are committed. Not blocking, but a future M4 free-win could either (a) make the test set up an isolated git repo per-fixture, or (b) skip-with-reason when run against a dirty repo so the failure mode is clearer than `expected: 'complete' actual: 'ready'`.

**PR + auto-merge:** opening PR for branch `feat/retire-launch-command-wrappers` now (2 commits — the docs/metadata changes + a follow-up that stages the test-file deletion that got unstaged mid-investigation; they collapse cleanly under squash-merge). Not on the hold-for-go list; auto-merges per protocol once CI green.

**Resume cue / Next:** Item 2 (Sub-Playbook A M4 free-wins cleanup — M4.5–M4.14, M4.16–M4.21). Recommended kick-off: re-read the foundation plan §"Milestone M4" task rows to enumerate exact open items, group by file, then land each as its own auto-merge PR. The checkbox-refresh task noted above is a natural first batch (low risk, ~15 min, cleans the SSOT picture before tackling the actual H1–M12 audit findings).

---

## 2026-05-22 (Afternoon) — **Session close — launch.test.mjs landed; v0.2 adapter-extensibility priority drafted**

**Persona:** AI (Bob) + Founder | **Priority:** v0.1-foundation + v0.2-adapter-extensibility (Draft) | **Plan:** N/A (session close)

**Outcomes:**
- **PR #3 merged** (`feat(launch): port audit §4 E2.2e.5 launch.test.mjs + close 4 product bugs`). Talia ported the 2,597-line CoBuilder source 1:1 (55 test names preserved); the port immediately surfaced 5 failing assertions = 4 distinct product-code gaps (audit §B4 prediction realized). All 4 fixes landed in the same PR + are now on `main`:
  - `renderAttachAddedLanesScript` hardened to use `tmux list-clients` TTY targeting + iTerm session iteration instead of `set baseWindow to current window` (which hijacked whatever iTerm window was focused).
  - `DURABLE_ORCHESTRATION_PREFIXES` extended from `['cocoder/']` to `['cocoder/', 'packages/core/']` so finalize-with-dirty correctly detects staged changes to the runtime, not just to the workspace meta-project.
  - `activeRunPreflight` + `findActiveRunsForPriority` ported from upstream — launch now refuses a second non-terminal run for the same priority+route with code `active-priority-run-exists`.
  - `--allow-concurrent-priority-run true` CLI flag threaded through `parseArgs` allow-list + the `launch` handler; sets `activeRunPreflight.override: true`.
- **Test count: 110 → 165** (+55 from `launch.test.mjs`). Audit §4 port-first list progress: **5 of 12 closed** (E2.2e.1 `core.test.mjs`, E2.2e.2 `dispatch.test.mjs`, E2.2e.3 `adapters.test.mjs`, E2.2e.4 `composition.test.mjs`, E2.2e.5 `launch.test.mjs`).
- **New priority drafted: `v0.2-adapter-extensibility`** at [`cocoder/priorities/v0.2-adapter-extensibility/README.md`](./priorities/v0.2-adapter-extensibility/README.md). Founder asked mid-session about Cursor SDK + cloud Kimi K2.6 — the adapter system today assumes `kind: llm-cli` (local tmux-driven CLI), which works for 5 existing CLIs (Claude Code, Codex, Grok, Gemini, Kimi-CLI) but doesn't fit cloud APIs or managed remote sessions. The new priority stakes out the design space: enum `llm-cli` / `llm-api` / `llm-managed-session` / `script` with per-kind runner contracts. Sequenced **after v0.1-foundation ships** (depends on Sub-Playbook C Oz dashboard for non-pane lane visibility). Status: Draft.
- **First successful exercise of the auto-merge protocol on real code**: PR #3 was on the manual-merge hold list (`launch.test.mjs` specifically); founder approved + I merged via `gh pr merge 3 --admin --squash --delete-branch`.
- **In-flight orchestrator-commit.test.mjs port paused before launch**: the new `active-priority-run-exists` preflight (from this same PR) caught 2 stale non-terminal runs in `local/workspaces/cocoder-dogfood/runs/` (`run-20260522T135114Z-2a946tah` — the Refine dry-render; `run-20260522T160453Z-nsluixnb` — the adapters port NEEDS_FOUNDER). This is the feature working as designed — the next session can either clean those run dirs (gitignored, no loss) or pass `--allow-concurrent-priority-run true`.

**Resume cue / Next session (start cold):**

1. **State of the world.** Branch: `main` (clean after this session-close PR merges). Test count: 165/165 pass. 5 of 12 audit §4 ports closed. Auto-merge protocol active (see memory: `cocoder-auto-merge-protocol`).
2. **Recommended next action: continue chaining audit §4 ports.** The orchestration loop is now battle-tested across 5 distinct runs; the founder approved auto-merge for the remaining 7 ports (E2.2e.6–E2.2e.12). To kick off port #6 (`orchestrator-commit.test.mjs`):
   ```sh
   cd "/Volumes/NAS LOCAL/CoCoder"
   # Option A: clean stale runs first (recommended; gitignored zone)
   rm -rf local/workspaces/cocoder-dogfood/runs/run-20260522T135114Z-2a946tah \
          local/workspaces/cocoder-dogfood/runs/run-20260522T160453Z-nsluixnb
   git checkout -b feat/port-orchestrator-commit-test
   # PRIORITIES.md "Active task" already points at orchestrator-commit (set in this session-close PR).
   pnpm exec cocoder launch \
     --profile cocoder/profiles/cocoder-dogfood.profile.json \
     --route cocoder/routes/dogfood-port-tests.json \
     --priority-slug v0.1-foundation \
     --workspace-root "/Volumes/NAS LOCAL/CoCoder" \
     --workspace-slug cocoder-dogfood \
     --developer-mode \
     --execute true
   # Then: watch the background watcher fire, validate Talia + Bob results, open PR, auto-merge.
   ```
   (Option B if you don't want to clean: add `--allow-concurrent-priority-run true` to the launch command. Less clean.)
3. **Alternative routes** if the audit §4 ports feel done enough for now:
   - **Sub-Playbook B (adopter onboarding):** workspace template + `cocoder init` + getting-started docs. Highest-leverage move for actual adopters.
   - **Sub-Playbook A free-wins:** M4.5–M4.14, M4.16–M4.21 in [`priorities/v0.1-foundation/plans/2026-05-21-foundation.plan.md`](./priorities/v0.1-foundation/plans/2026-05-21-foundation.plan.md). Mostly small remediations.
   - **Sub-Playbook C (Oz):** still gated on Sub-Playbook A close + B Solve, but the architectural scaffolding is in place.
4. **What's NOT next:** the new `v0.2-adapter-extensibility` priority. That's deliberately deferred — see its README §Preconditions.

**Founder bandwidth context:** founder is shifting from "build cocoder" mode to "use cocoder" mode — they want to start running the orchestration loop on real work, not just on test ports. The next-session pickup should treat that as the operating model: each port (or other task) is a normal PR-flow workstream, not a high-touch setup project.

---

## 2026-05-22 (Late Morning) — **Git initialized + pushed to GitHub**

**Persona:** AI (Bob) | **Priority:** v0.1-foundation | **Plan:** N/A (operational)

**Outcomes:**
- **GitHub repo live:** [`BadGuyFranco/cocoder`](https://github.com/BadGuyFranco/cocoder) — **private**, default branch `main`, single initial commit `af107a3` covering everything tracked-by-design through 2026-05-22 (Sub-Playbook A foundation + M4 work, Sub-Playbook E Solve + E3.3 + Refine + 4 audit §4 ports, 5 core bug fixes + regression tests, ADRs 0001-0006, dogfood config). 169 files / 23,740 insertions.
- **Root `.gitignore` shadowing bug found + fixed during the init**: the line `local/` was matching `cocoder/local/` at any depth, hiding the tracked inner `README.md` + `.gitignore` per ARCHITECTURE.md ignore matrix. Anchored to `/local/` so root install-private state stays ignored while the workspace-zone narrow-private dir's tracked files remain visible. The comment in the .gitignore had been warning about this exact failure mode but the fix wasn't applied; it is now.
- **Local git identity** set on the repo only (not global, per safety protocol): `Anthony Franco <anthony@francoinc.com>`.
- **Sensitive-file safety check** ran twice (pre- and post-`git add .`); zero hits on `*.env`, `secrets/`, `local/`, credential paths. The one path that triggered the substring filter, `packages/core/quinn/credentials.mjs`, is a credentials LOADER (reads at runtime from an untracked JSON file), not a credentials file. Safe.
- **gh CLI was already authenticated** as `BadGuyFranco` with `repo` + `workflow` scopes via keyring; no new auth required.
- **Future commits per founder's option-1 preference** (audit-finding closures separate from dogfood ramp deliverables) start with the NEXT change set — the initial commit is one consolidated baseline since nothing before this point was version-controlled.

**Resume cue / Next:** All session work is now in git and pushed. The next session can pick any of: (a) continue audit §4 ports with founder supervision on `launch.test.mjs` (E2.2e.5, "largest single port", 52 tests); (b) start Sub-Playbook B (full persona library + workspace template — now unblocked); (c) finish Sub-Playbook A M4 free-wins (M4.5-M4.14, M4.16-M4.21). Each future change set should land as its own commit. CI workflow at `.github/workflows/ci.yml` will run on the first PR opened against this remote.

---

## 2026-05-22 (Late Morning, autonomous extension) — **Two more audit §4 ports closed via proven orchestration loop**

**Persona:** AI (Bob orchestrating Talia, autonomous chained batch while founder elsewhere) | **Priority:** v0.1-foundation | **Plan:** Sub-Playbook A audit §4 port-first list (executing via the proven Sub-Playbook E orchestration loop)

**Outcomes:**
- **Two additional dogfood-orchestrated test ports closed back-to-back.** Each ran the now-mechanical loop: swap PRIORITIES.md task hint → `cocoder launch --execute true` → background watcher → Bob/Talia both write result.json → validate, capture, move on.
  - E2.2e.3 `adapters.test.mjs` ([`run-20260522T160453Z-nsluixnb`](./priorities/v0.1-foundation/local/workspaces/cocoder-dogfood/runs/)): Talia PASS + Bob CONDITIONAL_PASS, 7/7 test names preserved, 5,280 bytes, `pnpm -F core test adapters` = 93 tests pass. Bob's CONDITIONAL flag = real audit finding about `pnpm -F core test` pretest touching `packages/schemas/dist/*` mtimes outside Talia's write zone. Investigated: schema bytes are byte-stable across rebuilds (verified `shasum`). No actual schema drift; only a mtime-boundary technicality. Recorded as `PORT-NOTES.md` finding F (v0.2 follow-up; CI schema-drift gate already catches real drift).
  - E2.2e.4 `composition.test.mjs` ([`run-20260522T161135Z-i3wg7ti9`](./priorities/v0.1-foundation/local/workspaces/cocoder-dogfood/runs/)): Talia PASS + Bob PASS (clean — preempted Bob's CONDITIONAL concern by including the schemas-dist note in the task hint). 17/17 test names preserved, 24,097 bytes (largest port so far), `pnpm -F core test composition` = 110 tests pass. ~4-minute run.
- **Test count progression in chronological order:** 57 (session start) → 65 (composition-dogfood-bugfixes regression tests for 5 core bug fixes) → 75 (E2.2e.1 core.test.mjs) → 86 (E2.2e.2 dispatch.test.mjs) → 93 (E2.2e.3 adapters.test.mjs) → **110 (E2.2e.4 composition.test.mjs)**. All ports green; full suite passes.
- **Audit §4 port-first list progress:** 4 of 12 done (E2.2e.1–E2.2e.4); 8 remaining. Next per audit order: E2.2e.5 `launch.test.mjs` ("largest single port", 52 upstream tests; audit recommends pairing with M4.3 CLI path rename, which is done). Deliberately stopped autonomous batch here — `launch.test.mjs` warrants founder supervision due to size and complexity.
- **No new bugs surfaced** during the chained batch. The 5 bug fixes + sandbox gate from earlier today held cleanly across 4 distinct autonomous runs. Orchestration loop is now genuinely mechanical; each port takes ~4-7 minutes wall-clock.

**Resume cue / Next:**
1. Founder review + git initialization decision (no `.git` at this mount; all session edits uncommitted).
2. Then choose the next move: (a) keep going down audit §4 with founder eyes on `launch.test.mjs`; (b) start Sub-Playbook B; (c) finish Sub-Playbook A M4 free-wins (M4.5–M4.14, M4.16–M4.21); (d) close Sub-Playbook E formally and ship the v0.1 audit-finding closure commit.

---

## 2026-05-22 (Very Late Night) — **Sub-Playbook E Refine PASSED — orchestration loop reproducible**

**Persona:** AI (Bob orchestrating Talia, autonomous re-run while founder at gym) | **Priority:** v0.1-foundation | **Plan:** [`priorities/v0.1-foundation/plans/2026-05-22-dogfood-ramp.plan.md`](./priorities/v0.1-foundation/plans/2026-05-22-dogfood-ramp.plan.md) Sub-Playbook E (Dogfood Ramp) Refine

**Outcomes:**
- **Second orchestrated dogfood task complete.** Talia ported CoBuilder's `dispatch.test.mjs` → `packages/core/tests/dispatch.test.mjs` (12,219 bytes) autonomously in ~7 minutes. 11/11 source test names preserved per Bob's independent parity script. Both lanes wrote `status: PASS`. Run dir: `local/workspaces/cocoder-dogfood/runs/run-20260522T135126Z-t4rnd35z/`. Test count: **86/86 pass · 0 fail** (was 75; +11 from the second port).
- **Reproducibility proven.** Two distinct execute run dirs (`rwrkcfcg` for `core.test.mjs`; `t4rnd35z` for `dispatch.test.mjs`); zero out-of-zone writes across both. Talia self-attests `filesChanged` listing only the target test file + her own gitignored result artifacts in each run. Bob's mtime boundary check confirms only `dispatch.test.mjs` appeared as a newer non-generated source surface for the second run.
- **Faster second run.** First run took ~13 minutes (with the Bug E block-and-retry); second run took ~7 minutes (codex trust prompt cached from earlier runs; no bugs surfaced; orchestration mechanics now stable). Founder was at gym; no human intervention needed.
- **No new bugs surfaced** during Refine. The 5 fixes from earlier today held. Pre/post-Refine `pnpm -r test` both green.
- **PRIORITIES.md "Active task" updated for Refine before launch** — swapped from `core.test.mjs` to `dispatch.test.mjs` (source, target, translation rules, do-not-port list, DoD). Dry-render confirmed task hint propagated into startup-packet (4 hits) before going live. After Refine, the "Active task" remains pointing at `dispatch.test.mjs` since the next session may want to push the next port (E2.2e.3 `adapters.test.mjs`, etc.).
- **Sub-Playbook A E2.2e.2 closed** with run-`t4rnd35z` evidence. **Sub-Playbook E plan status → Final Check.** Refine checklist all green except audit-log (deferred to Sub-Playbook C per ARCHITECTURE.md ownership).

**Git status:** Still no `.git` at `/Volumes/NAS LOCAL/CoCoder`. None of the session's edits (5 product-code bug fixes from earlier, 2 dogfood test ports from runs, dogfood config files, state mirrors) are committed. Per founder's "spirit of option 1" directive: kept fixes + ports separable via clean SESSION_LOG entries so they can be staged into distinct commits once git is initialized. Bob's diagnostic findings from both runs explicitly call this out.

**Resume cue / Next:**
1. **Founder decision needed:** initialize a git repo here (`git init` + initial commit covering everything tracked-by-design), OR rebase this workspace into an existing CoCoder clone elsewhere on disk. Until that's resolved, nothing can be committed.
2. **Sub-Playbook E Final Check** is effectively done; the one remaining deferral (Sub-Playbook B Witness back-reference) lands when B starts.
3. **Open next priorities:** (a) continue the audit §4 port list — E2.2e.3 `adapters.test.mjs` next; (b) Sub-Playbook A free-wins M4.5–M4.14, M4.16–M4.21; (c) Sub-Playbook B start (now unblocked by E close).

---

## 2026-05-22 (Late Night) — **Sub-Playbook E E3.3 PASS — CoCoder built CoCoder end-to-end**

**Persona:** AI (Bob orchestrating Talia) | **Priority:** v0.1-foundation | **Plan:** [`priorities/v0.1-foundation/plans/2026-05-22-dogfood-ramp.plan.md`](./priorities/v0.1-foundation/plans/2026-05-22-dogfood-ramp.plan.md) Sub-Playbook E (Dogfood Ramp) E3.3

**Outcomes:**
- **First orchestrated dogfood task complete.** Talia ported CoBuilder's `core.test.mjs` into `packages/core/tests/core.test.mjs` (446 lines, 18,195 bytes) autonomously under the orchestration. Bob accepted with PASS after independent audit (diff against source, stale-reference rg, test run). Test count: **75/75 pass · 0 fail** (was 64; +11 from the port). Run dir: `local/workspaces/cocoder-dogfood/runs/run-20260522T133403Z-rwrkcfcg/`.
- **Write boundary respected.** Talia's `filesChanged` = `packages/core/tests/core.test.mjs` + her own result artifacts in the gitignored run dir. No mutation outside `packages/core/tests/`. No mutation in `cocoder/`, `docs/`, `templates/`, `.github/`.
- **First execute attempt failed cleanly + surfaced a fifth core bug.** Initial E3.3 (`run-20260522T132854Z-j55rci2s`) blocked because codex's default `--sandbox workspace-write` denies tmux IPC — the lead's `send-to-talia.sh` helper hit `Operation not permitted` on the orchestration socket. Bob followed his "do not repair orchestration mechanics" guard, wrote `status: BLOCK` with diagnostic findings, and Talia stayed correctly idle in `wait-for-lead-dispatch`. The graceful-failure path is part of the architecture, not a bug.
- **Bug E (sandbox vs lane role) fixed in flight.** `packages/core/lib/launch.mjs` `renderSessionWrapper` now gates the codex sandbox flag on `session.startupMode`: lead lanes get `danger-full-access` (so they can drive `tmux send-keys` for teammate dispatch); teammate / writer lanes stay on `workspace-write`. Function exported; 1 new regression test pinning both paths. Second execute (`run-20260522T133403Z-rwrkcfcg`) used the fix and went green end-to-end.
- **Full bug tally for the session:** 5 core bugs found + fixed during Sub-Playbook E (modelRoles null-vs-undefined, iso-datetime typecheck, PRIVATE_LEGACY false positives, parseArgs path.resolves slug, codex sandbox vs lane role). 8 new regression tests at `packages/core/tests/composition-dogfood-bugfixes.test.mjs`. Full suite `pnpm -r test` green at **75/75**.
- **State mirrors updated.** Sub-Playbook E plan status → "Active — Expand E3-E5 mid-flight"; E1 + E2 + E3.1–E3.4 boxes ticked with run-dir cross-references; Decision Log entry for Bug E; PORT-NOTES.md §"Source-of-truth conflicts" extended with Bug E. PRIORITIES.md + Master README mirrors reflect the milestone.
- **Sub-Playbook A E2.2e.1 closed** with proof = this run's `core.test.mjs` + its `pnpm -F core test core.test` PASS.
- **What did NOT happen:** Audit log entry at `local/audit/oz-actions.jsonl` (plan E4.4) — that file is an Oz daemon responsibility per ARCHITECTURE.md "Oz daemon security model" §6 and Oz is Sub-Playbook C. Marked deferred to C, not done at E.
- **What's still uncommitted:** 5 product-code edits (4 bug fixes from Solve + the sandbox gate from E3.3 retry), 1 new regression test file, the dogfood config files (personas, profile, route, boundary, manifest, port-notes), state-mirror edits, ci.yml exemption update. Founder will review before any commit.

**Resume cue / Next:** **Sub-Playbook E Refine** — repeat E3.3 against audit §4 E2.2e.2 (`dispatch.test.mjs`) to prove reproducibility. Two distinct run dirs in `local/workspaces/cocoder-dogfood/runs/`, no mutation outside `packages/core/tests/` across both runs. Founder authorization needed for the next execute. After Refine, Final Check + close Sub-Playbook E; then back to Sub-Playbook A free-wins (M4.5–M4.14, M4.16–M4.21) or start Sub-Playbook B (full persona library).

---

## 2026-05-22 (Night, mid-session) — Sub-Playbook E Solve closed; 4 core bugs surfaced + fixed end-to-end

**Persona:** AI (Bob) | **Priority:** v0.1-foundation | **Plan:** [`priorities/v0.1-foundation/plans/2026-05-22-dogfood-ramp.plan.md`](./priorities/v0.1-foundation/plans/2026-05-22-dogfood-ramp.plan.md) Sub-Playbook E (Dogfood Ramp)

**Outcomes:**
- **E-S1 Bob borrow + profile/route/boundary authored** — `cocoder/personas/bob.json` + `personas/prompts/personas/bob.md` + 6 shared fragments + `personas/prompts/manifest.json` (Bob-only); `cocoder/profiles/cocoder-dogfood.profile.json` (11 stubbed lane sub-keys, Bob is the only live writer); `cocoder/routes/dogfood-port-tests.json` (lead=bob, lanes=[bob], one-writer, `laneRequirements` declared); `cocoder/priority-boundaries/v0.1-foundation.boundary.json` (writer Bob, allowed=`packages/core/tests/`, excluded=all other product surfaces). `cocoder/PRIORITIES.md` got a parser-readable "## [v0.1-foundation]" heading section below the slim table (the extractor reads heading-style, not table rows — slim mirror preserved per AGENTS.md SSOT rule).
- **E-S1 composition green** — `cocoder compose-launch` returns `ok: true, status: ready, issues: []` against the dogfood files. `cocoder launch` (default `--execute=false`) writes a 153-line `prompt.md` per lane at `local/workspaces/cocoder-dogfood/runs/<run-id>/jobs/bob/prompt.md`. Both captured at `local/workspaces/cocoder-dogfood/solve-evidence/` (`composed-prompt-dry-run.json` for the readiness probe; `composed-prompt-dry-run.txt` for the rendered prompt).
- **E-S2 — 6 of 7 `rg` verifications green**, 1 correctly deferred to E3 (Talia task hint; not applicable to the Bob-only borrow at E-S1). Pass set: persona identity, playbook excerpt (priority slug `v0.1-foundation`), route lane definition, workspace context summary (`local/workspaces/cocoder-dogfood/runs/...` zone), allowed-write-zone (`packages/core/tests/` surfaces in `startup-packet.json`), refusal protocol (`VERIFICATION_ARTIFACT_GUARD_LINE` canonical inline; no duplicate after scrubbing the borrowed `shared/write-boundaries.md` per Q5=A).
- **Four core bugs surfaced + fixed** (regression coverage at `packages/core/tests/composition-dogfood-bugfixes.test.mjs`, 7 new tests, full suite `pnpm -r test` green at 64/64):
  - **Bug A** `packages/core/lib/model-roles.mjs:18` — `validateModelRolesSemantics` only short-circuited on `undefined`; `resolveModelRoles` returns `null` for empty-merged, slipping through and emitting "modelRoles must be an object when present" for every profile that didn't declare modelRoles. Fix: treat `null` like `undefined`.
  - **Bug B** `packages/core/lib/contracts.mjs:64-68` — `matchesType` had no case for `iso-datetime`; fell through to `typeof value === 'iso-datetime'` (always false). Blocked every `launch` invocation with `createdAt expected iso-datetime`. Fix: added strict ISO-8601 regex + `Date.parse` sanity check.
  - **Bug C** `packages/core/lib/composition.mjs:16-22` — `PRIVATE_LEGACY_REFERENCE_PATTERNS` was mechanically renamed from CoBuilder `build-personas/` → CoCoder `personas/`, which then false-positive'd every CoCoder manifest fragment path (`personas/bob.md` etc.). Fix: re-targeted patterns at CoBuilder paths directly (`cobuilder-build/build-personas/`, etc.); the check now detects upstream leakage (its original purpose) without breaking CoCoder's own surface.
  - **Bug D** `packages/core/cli.mjs:996` — `parseArgs` `path.resolve`d every flag value except an explicit string allow-list. M4.22's `--developer-mode` and M4.27's `--workspace-slug` were missing from that list, so `--workspace-slug cocoder-dogfood` became cwd-absolute. Run artifacts landed under `local/workspaces/<absolute-workspace-root>/cocoder-dogfood/runs/...`. Fix: added `workspaceSlug` + `developerMode` to the allow-list.
- **Plan-vs-reality reconciliation applied in-place** to `2026-05-22-dogfood-ramp.plan.md` per founder go-signal: profiles/routes are JSON (not YAML); `compose-launch` has no `--dry-run` flag (it IS the dry-run path); `--priority-slug` is required; `cocoder launch` (default no-execute) renders the prompt.md; profile contract requires 11 lane sub-keys; routes require `laneRequirements`; priority-boundary file required. Status flipped from "Draft" to "Active — Expand E1 (Solve closed 2026-05-22)". Decision Log + Progress + Success Criteria all refreshed. PORT-NOTES authored at `cocoder/personas/PORT-NOTES.md`.
- **No mutation outside Sub-Playbook E scope** — `packages/` edits are limited to the 4 bug fixes + the new regression test file. `cocoder/local/`, `templates/`, `docs/`, `.github/` untouched. Nothing committed (M4.22 belt undisturbed).

**Resume cue / Next:** Sub-Playbook E Expand E1 (Talia borrow) → E3.1 (Talia dry-render) → E3.3 (founder authorizes execute, shadows tmux pane). Talia's borrow + route lane extension + source/target task hint adds the 7th E-S2 verification. Remaining open M4 free-wins (M4.5–M4.14, M4.16–M4.21) still don't block E. The 4 core bug fixes are also closeable cross-references for Sub-Playbook A audit findings (cover parts of B6, B9, H4-adjacent).

---

## 2026-05-22 (Night) — Sub-Playbook A Milestone M4 founder-gated tasks executed (M4.22–M4.27)

**Persona:** AI (Bob) | **Priority:** v0.1-foundation | **Plan:** [`priorities/v0.1-foundation/plans/2026-05-21-foundation.plan.md`](./priorities/v0.1-foundation/plans/2026-05-21-foundation.plan.md) Milestone M4

**Outcomes:**
- **M4.22 (Q1-B)** — `--developer-mode` belt landed in `packages/core/lib/orchestrator-commit.mjs`. New exports `COCODER_PRODUCT_WRITE_PREFIXES`, `developerModeEnabled(explicit, env)`, `auditCocoderProductWriteBelt({filesChanged, developerMode})`. Belt fires before `auditImplementationProvenance` in both `commitAcceptedResult` and `commitLeadSupportChange`. Sourced from explicit `--developer-mode` flag or `COCODER_DEVELOPER_MODE=1` env. CLI `orchestrator-commit` and `lead-support-commit` handlers thread `args.developerMode` through. 11 new tests in `tests/developer-mode-belt.test.mjs` covering both env + flag paths, prefix set, false-positive guards, and detail-message assertions.
- **M4.23 (Q2-A + Q4-A)** — `findCocoderHome()` now fails closed (returns `null`); added `resolveInstallRoot()` that throws a friendly error pointing at `--cocoder-home`. All internal callers in `paths.mjs` and `config.mjs` switched off the cwd fallback. New `setWorkspaceConfigValue()` in `config.mjs` writes to `<workspace>/cocoder/local/config.yaml` and tags result `zone: 'workspace-local'`. CLI `config set` accepts `--workspace-root` (routes to workspace-local writer) and `--install` (no-op alias). `handleConfig` uses `resolveInstallRoot()` instead of the legacy `process.cwd()` fallback. Documented in `docs/configuration.md` (new "`cocoder config get` / `cocoder config set`" + "Workspaces and the install repo" sections). 7 new tests in `tests/install-root-fail-closed.test.mjs`.
- **M4.24 (Q4-A → ADR-0006)** — `resolveActiveWorkspaceRoot({workspaceRoot, startDir})` + `assertWorkspaceNotNestedInsideInstall(workspaceRoot)` added to `paths.mjs`. Canonical refusal error wired with `code === 'COCODER_NESTED_WORKSPACE_FORBIDDEN'` and the ADR-0006 §Decision step-3 wording. `planWorkspaceMerge()` in `init-merge.mjs` now invokes the assertion before any work. Dogfood pass-through (install root serving as its own workspace) verified — `findCocoderHome(dirname(installRoot))` walks ABOVE install where no markers exist. 9 new tests in `tests/workspace-detection.test.mjs` covering refusal, dogfood pass-through, explicit vs ancestor-walk paths, and `planWorkspaceMerge` integration. Pre-existing `init merge planner` test in `tests/config-resolver.test.mjs` updated to use sibling tmpdirs (the original fixture inadvertently put workspace inside install).
- **M4.25 (Q3-A)** — Ephemeral run/debug/check-report artifacts now resolve under `<install>/local/workspaces/<slug>/...` per ARCHITECTURE.md L132-136. Added `DEFAULT_WORKSPACE_SLUG = 'default'`, `workspaceArtifactsRoot`, `workspaceRunsRoot`, `workspaceDebuggerRunsRoot`, `workspaceCheckReportPath` helpers to `paths.mjs`. CLI: removed legacy `const DEFAULT_RUNS_DIR = repoPath('local/runs')`; introduced `resolveDefaultRunPaths(args)` helper. Updated 10 callsites (launch, create-run, continuation, cleanup, list-runs, prepare-debugger, and 7 check-* handlers) to use install-local resolution. 9 new tests in `tests/workspace-artifact-paths.test.mjs` confirming runs never leak back into the tracked `cocoder/` tree.
- **M4.26 (Q5-A)** — Verification-artifact write-guard refactored: exported constant `VERIFICATION_ARTIFACT_GUARD_LINE` + new exported builder `composeRuntimeRoleLines(session)` in `launch.mjs`. `renderLanePrompt` now spreads `...composeRuntimeRoleLines(session)`. Replaced the source-grep `tests/orchestration-improvements.test.mjs` with a runtime test that calls the builder directly and asserts the guard line appears in the output across multiple session shapes (canWrite true/false, routeOwnedCommit true/false). 4 tests in the replaced file.
- **M4.27 (Q6-A)** — `assertExplicitWorkspaceContextWhenInsideInstall({workspaceRoot, workspaceSlug, startDir})` added to `paths.mjs` with `code === 'COCODER_WORKSPACE_CONTEXT_REQUIRED'`. CLI gates `resolveDefaultRunPaths` and `compose-launch` with it before any silent install-binding. Treats the parseArgs sentinel string `'true'` and empty strings as missing so `--workspace-root` with no value still trips the gate. 6 new tests in `tests/friendly-cwd-error.test.mjs`.
- **Test totals:** `pnpm -r test` green — 57 unit tests pass (28 new across M4.22–M4.27 + 29 pre-existing). Stale-reference CI gates (`cobuilder|COB_ORCH_` and `/Volumes/`) still return 0 hits. `cocoder validate-contracts` exits clean. Node 25 engine warning expected per ADR-0004.
- **State mirrors refreshed:** Foundation plan M4 task rows for M4.22–M4.27 → `[x]` with chosen-option markers; Progress table updated (M4: 11 of 27; total 52 of 74). Sub-Playbook E preconditions M4.22/23/24 box → `[x]`. Master README Sub-Playbook E row → "Ready" status. PRIORITIES.md blocked-on cell → "Next: Sub-Playbook E Solve."

**Sub-Playbook E pre-flight fix (applied 2026-05-22):** the dogfood-ramp plan originally used `--workspace-root "/Volumes/NAS LOCAL/CoCoder/cocoder"`. Under the resolveActiveWorkspaceRoot model the workspace root is the directory whose `cocoder/` subdir IS the meta-project — that's `/Volumes/NAS LOCAL/CoCoder` (the install root). The config resolver expects `<workspaceRoot>/cocoder/<file>`, so the original value would miss every workspace-tracked lookup. **Corrected:** Sub-Playbook E now invokes `--workspace-root "/Volumes/NAS LOCAL/CoCoder" --workspace-slug cocoder-dogfood` at E-S1, E3.1, E3.3, and Success Criteria. Boundaries section + Decision Log entry updated to document the rationale.

**Resume cue / Next:** Sub-Playbook E Solve. Founder hands a fresh session the dogfood-pickup prompt; that session executes E-S1 (borrow Bob + Talia, dry-run `cocoder compose-launch` until composition succeeds, capture the proof artifact at `local/workspaces/cocoder-dogfood/solve-evidence/composed-prompt-dry-run.txt`, run the 7 `rg` verifications listed in E-S2). After Solve, Expand E1 → E5 builds and runs the first orchestrated Talia task (port `core.test.mjs`). Remaining M4 free-wins (M4.5–M4.14, M4.16–M4.21) can be cleaned up in parallel; they do not block Sub-Playbook E.

---

## 2026-05-22 (Late Evening) — Q1–Q7 founder decisions resolved; ADR-0006 accepted

**Persona:** Founder + AI (Bob) | **Priority:** v0.1-foundation | **Plan:** [`priorities/v0.1-foundation/pending-decisions.md`](./priorities/v0.1-foundation/pending-decisions.md)
**Outcomes:**
- All 7 pending decisions resolved by founder: **Q1=B** (minimal `--developer-mode` belt in Sub-Playbook A; full ADR-0005 taxonomy stays in C), **Q2=A** (`config set` always writes install-local by default; `--workspace-root` flag for workspace-local), **Q3=A** (ephemeral runs to `local/workspaces/<slug>/runs/` per ARCHITECTURE.md), **Q4=A** with founder directive "be sure this is a well documented requirement" (no workspaces nested inside install repo; `cocoder init` refuses), **Q5=A** (verification-artifact guard inline in `launch.mjs` is SSOT; replace source-grep test with runtime test), **Q6=A** (user-app cwd required for workspace ops; `--cocoder-home` for install ops), **Q7=B** (Standard A close: free wins + workspace detection + Q1-B belt; matches the audit's recommended sequencing)
- **ADR-0006 accepted** — `cocoder/decisions/0006-no-nested-workspaces-inside-install.md` graduates Q4=A per founder directive. Codifies the constraint, the canonical CLI refusal error text, the dogfood exception (the install's own `cocoder/` IS a valid workspace, addressed via explicit `--workspace-root`), the documentation requirements (must appear in `docs/configuration.md` + future `docs/getting-started.md`), and the v0.2 upgrade path to a registry-first model (Option C, depends on Sub-Playbook C). ADR index in `decisions/README.md` updated; "next ADR number" bumped to 0007.
- `pending-decisions.md` top-line status → "Resolved 2026-05-22"; all 7 Decision blocks filled with chosen option + rationale + ADR-graduation flag.
- Foundation plan Milestone M4 task rows refreshed: `gates: Q#` markers replaced with `Q#=X applied` semantics + the implementation-relevant scope inline. M4.22 carries Q1-B; M4.23 carries Q2-A + Q4-A combined fix; M4.24 carries Q4-A + ADR-0006 refusal path + regression-test requirement; M4.25 carries Q3-A; M4.26 carries Q5-A (inline canonical); M4.27 carries Q6-A friendly cwd error.
- Master README Pending Decisions section now shows full decision table + ADR-0006 link; Master Status flipped from "blocked on Q1–Q7" to "all decision gates resolved"; "Key files" ADR range bumped to 0001–0006; Progress table refreshed with the new next-action sequence.
- Sub-Playbook E preconditions: Q1/Q2/Q4 boxes ticked `[x]` with chosen options inline. The remaining precondition is "M4.22/23/24 implemented" — that's the next session's engineering work.
- PRIORITIES.md "blocked on" cell flipped from "Founder Q1/Q2/Q4 needed" to "All decisions resolved; Phase 2 (M4.22→M4.27) ready to execute."

**Resume cue / Next:** Phase 2 engineering: M4.22 first (cheapest belt; ~30-min product-write gate keyed on `--developer-mode` / `COCODER_DEVELOPER_MODE=1` with a regression test), then M4.23 (`findCocoderHome` fail-closed + zone-scoped writers + `--workspace-root` on `config set`), then M4.24 (workspace detection + ADR-0006 refusal + `docs/configuration.md` documentation block + regression test). M4.25, M4.26, M4.27 follow. Each lands with `pnpm -r test` green. After M4 Checkpoint, Sub-Playbook E Solve (E-S1).

---

## 2026-05-22 (Evening) — Sub-Playbook A Milestone M4 free-wins executed

**Persona:** AI (Bob) | **Priority:** v0.1-foundation | **Plan:** [`priorities/v0.1-foundation/plans/2026-05-21-foundation.plan.md`](./priorities/v0.1-foundation/plans/2026-05-21-foundation.plan.md) Milestone M4
**Outcomes:**
- **M4.1** Lying checkboxes audited; only outstanding mismatch was `foundation.plan.md:280` (Final Check mirror of Master `P-S1`/`P-S2`) — refreshed `[ ]` → `[x]` with audit §M11 marker. Master Witness row (§H10) and PRIORITIES.md Canon (§H11) were already current from the 2026-05-22 PM audit pass; E2.4, E3.5, S1.3/S1.5/S1.6 remain correctly un-checked with audit notes inline.
- **M4.2** Root `.gitignore` rewritten (audit §B7, §B8): added `*.env`, `.env.*`, `secrets/`; replaced blanket `dist/` with per-package `packages/*/dist/` + `!packages/schemas/dist/` un-ignore + `packages/schemas/dist/js/` re-ignore so the schema-drift CI gate sees the tracked `*.schema.json` artifacts.
- **M4.3** Legacy `cocoder/core/cli.mjs` path scrubbed from shipped runtime (audit §B1). Introduced module-level `CORE_CLI_PATH = fileURLToPath(new URL('../cli.mjs', import.meta.url))` in `launch.mjs` + `debugger.mjs`; replaced 6 hardcoded literals (4 in launch.mjs prompt/script renderers, 2 in debugger.mjs preflight + follow-collector). `orchestrator-commit.mjs` `DEFAULT_IMPLEMENTATION_SURFACES` dropped the dead `cocoder/core/`, `cocoder/scripts/`, `cocoder/tests/` entries (now covered by `packages/`). Added `packages/core/tests/cli-path-resolution.test.mjs` — 4 regression tests asserting the resolved CLI path exists and the legacy literal cannot creep back in.
- **M4.4** CoBuilder identifier scrub complete in `packages/` (audit §B3): tmux socket `cobuilder-orchestration` → `cocoder-orchestration` (launch.mjs L18, debugger.mjs L303/304/420); mkdtemp prefixes (`cobuilder-orch-message-`, `.cobuilder-git-commit-capability-`, `cobuilder-debugger-git-probe-`) → `cocoder-*`; prompt headers (`# CoBuilder Orchestration Launch`, `# CoBuilder Orchestrator Debugger`, bootstrap strings) → CoCoder; commit trailer domain (`@cobuilder.local`) made configurable via `COCODER_ORCH_COMMIT_TRAILER_DOMAIN` env var, defaulting to `cocoder.local`; contract schema description in `persona.schema.json`; Quinn defaults (`ENV_STORAGE_KEY` configurable via `COCODER_QUINN_ENV_STORAGE_KEY`, default `cocoder-dev-console-env`; `DEFAULT_IDE_DIR` `cobuilder-ide` → `cocoder-ide`; `COBUILDER_CDP_PORT` → `COCODER_CDP_PORT`); Quinn cases scrubbed (`api-staging.cobuilder.me` genericized to "the configured staging backend"); `quinn/README.md` boundary note rewritten; `tests/config-resolver.test.mjs` test data switched from `cobuilder`/`CoBuilder` to `sample-app`/`SampleApp`; `acceptance.mjs` `cobuilder-missing-verifier-cli` fixture name shortened to `missing-verifier-cli`. **`rg 'cobuilder' packages/ --glob '!**/*.example.*'` returns 0 hits** (case-sensitive, per audit gate spec). Re-checked Sub-Playbook A E2.4 `[x]` with audit-closed marker; the remaining `CoBuilder` CapitalCase reference in `quinn/README.md` boundary note is intentional upstream attribution per ADR-0004 and doesn't match the gate.
- **M4.15** Stale-reference CI gate added (audit §M12) to `.github/workflows/ci.yml`: dual `rg` checks for `cobuilder|COB_ORCH_` and `/Volumes/` across `packages/ docs/ templates/` excluding `*.example.*`. Both return 0 locally. Scrubbed a stray `/Volumes/NAS LOCAL` example value in `docs/configuration.md` (replaced with a portable placeholder + cross-link to the canonical `templates/install-local/roots.example.yaml`); `docs/configuration.md` itself is not gate-excluded so the example needed to be portable.
- Verified `pnpm -r test` green twice (post-M4.3 and post-M4.4): 10 tests pass (6 pre-existing + 4 new M4.3 regression). Schemas package rebuilt cleanly on persona schema description change. Engine warning under local Node 25 is expected per ADR-0004.

**Resume cue / Next:** Phase 1 (M4 free-wins gating Sub-Playbook E) complete. **Phase 2 (M4.22/23/24) is blocked on founder answers to Q1, Q2, Q4 in [`priorities/v0.1-foundation/pending-decisions.md`](./priorities/v0.1-foundation/pending-decisions.md).** Recommended defaults per the file: Q1=Option B (minimal `--developer-mode` deny-gate in A), Q2=Option A (bare `config set` always install-local + `--workspace-root` flag), Q4=Option A (no nested workspaces inside install). When founder records answers, this session (or the next CC session) executes M4.22 → M4.23 → M4.24 with regression tests, then proceeds to Sub-Playbook E Solve (E-S1: borrow Bob + Talia personas, dry-run `cocoder compose-launch` until composition succeeds).

---

## 2026-05-22 (Late PM) — Sub-Playbook E (Dogfood Ramp) drafted

**Persona:** Founder + AI (Bob) | **Priority:** v0.1-foundation | **Plan:** [`priorities/v0.1-foundation/plans/2026-05-22-dogfood-ramp.plan.md`](./priorities/v0.1-foundation/plans/2026-05-22-dogfood-ramp.plan.md)
**Outcomes:**
- Authored Sub-Playbook E (Dogfood Ramp) — full WISER structure — to prove `cocoder compose-launch` works end-to-end on the CoCoder dogfood workspace before Sub-Playbook B's full template work absorbs scope and timeline
- E's first orchestrated task = Talia ports audit §4 port-first tests (starting with `core.test.mjs`) into `packages/core/tests/` — first deliverable is the regression net that protects every future dogfood orchestration (self-leveraging by design)
- E pulls a thin slice of Sub-Playbook B's persona work forward: borrow Bob + Talia + their prompts + minimum shared fragments from CoBuilder, scrub CoBuilder identifiers, document divergences in `cocoder/personas/PORT-NOTES.md` for B to extend
- Preconditions: Sub-Playbook A Milestone M4 Checkpoint (free-wins + Q1/Q2/Q4 Answered + M4.22/23/24 safety belts implemented). E cannot start until M4 is good enough
- Master README updated: Sub-Playbook E added to Expand section + Progress table (Expand now lists 5 sub-Playbooks: A, E, B, C, D); Decision Log entry added
- Sub-Playbook A Final Check updated: includes Sub-Playbook E precondition unblock as closing criterion; Decision Log entry added
- Sub-Playbook B Preconditions updated: now requires Sub-Playbook E Final Check, with B extending (not redoing) E's persona work
- PRIORITIES.md "blocked on" cell updated to reflect E ramp track

**Resume cue / Next:** Founder hands a fresh Claude Code CLI session the dogfood-pickup prompt (drafted alongside this entry). Fresh session reads the AGENTS.md chain, validates pending-decisions status, executes M4 prerequisites (free-wins first, then founder-gated if Q1/Q2/Q4 Answered), and then starts Sub-Playbook E Solve. First orchestrated dogfood task = Talia ports `core.test.mjs`.

---

## 2026-05-22 (PM) — Foundation audit + Milestone M4 + pending-decisions opened

**Persona:** Founder + AI (Bob) | **Priority:** v0.1-foundation | **Plan:** Sub-Playbook A → Refine
**Outcomes:**
- Ran a four-track readonly audit (port completeness vs CoBuilder, architecture/docs/CLI consistency, tests/gitignore/security, user-customization boundary) covering ~30 findings ordered by severity
- Identified 9 critical blockers, 15 high-risk gaps, 12 medium items, and a 12-file CoBuilder test port-first list — all rooted in concrete file:line evidence
- Surfaced 5 originally-claimed `[x]` checkboxes that overstated reality (E2.4, S1.3/S1.5/S1.6 fixtures, E3.5, Master reuse claim for ORCH-DEBUGGER); un-checked with `→ audit §X` pointers in the foundation plan
- Identified that the orchestration-from-install path can write to `packages/`/`docs/`/`templates/` via `orchestrator-commit.mjs` defaults today (the single biggest "user can mutate product" vector) and proposed a minimal `cocoder-product` deny-gate (M4.22) as a temporary belt pending Sub-Playbook C taxonomy enforcement
- Identified that `findCocoderHome` falls back to cwd silently — root cause of cwd-based zone confusion across config writes, run dirs, and orchestration commits (M4.23–M4.24)
- Authored four artifacts to preserve and operationalize the findings without slamming through them in one pass:
  - [`priorities/v0.1-foundation/plans/2026-05-22-foundation-audit.md`](./priorities/v0.1-foundation/plans/2026-05-22-foundation-audit.md) — canonical evidence record with appendices for the 4 raw subagent outputs
  - [`priorities/v0.1-foundation/pending-decisions.md`](./priorities/v0.1-foundation/pending-decisions.md) — Q1–Q7 founder gates with recommended defaults
  - Sub-Playbook A foundation plan: added Milestone **M4 (Audit Remediation)** with 27 task rows (21 free-wins + 6 founder-gated), expanded E2.2e with the 12 port-first test files, updated Refine + Final Check + Decision Log + Resume Instructions + Progress (Canon: Expand → Refine)
  - Priority README: added Pending Decisions section, updated Status to Refine, refreshed Witness row to current reality, un-checked false reuse claim, added ADR-0005 to Key files, updated Resume Instructions
- Refreshed [`PRIORITIES.md`](./PRIORITIES.md) with new "Blocked on" column pointing at `pending-decisions.md`

**Resume cue / Next:** Founder reads [`priorities/v0.1-foundation/pending-decisions.md`](./priorities/v0.1-foundation/pending-decisions.md) and answers Q1–Q7. In parallel, Bob may begin Sub-Playbook A Milestone M4 free-wins (M4.1 first: refresh lying checkboxes; then M4.2 root `.gitignore` fix; M4.3 CLI path rename; etc.). When Q1–Q7 are resolved, the gated tasks M4.22–M4.27 unblock and Sub-Playbook A can close once M4 Checkpoint is reached.

---

## 2026-05-22 (AM) — Sub-Playbook A Solve passed

**Persona:** AI (Bob) | **Priority:** v0.1-foundation | **Plan:** priorities/v0.1-foundation/plans/2026-05-21-foundation.plan.md
**Outcomes:**
- Created pnpm monorepo scaffold with Node 20 policy, TS base config, `packages/core`, `packages/schemas`, and `packages/cocoder-cli`
- Implemented config resolver, path token resolver, install config schemas, workspaces registry schema, and `cocoder config get/set`
- Copied CoBuilder contract documents, core libraries, checks, Quinn helpers, and adapter declarations into `packages/core` with `COB_ORCH_*` and `cobuilder-build` refs scrubbed from shipped packages
- Replaced the temporary core CLI with the broader CoBuilder command surface, added CoCoder `config`, `list-runs`, and `prepare-debug` alias support, and verified `validate-adapters` / `preflight-adapters`
- Reviewed recent CoBuilder orchestration improvements. Confirmed CoCoder already includes stdin lane dispatch helpers, lane result identity validation, current-action persona audit hardening, and nested-review relevant launch prompt guards from the copied core. Added ADR-0005, Oz improvement routing docs, and `oz-improvement-routing.schema.json` so product improvements cannot blur with workspace customization.
- Re-reviewed latest CoBuilder HEAD `761dcf24` and imported the verification-artifact write guard into CoCoder's generated launch prompt path with a focused regression test.
- Added Solve fixtures for config load order, git-pull survival, multi-machine path identity, and `init --merge` planning
- Verified locally: `pnpm install`, `pnpm -F core test config-resolver`, `pnpm -r test`, `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, `node packages/core/cli.mjs validate-contracts`, and CLI config get/set; all pnpm commands warned local Node is v25.1.0 while repo policy is Node 20

**Next:** Continue Sub-Playbook A Expand at E2.2e: port CoBuilder tests into `packages/core/tests/` and adjust imports/fixtures for the CoCoder layout. Sub-Playbook C must consume ADR-0005 when implementing Oz improvement APIs. *(Superseded by 2026-05-22 PM audit pass; see entry above.)*

---

## 2026-05-21 — Pre-execution cleanup pass (13 items)

**Persona:** Founder + AI (Bob) | **Priority:** v0.1-foundation | **Plan:** N/A (final consistency sweep before Sub-Playbook A Solve)
**Outcomes:**
- ADR-0003 §3 binary entry split into two-tier: public `packages/cocoder-cli/bin/cocoder` (TS-built) + internal `packages/core/cli.mjs` (extracted verbatim); resolves prior ambiguity between ADR-0003 and ADR-0004
- Sub-Playbook A E1.4 rewritten: do NOT add `cocoder/` or `cocoder/local/` to root `.gitignore`; root already governs `local/` and `cocoder/local/` has its own inner `.gitignore`; E1.4 now only extends with build artifacts (`dist/`, `*.tsbuildinfo`, `packages/schemas/dist/`)
- Sub-Playbook A Witness row L50 updated to reflect `.gitignore` already exists from dogfood setup
- Sub-Playbook A Preconditions added: root `.gitignore` enforced + CoBuilder extraction source readable check
- Sub-Playbook A E2.1 pinned extraction-manifest path to `priorities/v0.1-foundation/plans/extraction-manifest.md`
- Sub-Playbook A E2.7 tightened with explicit schema-drift gate (`git diff --exit-code packages/schemas/dist/`) enforcing Zod-as-SSOT
- Sub-Playbook A E3.6 added: `workspaces-registry.ts` Zod schema + reserve `packages/schemas/src/oz/` namespace for Sub-Playbook C; M3 task count adjusted 5 → 6
- Three-zone → four-zone refs corrected across `foundation.plan.md` L20, `personas-template.plan.md` L121, `cocoder/AGENTS.md`, `SESSION_LOG` prior entry
- `ARCHITECTURE.md` status header → "Draft — Solve active (gated by Sub-Playbook A)"; Last verified note refreshed
- Sub-Playbook D D-M1.1 expanded to require a labeled diagram distinguishing install-level `<CoCoder>/local/` from workspace-level `<app>/cocoder/local/`
- Created `cocoder/plans/v0.2-backlog.md` consolidating all v0.1 deferrals (foundation, personas, Oz, docs, cross-cutting) with "why deferred" rationale; updated `plans/AGENTS.md` Active section
- `**Updated:**` headers refreshed across the 5 Playbooks + ARCHITECTURE.md with "(cleanup pass; pre-execution)" tag

**Next:** Begin Sub-Playbook A Solve — execute S1.1 (config resolver spec in `docs/configuration.md`) and S1.2 (resolver implementation + Zod schema). All four Sub-Playbooks now internally consistent and ready for autonomous execution.

---

## 2026-05-21 — SSOT rule + AGENTS.md chain completed

**Persona:** Founder + AI (Bob) | **Priority:** v0.1-foundation | **Plan:** N/A (structural)
**Outcomes:**
- Added explicit SSOT (Single Source of Truth) rule to `cocoder/AGENTS.md` Conventions — canonical sources per metadata type, indexes mirror canonical, updates require same-change-set mirror update
- Added file-naming convention distinguishing `AGENTS.md` (routing), `README.md` (content; stands in for AGENTS.md when content IS routing), and `INDEX.md` (flat-list mirror)
- Created missing AGENTS.md in `priorities/`, `tickets/`, `memory/`, `plans/`
- Renamed `standards/README.md` → `standards/AGENTS.md` (it's routing/conventions, not content) and expanded its purpose
- Updated root `cocoder/AGENTS.md` routing table to enumerate the full chain and explicitly call out which file stands in for AGENTS.md per subdirectory

**Next:** Begin Sub-Playbook A Solve — execute S1.1 (config resolver spec in `docs/configuration.md`) and S1.2 (resolver implementation + Zod schema).

---

## 2026-05-21 — Priority README is now THE master Playbook

**Persona:** Founder + AI (Bob) | **Priority:** v0.1-foundation | **Plan:** N/A (structural)
**Outcomes:**
- Merged `plans/2026-05-21-v0.1-program.plan.md` content into `priorities/v0.1-foundation/README.md`
- Deleted the separate Master Playbook file — README **is** the Master now
- Updated `Parent:` and `Master:` references in all four sub-Playbooks (A, B, C, D) to point at `../README.md`
- Updated routing in root `AGENTS.md` and `cocoder/AGENTS.md`
- Added convention to `cocoder/AGENTS.md`: a priority's `README.md` IS its master Playbook (no separate file)

**Next:** Begin Sub-Playbook A Solve — execute S1.1 (config resolver spec in `docs/configuration.md`) and S1.2 (resolver implementation + Zod schema).

---

## 2026-05-21 — Restructure into dogfood meta-project

**Persona:** Founder + AI (Bob) | **Priority:** v0.1-foundation | **Plan:** N/A (structural)
**Outcomes:**
- Collapsed install-zone and workspace-zone ADRs into `cocoder/decisions/` for CoCoder's own dogfood (canonical four-zone model preserved in `../ARCHITECTURE.md` for adopters)
- Moved all five v0.1 Playbooks into `cocoder/priorities/v0.1-foundation/plans/`
- Created `PRIORITIES.md`, `SESSION_LOG.md`, `tickets/`, `memory/`, `personas/custom/`, `standards/`, `local/` scaffolding
- Added `<CoCoder>/local/workspaces/` per founder note (install-level per-workspace state directory)

**Next:** Begin Sub-Playbook A Solve — execute S1.1 (config resolver spec in `docs/configuration.md`) and S1.2 (resolver implementation + Zod schema).

---

## 2026-05-21 — V1 Playbook restructured into Master + four sub-Playbooks

**Persona:** AI (Bob) | **Priority:** v0.1-foundation | **Plan:** v0.1-program
**Outcomes:**
- V1 monolithic foundation Playbook (61 tasks) archived to `plans/zArchive/`
- Master Playbook + four sub-Playbooks (A foundation, B personas/template, C Oz MVP, D docs/dogfood/publish) authored
- ADR-0003 (binary name + env prefix) and ADR-0004 (TS/Zod/AJV/pnpm/Node policy) authored
- `decisions/README.md` index created
- ARCHITECTURE.md updated with canonical gitignore matrix, multi-machine path portability, Oz daemon security model, validation policy

**Next:** Confirm structural decisions with founder; execute first restructure if approved.
