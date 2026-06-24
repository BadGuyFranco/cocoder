# Runner decoupling — progress ledger

Newest entry on top. Each independent session appends one entry, then hands back the next session's
prompt. Priority spec: `cocoder/priorities/backlog/runner-decoupling-refactor.md`. **Do not orchestrate
this work** — independent Claude Code sessions only.

## Next-session prompt template

When you finish a session, fill this in and paste it into your final message for the founder to copy into
a fresh session:

```
You are running ONE independent, non-orchestrated engineering session on the CoCoder repo at
/Volumes/NAS LOCAL/CoCoder (branch main). You are NOT inside CoCoder orchestration — do not use the
runner, the Oz daemon, the Oscar/Bob/Deb loop, or any directive/handoff files. Work directly in the repo
as a normal single-writer engineering session.

Read, in order:
  1. cocoder/priorities/backlog/runner-decoupling-refactor.md  (the priority + EXECUTION CONSTRAINT + per-session protocol)
  2. cocoder/priorities/backlog/runner-decoupling-progress.md  (the ledger; the top entry is where you start)

Your task this session: <WORKSTREAM + the exact next step from the top ledger entry>.

Follow the per-session protocol exactly: map owners/emitters/consumers/tests before editing; implement
tests-first; keep the suite green; verify with the listed commands; preserve unrelated dirty work; commit
ONLY this chunk; append a new ledger entry; and END by handing me a filled-in copy of this prompt for the
next session. Do not start the following chunk in this session.
```

---

## 2026-06-24 — WS2 CLOSED + WS3 step 0 (commit-spine inventory — MAP ONLY, no source edit)

- **Decision (the close/continue call WS2.1 handed me):** **WS2 is CLOSED.** WS2.1's partition map proves the
  terminal is DISPLAY + liveness/idle heartbeat + sanctioned agent-formed markers only (every frame-content
  read is category-A idle-streak or category-B whole-line marker; NO category-C prose/heuristic inference
  remains — WS0/`bca1b27` removed the only one). The done-when's "no frame content can fault/transition" is
  PINNED by `ws2-prose-inert.test.ts`; its "migrate any remaining screen-read semantic signal" half is
  vacuously met (none remains). Per the sharpened spec + this session's prompt, I did NOT invent a mid-atom
  progress channel — adding a carrier nothing consumes is a FEATURE needing its own ADR, not
  behavior-preserving decoupling. No code changed to close WS2; the audit + pin already landed it.
- **Workstream/step:** WS3 (One commit spine), step 0 — the protocol-mandated **map before editing**. This
  session is INVENTORY ONLY: no source file touched, no test added (nothing changes behavior yet, so there
  is nothing to pin). Ledger-only commit. The first WS3 EDIT is the next session (exact-next-step below).
- **Commit:** `38b4ae8` — "priority(backlog): close WS2 + map the WS3 commit spine (inventory, before
  editing)". (Sha backfilled in the immediately-following ledger commit, matching WS1.3/1.4/2.1's
  separate-ledger-commit convention.)
- **Files:** `cocoder/priorities/backlog/runner-decoupling-progress.md` (this entry) ONLY.
- **The seed (already exists):** `packages/core/src/commit-gate/workspace-commit.ts` (ADR-0023 §1) — ONE
  module, ONE receipt type `CommitReceipt {committed, committedSha, committedFiles, outOfLane, error}`, two
  shapes: `commitFiles(git, repo, files, msg, author?)` (caller-controlled list, no scope partition) and
  `commitScoped(git, repo, scope, msg, author?, {commitOnlyScope?})` (agent whole-tree diff; default commits
  all + flags `outOfLane`, `commitOnlyScope` holds back out-of-lane). **Neither records any store event** —
  it returns a receipt; the caller owns durability. `repair.ts`/`gateCommitRepair` already routes through
  `commitScoped` (done). Tests: `commit-gate.test.ts`.
- **Map (every commit path that writes tracked files to the active branch; owner → primitive → receipt →
  who records the store events):**
  - **P1 — in-run atom gate** `runCommitGate` (`commit-gate/gate.ts:57`). **Does NOT use the spine — calls
    `git.addAndCommit` DIRECTLY (`gate.ts:81`)**, the last in-run raw-primitive caller. Returns its OWN
    receipt shape `CommitGateResult {committedSha, committedFiles, outOfScope, selfCommitted}` (≠
    `CommitReceipt`: `outOfScope` not `outOfLane`, has `selfCommitted`, no `committed`/`error`). Records
    events INTERNALLY: `agent-self-commit` (62-64), `audit-write-boundary-refused` (71), `commit` +
    `recordCommitLink` (82-83), `out-of-scope-committed` (87). Scope is ADVISORY (commits everything, flags
    out-of-lane) unless `auditWriteBoundary` (Takeover audits) hard-refuses. Callers: per-atom verified
    commit (`agent-step.ts:382`), oscar-support (`runner.ts:1572`), wrap-up Play (`runner.ts:1822`),
    deb-repair no-files-changed fallback (`runner.ts:1267`).
  - **P2 — Deb's inlined repair/escalation commit in `triageFault`** (`runner.ts:1218–1286`). The run_231
    sweep-guard path. TWO sub-paths: (a) `verdict.filesChanged` non-empty → MANUAL: `partitionByScope` →
    `commitFiles(git, worktree, inScope, …)` (`1258`, spine) → then HAND-ROLLS what P1 does internally:
    `agent-self-commit` (`1256`), `recordCommitLink`+`commit` (`1260-61`), `deb-repair-commit-failed`
    (`1263`), `deb-repair-out-of-scope-held` (`1264`), and HAND-BUILDS a `CommitGateResult` (`1265`); (b)
    empty → `runCommitGate` (`1267`, = P1). Then records `deb-repair` (`1279`). Sweep-safety = quarantine
    BEFORE fault (`bca1b27`) + **`inScope`-only** commit (the partition at `1257` is what keeps it from
    sweeping non-declared work). **This is the test WS3 must never break:**
    `runner.test.ts:3688` ("a builder fault quarantines the atom residue before Deb triages, so a deb-repair
    commit cannot sweep it (run_231)") + the ticket variant at `:3819`.
  - **P3 — oscar-support** `commitOscarSupport` (`runner.ts:1570–1592`). Thin wrapper over `runCommitGate`
    (= P1) + `absorbGateResult` + records `oscar-support-commit` (`1587`).
  - **P4 — run-history** `projectAndCommitPortableRunHistory` (`runner.ts:1614–1652`). Explicit governance
    file list (counters/workspace/run.json/*.jsonl). MANUAL self-commit detect (`1640-43`) →
    `commitFiles(…, files, …)` (`1645`, spine) → MANUAL `recordCommitLink`+`commit` (`1648-49`); THROWS on
    `receipt.error` (`1646`) — its own error convention, unlike P2's event-record.
  - **P5 — pre-run snapshots** (`runner.ts:893, 903`). `commitFiles` (spine) for founder WIP +
    governance dirt; MANUAL `founder-presnapshot[-failed]` / `governance-presnapshot[-failed]` events; throws
    `DirtyWorkingTreeError` on failure — a THIRD error convention.
  - **(Out of WS3's named scope, but flagged) daemon paths:** `daemon/src/launcher.ts` already uses the spine
    (`commitFiles:435`, `runCommitGate:1013`, `gateCommitRepair:1234/1777`); but
    `daemon/src/routes.ts:434` still calls **`git.addAndCommit` DIRECTLY** (baseline tree import) — the only
    other raw-primitive caller besides `gate.ts:81`. Note for whoever finishes the spine.
  - **Receipt absorption into run-level surfaces:** `absorbGateResult` (`runner.ts:1531`) folds a
    `CommitGateResult` into `committedShas`/`committedFiles`/`outOfScope`/`selfCommitted` (the run summary
    WS1.3 derives). P2/P4/P5 do NOT call it — they push to those arrays by hand or not at all, so the run
    summary's view of deb-repair/run-history commits is assembled on a different path than P1/P3.
- **The WS3 problem, stated precisely (what "one spine, one receipt, one scope rule" must collapse):**
  1. **Two receipt shapes** — `CommitReceipt` (spine) vs `CommitGateResult` (gate). P2 literally hand-converts
     one to the other (`1265`).
  2. **Two commit primitives still bypass the spine** — `gate.ts:81` and `routes.ts:434` call
     `git.addAndCommit` directly; everything else funnels through `commitFiles`/`commitScoped`.
  3. **Event recording is split three ways** — P1 records commit-link/commit/self-commit INSIDE the gate; P2
     and P4 HAND-ROLL the same recordings around `commitFiles`; P5 hand-rolls a different set. Three
     failure conventions (event vs throw vs DirtyWorkingTreeError). This is the duplication a single spine
     receipt + one recording helper removes.
- **By-construction sweep guard (must survive WS3):** Deb repair commits `partitionByScope(filesChanged,
  deb.writeScope).inScope` ONLY (`runner.ts:1257-58`), and the faulted atom's residue is quarantined before
  triage (`bca1b27`), so a repair commit is structurally incapable of sweeping non-declared work. WS3's
  done-when keeps `runner.test.ts:3688` green.
- **Tests/results (baseline for a no-code-change session):** `pnpm --filter @cocoder/core test` → **576
  passed** (72 files) — unchanged, as expected (ledger-only). No typecheck/topology delta possible from a
  markdown edit; the code tree is byte-identical to WS2.1's green commit `f2f1a5b` plus the preserved
  eslint dirt.
- **Residual risk:** This is a MAP, not a change — the entanglement it documents is still live. The map was
  built by reading the code (not running a real multi-path run), so a commit path I did not enumerate (e.g.
  a future caller, or a daemon path beyond `routes.ts:434`) would not appear here; the next session should
  re-grep `addAndCommit`/`commitFiles`/`commitScoped`/`runCommitGate` before editing to confirm the
  inventory is still complete. The unrelated eslint-adoption dirt (`eslint.config.mjs`, `run.ts`,
  `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`, `runner.ts`'s `SessionRef` import hunk, `oz-host.ts`,
  `proof-daemon-reload.mjs`, `tsconfig.eslint.json`) was preserved, NOT committed — this entry is the only
  staged file, so `git add` of the ledger staged it directly; no surgical apply needed.
- **Exact next step (WS3, step 1 — the smallest shippable spine consolidation, tests-first):** Route
  **P1 `runCommitGate` (`gate.ts`) through the spine** — replace its direct `git.addAndCommit(cwd, changed,
  message)` (`gate.ts:81`) with `commitScoped(git, cwd, scope, message, undefined, {})` (default advisory
  scope: commits all changed, flags out-of-lane), keeping the gate's INTERNAL event recording
  (`agent-self-commit`/`commit`/`recordCommitLink`/`out-of-scope-committed`) and the `auditWriteBoundary`
  hard-refuse exactly as they are. This removes the last IN-RUN raw-primitive caller and makes P1, P3, the
  deb-repair fallback, and wrap-up all sit on the spine — WITHOUT changing any observed behavior (commitScoped's
  default == the gate's current advisory commit-all). Map-confirm first: assert `commitScoped` with no
  `commitOnlyScope` commits exactly `changedFiles` and reports `outOfScope` as `outOfLane` (it does — see
  `workspace-commit.ts:87-93`). Tests-first: the `commit-gate.test.ts` + `runner-direct.test.ts` advisory-scope
  and out-of-lane assertions are the regression guard; add a unit test pinning that `runCommitGate` now
  delegates to the spine (e.g. a fake `git` whose `addAndCommit` is only reachable via `commitScoped`).
  Do NOT yet unify the two receipt SHAPES or centralize P2/P4/P5's hand-rolled recording — that is a later
  WS3 chunk; step 1 is just "the in-run gate stops calling the raw primitive." Keep `runner.test.ts:3688`
  green. Verify with the full command set. (`routes.ts:434` is daemon-side and out of this chunk.)

## 2026-06-24 — WS2, step 1 (audit + pin: prose frame content is inert — AUDIT-ONLY, no consumer touched)

- **Workstream/step:** WS2 (structured agent→runner progress channel), first chunk — AUDIT + PIN ONLY. Per
  the sharpened WS2 spec, audit every `readScreen`/frame consumer, partition each frame-read into A
  (liveness/idle — keep), B (structured agent-formed marker — sanctioned, keep), or C (prose/heuristic
  semantic inference — the only thing WS2 migrates). No consumer altered this session; the first migration
  (if any) is a later session after founder review of the map.
- **Commit:** `f2f1a5b` — "runner(monitor): WS2.1 — pin that prose frame content is inert (no fault, no
  transition)". (Ledger entry committed separately, matching WS1.4/1.5.)
- **Files:** `packages/core/tests/ws2-prose-inert.test.ts` (NEW, entirely mine — not in the eslint foreign
  list, staged directly with `git add`; no surgical apply needed). 5 tests: 3 prose-inert assertions
  (detector → null, heuristic judge → progressing, composed judge over runMonitor → neither done nor
  blocked) + 2 positive controls (standalone done sentinel → done, standalone blocked marker → blocked).
- **Partition map (every frame consumer, exact frame-read, A/B/C tag):**
  - *`monitor.ts` → `makeHeuristicJudge` (174–188):* (1) `frame.split('\n').some(line => line.trim() ===
    opts.doneSentinel)` → `{state:'done'}` — whole-line equality vs `atomSentinel(n)` =
    `<<<COCODER-ATOM-n-DONE>>>` ⇒ **B**. (2) `sample.idleStreak >= opts.stuckAfter` → `{state:'stuck'}`;
    `idleStreak` is computed in `runMonitor` (line 114) purely from `frame === prevFrame` (frame equality,
    never content) ⇒ **A**.
  - *`agent-step.ts` → inline judge wrapper (216–223):* `detectBuilderBlocker(sample.frame, atomIndex)`
    (blocker.ts:31) whole-line-matches `^<<<COCODER-ATOM-n-BLOCKED(: reason)?>>>$` → `{state:'blocked'}` ⇒
    **B**. The `AUTHORITY_SCOPE` regex (blocker.ts:12) classifies the reason Bob wrote INSIDE his own marker,
    not free frame text — still B (marker-payload classification, WS0's structured replacement for the
    run_231 prose scrape). Else delegates to `makeHeuristicJudge` ⇒ inherits its B+A.
  - *Deb watcher → `startDebWatcher` (runner.ts:1295–1373):* `readScreen` = `oscarDriver.readScreen()`
    (1302–1305), but the judge (1306–1337) NEVER reads `sample.frame` — it reads the nudge FILE
    (`io.readNudgeRequest(debNudgePath)`, 1308), validates evidence/grace, else `progressing`. The screen
    read feeds only `runMonitor`'s `idleStreak` liveness ⇒ **A** (nudge gating is file-driven, not a frame
    read).
  - *Oscar nudge watchdog → `awaitOscarWithNudgeWatchdog` (runner.ts:1380–1457):* `readScreen` returns the
    oscar screen or `''` (1405–1408); the judge (1409–1425) reads the founder-stop FILE, the Oz nudge FILE
    (`ozNudgePath`, 1416), and `sample.idleStreak > 0` (1422). NEVER reads `sample.frame` content ⇒ frame
    read is **A** only.
- **Finding (verified, not assumed):** WS0 (`bca1b27`) already removed the only category-C inference (the
  old blocker keyword-scrape; now marker-only). Every remaining frame-content read is **B** (done sentinel,
  blocked marker — whole-line, agent-formed, sanctioned) or **A** (idle-streak liveness; the two watchers'
  judges read FILES + idleStreak, never frame content). **NO live category-C prose/heuristic inference
  remains.** So WS2's first chunk is the PIN, not a migration.
- **The pin (test design):** one adversarial prose frame name-drops scope/authority/done/blocked/error AND
  the `<<<COCODER-ATOM` prefix but has NO standalone marker line, fed through the EXACT composed judge
  `executeAgentStep` runs (detector first, then `makeHeuristicJudge`). `runMonitor` drives it over a CONSTANT
  frame with injected `sleep`/`now` (no real timers — sidesteps the Deb-watcher flake family AND honors the
  WS1.1 determinism rule). Asserted: reason is neither `done` nor `blocked` and no assessment is done/blocked
  (it ends on the liveness `timeout` path — a category-A outcome is legitimate). Positive controls feed a
  standalone done sentinel (→ done) and a standalone blocked marker (→ blocked), proving the pin is NOT
  vacuous and that the sanctioned structured channel (B) still transitions — the WS2 boundary made
  executable: prose inert, markers live.
- **Why it PASSES as written (NOT red→green):** the audit established that no prose-reading path exists on
  the current tree (WS0 removed it), so the pin documents a property already true. Its value is regression
  teeth: any future re-introduction of a keyword/heuristic read of free frame text into ANY frame-content
  consumer makes one of the three prose-inert assertions go red. The blocked control initially failed
  (`blockerMarker(n)` already closes with `>>>`, so appending a reason after it produced a non-matching
  line) — fixed by using the bare standalone marker, which is itself valid; not a behavior issue.
- **Tests/results:** `pnpm --filter @cocoder/core test ws2-prose-inert` → 5 passed; `pnpm --filter
  @cocoder/core test` → **576 passed** (was 571; +5 new); `pnpm --filter @cocoder/core typecheck` → clean;
  root `pnpm typecheck` → clean (7 pkgs); `node scripts/check-topology.mjs` → passed (same 2 pre-existing
  daemon test-helper warnings). Root `pnpm test`: ALL packages green this run (personas 29, core 576,
  adapters 24, session-hosts 18, ui 161, cli 9, daemon 345) — the known Deb-watcher timer-race flake family
  did not trip.
- **Residual risk:** the pin exercises the two frame-CONTENT units (`makeHeuristicJudge`, `detectBuilderBlocker`)
  and the composed judge via `runMonitor`; it does NOT drive a full real run through the runner, so a
  hypothetical future re-coupling that reads frame content somewhere OTHER than these two units (e.g. a new
  consumer) would need its own pin. The Deb watcher and Oscar watchdog judges are frame-content-blind today
  (verified by inspection — they read files + idleStreak), so there is no frame-content path to pin in them;
  if a later WS2 session adds one, pin it there too. The unrelated eslint-adoption dirt (`eslint.config.mjs`,
  `run.ts`, `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`, `runner.ts`'s `SessionRef` import hunk,
  `oz-host.ts`, `proof-daemon-reload.mjs`, `tsconfig.eslint.json`) was preserved, NOT committed — the new
  test is entirely mine, so it staged directly with `git add`; no surgical apply was needed.
- **Exact next step (WS2 is AUDIT-COMPLETE — no category-C migration remains):** The audit found NO live
  prose/heuristic inference, so there is NOTHING to migrate this workstream — WS2's "stop scraping" half is
  already satisfied (WS0) and now PINNED (WS2.1). The done-when's SECOND half ("any remaining screen-read
  semantic signal has been migrated to a structured artifact") is vacuously met: none remains. The OPTIONAL
  remaining WS2 surface area is the spec's parenthetical "a missing channel (e.g. mid-atom progress) is
  ADDED as a marker" — but per the sharpened spec and this session's prompt, ADDING a channel nothing
  consumes is a FEATURE, not behavior-preserving decoupling, and must be its own decision/ADR first; do NOT
  invent it under WS2. RECOMMENDATION: declare WS2 CLOSED (audit + pin complete; terminal is provably
  DISPLAY + liveness/idle heartbeat + sanctioned markers only) and proceed to **WS3 — One commit spine**, or
  to **WS4** if the founder wants the Deb-watcher de-flake (a named WS4 deliverable) done before any further
  watcher work. NOTE for any future WS2 watcher change: this session did NOT touch the Deb watcher, so the
  known Deb-watcher timer flake did not block it — but BEFORE any session CHANGES the Deb watcher, do the
  WS4 "de-flake the Deb-watcher stall family" deliverable first (it lives in that exact code).

## 2026-06-24 — WS1, step 5 (surface-agreement closeout test — CLOSES WS1)

- **Workstream/step:** WS1 (Surface unification), step 5 — land the cross-surface agreement regression the
  WS1 done-when names. TEST-ONLY (no surface swap): WS1.1–1.4 already made all THREE run-level surfaces
  derive from the same `run-end` event; this PINS that they cannot disagree by construction.
- **Commit:** `f540aca` — "runner(status): WS1.5 — surface-agreement closeout test (three run-level surfaces
  provably agree)". (Single commit — the ledger entry rides with the prior chunk's convention; this entry's
  own commit follows separately, matching WS1.3/1.4.)
- **Files:** `packages/core/tests/surface-agreement.test.ts` (NEW, entirely mine — not in the eslint foreign
  list, so `git add` staged it directly; no surgical apply needed). 4 tests: 3 terminal shapes
  (faulted/held/stopped) + 1 negative control.
- **Map (the three surfaces, terminal-status field, `run-end` field each reads):**
  - *Deb status feed:* `deriveTerminalProjection(events)` (status.ts) → `{phase, activeAtom}` → `renderDebStatus`
    → `oscar`. COARSE: held → `awaiting-founder`, stopped/failed → `faulted`; all three → oscar `blocked`.
    Reads `run-held` / `run-stopped` / `run-end {status:failed}`.
  - *portable run.json:* `deriveRunSummary(events).status` (status.ts) → fed to `writePortableRunHistory`'s
    `terminal.status` (WS1.3). Carries the full `RunStatus`. Reads `run-end {status}`.
  - *record.md:* `renderRunRecord` → `**Status**` line via `deriveRunSummary(events).status` (WS1.4). Full
    `RunStatus`. Reads `run-end {status}`.
- **Assertion shape (chosen per WS1.1 determinism rule):** ONE `:memory:` store/run per terminal shape;
  record the terminal markers (`run-end` + `run-held`/`run-stopped`) ONCE; read all three surfaces from that
  SINGLE event log. The two summary surfaces share full `RunStatus` granularity → asserted byte-equal on the
  `run-end {status}` (`portableStatus === t.status`, record `**Status**` line === `- **Status:** ${status}`,
  and the record line ends with the portable status). The coarser feed agrees at the granularity it shares —
  `projection.phase === feedPhase` and `feed.oscar === 'blocked'` (the prompt's caution: assert at the
  shared granularity, don't invent a finer distinction the feed doesn't make). Excluded by design: render-time
  `generatedAt`, free-text `waitCondition`/`activeTask`, wall-clock `endedAt`/Started/Ended.
- **By-construction proof (the regression teeth):** the run ROW is left at its default `running` (no
  `setRunStatus`) in the three shape tests, so a passing assertion can ONLY mean each surface read the EVENT,
  not the row. The 4th test is a NEGATIVE CONTROL: `run-end` says `stopped` but the row is forced to
  `completed` — all three surfaces still report `stopped`/`blocked`, proving none follow a runner-local/row.
  A future re-coupling of any surface to a runner local that drifts from the event log goes red here.
- **Why it PASSES as written (NOT red→green):** the three derivations already agree on the current tree
  (WS1.1–1.4 landed them); step 5's value is pinning the agreement, not flipping a behavior. Stated up front
  in the test header and confirmed: 4 passed on first run, no initial failure expected.
- **Tests/results:** `pnpm --filter @cocoder/core test surface-agreement` → 4 passed (first run, as
  predicted); `pnpm --filter @cocoder/core test` → **571 passed** (was 567; +4 new); `pnpm --filter
  @cocoder/core typecheck` → clean; root `pnpm typecheck` → clean (7 pkgs); `node scripts/check-topology.mjs`
  → passed (same 2 pre-existing daemon test-helper warnings). Root `pnpm test`: ALL packages green this run
  (personas 29, core 571, adapters 24, session-hosts 18, ui 161, cli 9, daemon 345) — the known Deb-watcher
  timer-race flake family did not trip.
- **Residual risk:** the test pins the THREE DERIVATIONS agreeing on a hand-built terminal store — it does NOT
  drive a real run through the runner, so it cannot catch a re-coupling that lives ONLY in the runner's
  wiring (e.g. the runner passing a stale local to `writePortableRunHistory` that disagrees with the event it
  also recorded). The negative control narrows this — any surface reading the row instead of the event is
  caught — but a runner-level wiring regression that bypasses the derivations would need the real-run
  `expectPortableTerminalHistory` harness (runner-direct.test.ts) extended to also assert record.md/feed
  agreement. Logged as a follow-up, NOT in scope for the WS1 done-when (which is about the derivations being
  one source). **WS1 is now CLOSED** — all four imperative-write removals (WS1.2 feed phase) plus the three
  re-basings (WS1.2 feed, WS1.3 portable, WS1.4 record) are pinned to agree. The unrelated eslint-adoption
  dirt (`eslint.config.mjs`, `run.ts`, `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`, `runner.ts`'s
  `SessionRef` import hunk, `oz-host.ts`, `proof-daemon-reload.mjs`, `tsconfig.eslint.json`) was preserved,
  NOT committed.
- **Exact next step (WS2 — Introduce/standardize the structured agent→runner progress channel):** Per the
  freshly sharpened WS2 spec, audit every `readScreen`/frame consumer — `monitor.ts`, `agent-step.ts`, the
  Deb watcher, the Oscar nudge watchdog — and partition what each reads into liveness/idle (legitimate
  heartbeat) vs. semantic verdict (must migrate). The terminal may drive ONLY liveness/idle; every semantic
  signal (done/blocked/progress) migrates to a structured artifact the agent emits and the runner reads (the
  WS0 markers `<<<COCODER-ATOM-N-BLOCKED: reason>>>` + done sentinel and the loop-ledger are the precedents
  to extend — a missing channel like mid-atom progress is ADDED as a marker, never inferred from the screen).
  Done-when: a test proves no terminal frame content can produce a fault or a state transition, AND any
  remaining screen-read semantic signal has been migrated to an artifact (not replaced by a new heuristic).
  Map the consumers first (per protocol); implement tests-first; verify with the same command set.

## 2026-06-24 — Spec amendment (no change to next step; WS1.5 still next)

- Amended `runner-decoupling-refactor.md` (commit follows): **WS2** sharpened from "stop scraping" to
  "introduce/standardize a structured agent→runner progress channel" — terminal = DISPLAY + liveness/idle
  HEARTBEAT only, every semantic signal (done/blocked/progress) travels as a structured artifact (WS0
  markers + loop-ledger are the precedents); done-when keeps "no frame content can fault/transition" AND
  adds "any remaining screen-read semantic signal is migrated to an artifact, not a new heuristic". **WS4**
  gained a named deliverable: de-flake the Deb-watcher stall family (`Deb-backed watchdog nudges an idle
  Oscar`, `writes a live status feed …`, `actionable stall Deb watch …`) by injecting/pinning the clock
  (`now`) so timer-based stall logic is deterministic; done-when the family is green across repeated
  full-parallel runs. The immediate next step is UNCHANGED — WS1.5, the surface-agreement closeout test.

## 2026-06-24 — WS1, step 4 (re-base record.md / renderRunRecord on the event log)

- **Workstream/step:** WS1 (Surface unification), step 4 — make `record.ts` / `renderRunRecord`'s only
  run-summary field, **Status**, a PROJECTION of the event log instead of the imperatively-set
  `store.getRun().status` row. ADDITIVE/behavior-preserving: like WS1.3, NO surface shifts.
- **Commit:** `23f41d1` — "runner(status): WS1.4 — derive record.md Status from the event log". (Ledger
  entry committed separately, matching WS1.3.)
- **Files:** `packages/core/src/runner/record.ts` (import `deriveRunSummary`; derive `summary` from
  `store.listEvents`; `**Status**` line reads `summary?.status ?? run.status`), `packages/core/tests/
  record.test.ts` (new `statusLine` helper + `renderRunRecord — WS1.4 …` describe: 6 tests — 4 terminal
  shapes + agree case + non-terminal fallback).
- **Map (owners/emitters/consumers/tests):**
  - *Source of truth:* the terminal `run-end` event's `data.status`. Emitted by the four runner exits —
    completion (`runner.ts:2027`), `fail()` (`1054`), `stopRun` (`1693`), `holdRun` (`1731`). The three that
    WRITE record.md (completion `2038`, stopRun `1702`, holdRun `1739`) record `run-end` AND call
    `setRunStatus(status)` (`2033/1699/1737`) BEFORE `io.writeRunRecord` → `renderRunRecord`, so at render
    time the row and the event already agree. (`fail()` does NOT call `writeRunRecord` — failed runs emit no
    record.md at runtime; the FAULTED test asserts derivability for completeness, not a runtime path.)
  - *Imperative coupling removed:* `renderRunRecord` read `run.status` (the DB row set by `setRunStatus`) for
    its `**Status**` line. Now derived via `deriveRunSummary(store.listEvents(runId))` (reused from WS1.3 —
    NOT re-derived), falling back to `run.status` only when there is no terminal `run-end` event.
  - *Other run-row fields kept imperative by design:* `run.createdAt`/`run.endedAt` (wall-clock captured by
    the runner; the `run-end` event's `at` differs — deriving WOULD shift `record.md`'s Started/Ended, the
    WS1.3 trap) and `run.priorityId`. The `meta` arg (`workspace`, `priority.title`, `displayNumber`) is
    legitimately injected (not in the event log) — like `scopes`/`priority` in `renderDebStatus`. The other
    record sections already project events/rows: commits via `listCommitLinks`, out-of-lane via
    `out-of-scope-committed` events, branch via `direct-mode` (WS1.1/1.2 noted), event log via `listEvents`.
  - *Surface/consumer:* `io.writeRunRecord(runDir, renderRunRecord(...))` (`io.ts:155`) → `record.md`. The
    `renderRunRecord` SIGNATURE is unchanged. The WS1.2 feed-after-portable-AND-record ordering is preserved
    (no runner edit this step).
  - *Tests (regression guard):* `record.test.ts` — the 4 pre-existing tests (heading/branch) plus the 6 new.
- **Why no surface shifts:** the derived `status` reads the SAME `run-end` event that `setRunStatus` was
  handed at each record-writing exit, recorded immediately before rendering ⇒ derived === former
  `run.status` read, by construction. The fallback covers the only render where no `run-end` exists (a
  non-terminal render), leaving that path byte-identical.
- **Determinism (WS1.1 rule honored):** `RunSummary` has NO event-`at` field; the new tests build ONE
  `:memory:` store per shape, record `run-end` with the runner's tuple, and (for the 4 terminal tests) leave
  the row at its default `running` to prove the render reads the EVENT, not the row — no two-store
  deep-equal, no wall-clock to drift.
- **Tests/results:** `pnpm --filter @cocoder/core test record` → 10 passed (4 existing + 6 new; the 4
  terminal-shape tests were RED before the swap — `running` instead of the derived status); `pnpm --filter
  @cocoder/core test` → **567 passed** (was 561; +6 new); `pnpm --filter @cocoder/core typecheck` → clean;
  root `pnpm typecheck` → clean (7 pkgs); `node scripts/check-topology.mjs` → passed (same 2 pre-existing
  daemon test-helper warnings). Root `pnpm test`: ALL packages green this run (personas 29, core 567,
  adapters 24, session-hosts 18, ui 161, cli 9, daemon 345) — the known Deb-watcher timer-race flake family
  did not trip.
- **Residual risk:** `record.md`'s Started/Ended/priorityId + the `meta` arg remain imperative by design (see
  map). All THREE WS1 sibling surfaces (DebStatus feed, portable `run.json`, `record.md`) now derive their
  run-level status from the same `run-end` event — but nothing yet ASSERTS the three agree on a single
  terminal run; that cross-surface agreement test is WS1 step 5 (the WS1 done-when). The unrelated
  eslint-adoption dirt (`eslint.config.mjs`, `run.ts`, `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`,
  `runner.ts`'s `SessionRef` import hunk, `oz-host.ts`, `proof-daemon-reload.mjs`, `tsconfig.eslint.json`)
  was preserved, NOT committed — record.ts/record.test.ts are entirely mine (neither is in the foreign list),
  so they staged directly with `git add`; no surgical apply was needed this step.
- **Exact next step (WS1, step 5 — closes WS1):** Land the surface-agreement regression test the WS1
  done-when names. For a faulted/held/stopped run, assert the THREE run-level surfaces — DebStatus feed
  (`renderDebStatus`/`deriveTerminalProjection`), portable `run.json` (`deriveRunSummary`/
  `writePortableRunHistory`), and `record.md` (`renderRunRecord`) — provably AGREE on the run's terminal
  status BECAUSE all three derive from the same `run-end` event. Build it from ONE store/run (WS1.1
  determinism rule — never deep-equal two independently-built `:memory:` stores; the event `at` drifts).
  This is a TEST-ONLY step (no surface swap): the three derivations already landed in WS1.1–1.4; step 5 pins
  that they cannot disagree by construction, which is the WS1 done-when. Verify with the same command set.

---

## 2026-06-24 — WS1, step 3 (re-base the portable run-history surface on the event log)

- **Workstream/step:** WS1 (Surface unification), step 3 — make `writePortableRunHistory`'s run-level status
  a PROJECTION of the event log instead of a runner local. ADDITIVE/behavior-preserving: unlike WS1.2, NO
  surface shifts.
- **Commit:** `6f6916b` — "runner(status): WS1.3 — derive portable run-history summary from the event log".
- **Files:** `packages/core/src/runner/status.ts` (new `deriveRunSummary` + `RunSummary` type, beside
  `deriveTerminalProjection`; import `RunStatus`), `packages/core/src/index.ts` +
  `packages/core/src/runner/index.ts` (re-export both), `packages/core/src/runner/runner.ts`
  (`projectAndCommitPortableRunHistory` derives `terminal.status` via `deriveRunSummary(store.listEvents)`;
  its param drops `status` → `{ endedAt }`; the four exits stop passing `status`),
  `packages/core/tests/status.test.ts` (new `deriveRunSummary — WS1.3 …` describe: 5 tests).
- **Map (owners/emitters/consumers/tests):**
  - *Source of truth:* the terminal `run-end` event's `data` `{ status, atoms, committedShas, outOfScope,
    selfCommitted }`. Emitted by FOUR runner exits — completion (`runner.ts:2029`), `fail()` (`1054`),
    `stopRun` (`1695`), `holdRun` (`1733`) — and in every case recorded BEFORE
    `projectAndCommitPortableRunHistory`, so the event log already carries the whole summary at projection time.
  - *Imperative coupling removed:* `projectAndCommitPortableRunHistory({ status, endedAt })` threaded `status`
    — the same value already in `run-end` — into `writePortableRunHistory`'s `terminal.status`, which
    overrides `storedRun.status` (stale because `setRunStatus` runs AFTER the projection). Now `status` is
    derived; the arg is `{ endedAt }` only.
  - *Surface:* `writePortableRunHistory`/`portableRunFile` (`store/portable/projection.ts:19,39`) → `run.json`
    `status`. The other four summary fields reach portable output ONLY via the `run-end` event serialized into
    `events.jsonl` (already a pure projection — untouched). `writePortableRunHistory`'s SIGNATURE is unchanged.
  - *Other caller (kept byte-identical):* `store/portable/migrate.ts:40` passes NO `terminal` → uses
    `storedRun` (already terminal for historical runs). Signature untouched ⇒ migrate path unaffected (its
    4 tests stay green).
  - *Tests (regression guard):* `runner-direct.test.ts`'s `expectPortableTerminalHistory` drives REAL runs to
    completed/failed/stopped and asserts `run.json.status` + `endedAt` is a Number — the behavior-preservation
    guard for the swap. `portable-migrate.test.ts` guards the migrate path.
- **Why no surface shifts:** the derived `status` reads the SAME `run-end` event the arg `status` was written
  into, recorded immediately before the projection in all four exits ⇒ derived === former arg, by construction.
  `endedAt` deliberately stays imperative: the `run-end` event's wall-clock `at` differs from the captured
  `endedAt`, so deriving it WOULD shift `run.json.endedAt` (the one trap to avoid here).
- **Determinism (WS1.1 rule honored):** `RunSummary` has NO event-`at` field, so the new tests build ONE
  `:memory:` store per terminal shape, record `run-end` with the runner's exact tuple, and assert
  `deriveRunSummary(...)` `toEqual` that tuple — no two-store deep-equal, no wall-clock to drift.
- **Tests/results:** `pnpm --filter @cocoder/core test status` → 23 passed (18 + 5 new);
  `pnpm --filter @cocoder/core test runner-direct portable` → 29 passed (real-run portable guards green);
  `pnpm --filter @cocoder/core test` → **561 passed** (was 556; +5 new); `pnpm --filter @cocoder/core
  typecheck` → clean; root `pnpm typecheck` → clean (7 pkgs); `node scripts/check-topology.mjs` → passed
  (same 2 pre-existing daemon test-helper warnings). Root `pnpm test`: all packages green EXCEPT one flaky
  core failure under full parallel load — `runner.test.ts > … writes a live status feed so Deb can report
  concrete run state (ADR-0016)` — which is a member of the KNOWN Deb-watcher timer-race flake family
  (flagged in WS0/WS1.1/WS1.2); it PASSES in isolation (`-t "writes a live status feed"` → 1 passed) and is
  NOT a regression from this core-only change.
- **Residual risk:** `writePortableRunHistory`'s signature still ACCEPTS `terminal.{status,endedAt}` (the
  migrate caller relies on the no-terminal branch); WS1.3 only stops the RUNNER from hand-feeding `status`.
  `endedAt` remains an imperative input by design. `record.ts`/`renderRunRecord` (the third sibling surface)
  is still imperative — that is WS1.4. The unrelated eslint-adoption dirt (`eslint.config.mjs`, `run.ts`,
  `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`, `runner.ts`'s `SessionRef` import hunk, `oz-host.ts`,
  `proof-daemon-reload.mjs`, `tsconfig.eslint.json`) was preserved, NOT committed — `runner.ts` was staged
  hunk-by-hunk (`git apply --cached` of a patch with the `SessionRef` hunk filtered out) so only WS1.3 hunks
  landed; the staged-only tree typechecks clean (verified via `git stash --keep-index`).
- **Exact next step (WS1, step 4):** Re-base the THIRD sibling surface — `record.ts` / `renderRunRecord`
  (`packages/core/src/runner/record.ts`) — on the event log. It is consumed by `io.writeRunRecord` at every
  terminal exit (`runner.ts` completion/`stopRun`/`holdRun`, after the portable commit). Map what it reads
  imperatively from runner locals/args vs. what is derivable from `listEvents` (it already reads `direct-mode`
  + `out-of-scope-committed` events per WS1.2's note); build the derivation, assert (tests-first) it equals
  the current `record.md` on existing fixtures for the four terminal shapes, THEN swap. Keep it ADDITIVE/
  behavior-preserving (no surface shift) and preserve the WS1.2 feed-after-portable ordering. Verify with
  the same command set.

---

## 2026-06-24 — WS1, step 2 (wire deriveTerminalProjection into the runner's terminal paths)

- **Workstream/step:** WS1 (Surface unification), step 2 — wire `deriveTerminalProjection` into `holdRun`/
  `stopRun` so the Deb status feed no longer keeps a STALE pre-terminal phase after a hold/stop (the
  WS1.1-documented stale-feed gap). `fail()` already refreshed; `holdRun`/`stopRun` never called
  `refreshStatus`. This is the ONE intended BEHAVIOR change in WS1.
- **Commit:** `4298987` — "runner(status): WS1.2 — derive terminal status feed phase in hold/stop".
- **Files:** `packages/core/src/runner/runner.ts` (import `deriveTerminalProjection`; add a `refreshStatus`
  call in `stopRun` and `holdRun` sourcing `(phase, activeAtom)` from
  `deriveTerminalProjection(store.listEvents(run.id))`, `activeTask=null` + a free-text `waitCondition`),
  `packages/core/tests/runner.test.ts` (new `WS1 step 2 — terminal status feed derives its phase from the
  event log (no stale phase)` describe: 2 tests — held + stopped).
- **Map (owners/emitters/consumers/tests):**
  - *Projection owner:* `deriveTerminalProjection` (`status.ts:105`) — pure over events. held → `awaiting-founder`,
    stopped → `faulted`; both map to oscar `blocked` via the phase→oscar table (`status.ts:220`).
  - *Feed emitter:* `refreshStatus` → `writeDebEvidence` (`runner.ts:1175/1128`) — writes `deb-status.json`
    (+ terminal snapshot) and records a `deb-status` event. Only fires for a Deb-backed run (`if (!debRef) return`).
  - *Terminal call sites fixed:* `stopRun` (`runner.ts:1672`), `holdRun` (`runner.ts:1712`). The new call is
    placed AFTER `projectAndCommitPortableRunHistory` + `io.writeRunRecord` (just before the `log`/`return`).
  - *Sibling surfaces (confirmed NOT shifted):* `writePortableRunHistory` (`store/portable/projection.ts:27`)
    serializes ALL events via `listEvents` — so the new terminal `deb-status` event would land in portable
    history if recorded earlier; placing the refresh AFTER the portable commit keeps that surface byte-identical.
    `record.ts` reads only `direct-mode` + `out-of-scope-committed` events (`record.ts:10,58`), so `record.md`
    is unaffected regardless of placement. Verified by event-ordering assertions in both new tests
    (`lastIndexOf('deb-status') > indexOf('run-end')`).
- **Behavior change (the intended one):** a held run's terminal feed was oscar `waiting` (stale
  `awaiting-directive`); a stopped run's was oscar `running` — both now correctly read oscar `blocked` with the
  terminal `activeAtom`. The tests pin the OLD stale values as the pre-fix baseline (red before the wire-up,
  green after). No other surface changed.
- **Determinism (WS1.1 rule honored):** the "matches the projection" assertion renders the canonical
  `renderDebStatus` from the SAME post-run store/run as the on-disk feed (one store → identical event `at`),
  and compares only the projection-controlled fields (`oscar`, `activeAtom`, `bob`, `verify`,
  `outstandingFaults`, `handoffs`) — excluding render-time `generatedAt` and the still-imperative free-text
  `waitCondition`/`activeTask`. No deep-equal of two independently-built `:memory:` stores.
- **Tests/results:** `pnpm --filter @cocoder/core test runner -t "WS1 step 2"` → 2 passed (both red before the
  runner edit: held `waiting`→`blocked`, stopped `running`→`blocked`); `pnpm --filter @cocoder/core test` →
  **556 passed** (was 554; +2 new); `pnpm --filter @cocoder/core typecheck` → clean; root `pnpm typecheck` →
  clean (7 pkgs); `node scripts/check-topology.mjs` → passed (same 2 pre-existing daemon test-helper warnings).
  Root `pnpm test`: all packages green (personas 29, core 556, adapters 24, session-hosts 18, ui 161, cli 9)
  EXCEPT one flaky daemon failure under full parallel load — `daemon-auto-reload.test.ts > daemon reload build
  failure is recorded without restarting` — which PASSES in isolation (`pnpm --filter @cocoder/daemon test
  daemon-auto-reload` → 5 passed) and exercises the dirty `scripts/proof-daemon-reload.mjs` (unrelated eslint
  dirt); it is NOT a regression from this core-only change (cf. WS0/WS1.1's known timer-flake note).
- **Residual risk:** `activeTask`/`waitCondition` remain the only imperative inputs to `renderDebStatus`
  (free-text labels — by design, NOT derivable). `record.ts` and `writePortableRunHistory` are still imperative
  surfaces (WS1 will re-base them on events in later steps). The unrelated eslint-adoption dirt
  (`eslint.config.mjs`, `run.ts`, `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`, `runner.ts`'s `SessionRef`
  import hunk, `oz-host.ts`, `proof-daemon-reload.mjs`, `tsconfig.eslint.json`) was preserved, NOT committed —
  runner.ts was staged hunk-by-hunk (`git apply --cached`) to exclude the `SessionRef` dirt hunk.
- **Exact next step (WS1, step 3):** Re-base ONE of the remaining imperative sibling surfaces on the event log.
  Recommended: `writePortableRunHistory` (`packages/core/src/store/portable/projection.ts`) — it already
  serializes the full event log per session, but the run-level summary fields (status/atoms/committedShas/
  outOfScope/selfCommitted) are passed in imperatively by the runner's `projectAndCommitPortableRunHistory`
  (`runner.ts:1609`) rather than derived from the `run-end` event. Build a derivation, assert it equals the
  current output on existing fixtures (the portable-projection tests), THEN swap the imperative inputs. Keep the
  feed-after-portable-commit ordering established here. Verify with the same command set.

---

## 2026-06-24 — WS1, step 1 (terminal projection seed + derivability test)

- **Workstream/step:** WS1 (Surface unification), step 1 — treat `renderDebStatus` as canonical and prove a
  terminal run's `DebStatus` is derivable from the event log alone; land the inventory + test before moving
  any writes.
- **Commit:** `9aa90e3` — "runner(status): WS1.1 — terminal DebStatus projection seed + derivability test".
- **Files:** `packages/core/src/runner/status.ts` (added `deriveTerminalProjection` + inventory comment),
  `packages/core/src/index.ts` + `packages/core/src/runner/index.ts` (re-export it),
  `packages/core/tests/status.test.ts` (new `deriveTerminalProjection — WS1 terminal projection seed`
  describe: 5 tests).
- **Map (owners/emitters/consumers/tests):**
  - *Owner/projection:* `renderDebStatus` in `status.ts` — pure over `store.listEvents`, but takes four
    run-state inputs imperatively.
  - *Sole emitter of those inputs:* `runner.ts` via `writeDebEvidence`/`refreshStatus`
    (`runner.ts:1128,1175`); ~10 call sites pass `(phase, activeAtom, activeTask, waitCondition)`.
  - *Terminal call sites:* `fail()` `runner.ts:1059` → `('faulted', atomIndex, null, prose)`. **`holdRun`
    (`runner.ts:1712`) and `stopRun` (`runner.ts:1672`) call `refreshStatus` NOT AT ALL** — they only record
    `run-held {park, atom}` / `run-stopped {atom}` + `run-end {status}`, so the status feed keeps a stale
    pre-terminal phase. That stale-feed gap is the WS1 prize for held/stopped.
  - *Consumer:* Deb's status feed (ADR-0016); `record.ts` / `writePortableRunHistory` are the sibling
    surfaces WS1 will also re-base on events.
  - *Tests:* `packages/core/tests/status.test.ts` (the renderDebStatus suite).
- **WS1 inventory (the work-list) — the four imperative inputs for a terminal run:**
  - `phase` — LOAD-BEARING (drives `oscar`, and `handoffs` via awaiting-directive/verifying). DERIVABLE from
    `run-end {status}` / `run-held` / `run-stopped`.
  - `activeAtom` — LOAD-BEARING (drives `verify` active-atom selection, `handoffs` file numbers, passthrough
    `json.activeAtom`). DERIVABLE from the terminal marker's `atom`, else last atom-bearing event.
  - `activeTask` — DISPLAY-ONLY pass-through (only `json.activeTask` + markdown); NOT derivable (free prose).
  - `waitCondition` — DISPLAY-ONLY pass-through (only `json.waitCondition` + markdown); NOT derivable (free
    prose). This is the "no runner-passed waitCondition the event log can't reproduce" edge the ledger named.
  - Non-run-state inputs (legitimately injected, not part of the move): `store`, `runId`, `priority`,
    `runDisplay`, `scopes`, `now`, `recentLimit`.
  - Coarseness logged: `stopped` has no dedicated RunnerPhase/OscarState → projection maps it to `'faulted'`
    (→ oscar `'blocked'`), the generic terminal-blocked state. A dedicated terminal OscarState is a later
    refinement, not this step.
- **Tests/results:** `pnpm --filter @cocoder/core test status` → 18 passed (13 existing + 5 new);
  `pnpm --filter @cocoder/core test` → **554 passed** (was 549); `pnpm --filter @cocoder/core typecheck` →
  clean; root `pnpm typecheck` → clean (7 pkgs); root `pnpm test` → all green (personas 29, core 554,
  adapters 24, session-hosts 18, ui 161, cli 9, daemon 345); `node scripts/check-topology.mjs` → passed
  (same 2 pre-existing daemon test-helper warnings as WS0). The WS0-noted timer-flaky idle-Oscar-nudge test
  did not trip this run.
- **Residual risk:** `deriveTerminalProjection` is a SEED only — nothing in `runner.ts` consumes it yet, so
  no behavior changed and the held/stopped stale-feed bug still exists at runtime (now provably fixable).
  `record.ts` / `writePortableRunHistory` are still imperative and untouched. The unrelated dirty working
  tree (eslint adoption: `eslint.config.mjs`, `run.ts`, `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`,
  `runner.ts`, `oz-host.ts`, `proof-daemon-reload.mjs`, `tsconfig.eslint.json`) was preserved, NOT committed.
- **Correction (progress-check follow-up, commit `885f839`):** WS1.1's "DebStatus rendered from the derived
  pair matches the canonical one" test was non-deterministic — it built two `:memory:` stores and
  deep-equalled the full `DebStatus`, but `recordEvent` stamps event `at` with real wall-clock (surfaced via
  `lastDirectiveAt`/`recentEvents[].at`), so the two stores drifted and the deep-equal flaked under parallel
  load (the "554 passed" self-report was a lucky run). Fixed by rendering both from ONE store/run. The core
  suite is now stable across repeated full runs. NOTE: a SEPARATE pre-existing flake remains —
  `runner.test.ts > Deb-backed watchdog nudges an idle Oscar …` (timer-sensitive, flagged in WS0, unrelated
  to this refactor); treat it as known background noise, not a regression, until it gets its own fix.
- **Exact next step (WS1, step 2):** Wire `deriveTerminalProjection` into the runner's terminal paths so
  `holdRun`/`stopRun`/`fail` no longer hand-feed `phase`/`activeAtom` — call `refreshStatus` in `holdRun` and
  `stopRun` (they currently don't) using the derived pair, and assert (test-first) the on-disk terminal
  `DebStatus` now matches the projection (closing the stale-feed gap). Keep `activeTask`/`waitCondition` as
  the only remaining imperative inputs for now (free-text labels). Verify with the same command set.

---

## 2026-06-24 — WS0 (pre-work, this audit session)

- **Workstream/step:** Root-cause fix that motivated this priority (not part of WS1–WS5; the baseline).
- **Commit:** `bca1b27` — "runner: structured builder-blocker signal + quarantine faulted atoms".
- **Files:** `packages/core/src/runner/blocker.ts`, `agent-step.ts`, `prompts.ts`;
  `packages/core/tests/blocker.test.ts`, `runner.test.ts`, `prompts.test.ts`.
- **What changed:** Blocker detection is now a structured, echo-proof per-atom marker
  (`<<<COCODER-ATOM-N-BLOCKED: reason>>>`) symmetric with the done sentinel — no more terminal prose
  keyword-scraping, so the runner can never classify its own echoed dispatch as a blocker. Faulted atoms
  are now quarantined before the fault reaches Deb, so a deb-repair commit cannot sweep builder residue.
- **Tests/results:** `pnpm --filter @cocoder/core test` → 549 passed; `pnpm --filter @cocoder/core
  typecheck` → clean; root `pnpm typecheck` → clean (7 pkgs); `node scripts/check-topology.mjs` → passed
  (2 pre-existing test-helper warnings, unrelated). Full `pnpm test` is green in isolation; one
  timer-flaky idle-Oscar-nudge test can fail under full parallel load (pre-existing, unrelated).
- **Residual risk:** `runner.ts` is still the entangled 2000-line owner; `status.ts` re-derives state with
  its own heuristics that can drift from the runner's phase; commit logic is duplicated across paths.
- **Exact next step (WS1, step 1):** In `status.ts`, treat `renderDebStatus` as the canonical projection
  and ADD a parallel projection assertion test proving the `DebStatus` for a faulted/held/stopped run is
  fully derivable from the event log alone (no runner-passed `waitCondition` that the event log can't
  reproduce). Identify every field currently fed imperatively by the runner vs. derivable from events;
  that inventory is the WS1 work-list. Land the test + inventory first, before moving any writes.
