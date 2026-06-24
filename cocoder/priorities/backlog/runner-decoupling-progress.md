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

## 2026-06-24 — WS3, step 4 (route the baseline import onto the spine — WS3 COMPLETE)

- **Workstream/step:** WS3 (One commit spine), step 4 — route the LAST raw `git.addAndCommit` caller in the
  codebase (`daemon/src/routes.ts:434`, `commitBaselineTree`) onto the spine's `commitFiles`. **WS3 is now
  COMPLETE: every commit in the codebase funnels through `commit-gate/workspace-commit.ts`.** Re-grep
  confirms the only `.addAndCommit(` call sites left in `packages/*/src` are the spine's own two
  (`workspace-commit.ts:69`, `:92`); no raw caller remains.
- **The swap (byte-identical args):** `await ctx.git.addAndCommit(repoPath, ['.'], 'chore: import existing
  tree (baseline)', COCODER_GOVERNANCE_AUTHOR)` → `const receipt = await commitFiles(ctx.git, repoPath,
  ['.'], 'chore: import existing tree (baseline)', COCODER_GOVERNANCE_AUTHOR); if (receipt.error !== null)
  throw new Error(receipt.error)`. `commitFiles` passes `['.']` straight to `addAndCommit` — same repo, list,
  message, author. The `changedFiles().length === 0` early-return guard above is byte-unchanged.
- **Decision (resolved explicitly, per the prompt's DESIGN):**
  - **`commitFiles`, NOT `commitScoped`.** `['.']` is a FIXED daemon-authored "commit everything as a baseline
    import" argument — `git add .` captures UNTRACKED files (the new repo's whole tree). `commitScoped` would
    (a) re-read `changedFiles` (a SECOND read after the guard) and (b) commit that specific list instead of
    `['.']`, DROPPING untracked files `git add .` would have captured — a behavior change. The daemon authored
    the `['.']` argument, so the controlled-list `commitFiles` is the contract-correct, behavior-preserving
    primitive (no scope partition, no second read).
  - **PRESERVE throw-on-failure.** The old direct `addAndCommit` THREW on failure; the throw propagates out of
    `commitBaselineTree` (line 845 is OUTSIDE createWorkspace's try/catch, which ends at the scaffold step) →
    `dispatchMutations` → `handle().catch()` (`server.ts:172`) → **500 "internal error"**. `commitFiles`
    SURFACES a failure as `{committed:false, error}` WITHOUT throwing, so the swap re-throws on `receipt.error`
    — a failed baseline import is NEVER swallowed into a 201 success. (Mirrors `commitGovernance`'s receipt
    check, but that path audits + returns the receipt by design; baseline must THROW, so it re-throws.)
  - **No recording.** Confirmed `commitBaselineTree` records NOTHING — no store event, no audit-log line (it
    only calls the primitive). The daemon's durable home is the audit log/SSE, NOT the store event log, and
    this path emits to neither, so the WS3.3 `recordSuccessfulCommit` helper does NOT apply (it is a core
    store-event helper). Only the throw-on-failure propagation is preserved.
- **Map (owner → primitive → callers → tests, re-grepped before editing):**
  - *Owner / only remaining raw caller:* `commitBaselineTree` (`routes.ts:432`). Sole call site:
    `createWorkspace` (`routes.ts:845`), gated by `baselineCommitted = initializedRepo && receipt.committed`
    (so baseline runs only for a freshly-`initRepo`'d primary root whose governance commit succeeded).
  - *Spine target (unchanged):* `commitFiles(git, repo, files, msg, author?)` (`workspace-commit.ts:60`) —
    error XOR sha, records nothing. Import added to `routes.ts`'s `@cocoder/core` block.
  - *Sibling already on the spine (the pattern mirrored):* `commitGovernance` (`launcher.ts:434`) wraps
    `commitFiles`; the other daemon commit paths (`launcher.ts` `commitFiles:435`, `runCommitGate:1013`,
    `gateCommitRepair:1234/1777`) already sit on the spine. This chunk finished the daemon side.
  - *Tests pinning the behavior:* `mutations.test.ts` `POST /workspaces initializes and commits governance
    for a non-git primary root` (real-git baseline SUCCESS pin — `git log -1` is `chore: import existing tree
    (baseline)`, `package.json`/`src/app.ts` committed, `node_modules` gitignore-skipped) and `…leaves an
    existing git root remote and root gitignore untouched` (baseline-SKIPPED pin, `baselineCommitted:false`).
    Both pin the observable CONTRACT (git state / message / disclosure), not the raw primitive, so the swap
    leaves them green with NO rewrite. NEW: `POST /workspaces surfaces a baseline-import commit failure as a
    500 (never a silent success)`.
- **Tests-first (the new pin):** added `mutations.test.ts` — a git that delegates to real `makeGit()` for
  every call EXCEPT `addAndCommit(['.'])`, which throws. Governance commits really (real sha →
  `baselineCommitted` true → baseline runs), the baseline `['.']` commit throws → asserts **500** AND that
  the workspace is NOT surfaced by `GET /workspaces` (the registry write happens AFTER `commitBaselineTree`,
  so the throw leaves it unregistered). This is NOT red→green (pre-swap the raw `addAndCommit` threw to the
  same 500); like the WS3.1 pin its teeth are regression: if a future edit drops the `receipt.error` re-throw
  and lets `commitFiles` swallow the failure, baseline would report a phantom 201 and this pin goes red.
- **Why ADDITIVE / behavior-preserving:** byte-identical commit args, same `git add .` untracked-capture
  semantics, same throw→500 on failure, no store/audit/SSE change, no surface shift. A fake git cannot
  distinguish a direct `addAndCommit` from a `commitFiles` call (both invoke `addAndCommit`); the real-git
  success pin asserts the resulting git state, which is identical.
- **Commit:** `94dd410` — "commit-gate(spine): WS3.4 — route the baseline import onto the spine (last raw
  addAndCommit caller removed)". (Ledger entry committed separately, matching WS1.3/1.4/2.1/3.1/3.2/3.3.)
- **Files:** `packages/daemon/src/routes.ts` (import `commitFiles`; swap `addAndCommit`→spine + re-throw on
  receipt.error), `packages/daemon/tests/mutations.test.ts` (+1 throw-on-failure pin). Both are mine and
  NOT in the eslint foreign list, so `git add` staged them directly; no surgical apply needed.
- **Tests/results:** `pnpm --filter @cocoder/daemon test mutations` → 120 passed (incl. +1 new); `pnpm
  --filter @cocoder/daemon test` → **346 passed** (was 345; +1 new); `pnpm --filter @cocoder/daemon
  typecheck` → clean; root `pnpm typecheck` → clean (7 pkgs); `node scripts/check-topology.mjs` → passed
  (same 2 pre-existing daemon test-helper warnings); root `pnpm test` → ALL green in ONE run (personas 29,
  core 582, adapters 24, session-hosts 18, ui 161, cli 9, daemon 346) — the known Deb-watcher timer-race
  flake family did NOT trip (this chunk is daemon-package only and does not touch the Deb watcher or runner).
- **Residual risk:** WS3 is COMPLETE — one module (`workspace-commit.ts`) owns "write tracked files + return
  a receipt"; ALL callers use it; the in-run recording is centralized (WS3.3, except P5 by design); the
  run_231 sweep-guard (`runner.test.ts:3688`/`:3819`) still holds (untouched this chunk). Each caller still
  owns its own failure convention by design (re-throw / `deb-repair-commit-failed` / throw /
  `DirtyWorkingTreeError` / baseline re-throw→500) — intended, not duplication. The unrelated eslint-adoption
  dirt (`eslint.config.mjs`, `run.ts`, `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`, `runner.ts`'s
  `SessionRef` import hunk, `oz-host.ts`, `proof-daemon-reload.mjs`, `tsconfig.eslint.json`) was preserved,
  NOT committed — routes.ts/mutations.test.ts are mine and staged directly; no surgical apply.
- **Exact next step (WS4 — de-flake the Deb-watcher stall family):** WS3 is done; per the priority's ordering
  WS4 is next, and its NAMED deliverable (the prerequisite all prior WS3 entries flagged "do BEFORE any
  watcher change") is **de-flaking the Deb-watcher stall family**: at least `Deb-backed watchdog nudges an
  idle Oscar`, `writes a live status feed so Deb can report concrete run state`, `actionable stall Deb watch
  writes current lastDispatch before prompting Deb`, and `Deb watch dispatches are non-blocking …` (passes in
  isolation, fails intermittently ~1 per several full-parallel `pnpm test` runs — NOT a regression). Root
  cause (per WS spec): they exercise timer-based stall logic against REAL timers while the orchestration code
  already injects its clock (`now`) — the tests just don't pin it, so stall timing races the suite's load.
  Fix: inject/pin the clock (and `sleep`) in those tests so stall timing is deterministic, not wall-clock
  dependent (the WS2.1 `ws2-prose-inert.test.ts` is the precedent — it drives `runMonitor` over a constant
  frame with injected `sleep`/`now`). Map the Deb watcher (`startDebWatcher`, `runner.ts:~1295`) and its
  injected clock seam first; tests-first; the full suite must be green across REPEATED full-parallel runs
  (restoring "green at every commit" as a clean signal). Then WS5 (split `runner.ts`) is unblocked (it
  requires WS4's test-hardening). This is a `@cocoder/core` runner-tests chunk — verify with the core +
  full command set; run `pnpm test` MULTIPLE times to confirm the flake is gone.

---

## 2026-06-24 — WS3, step 3 (centralize the SUCCESS-path recording onto one helper)

- **Workstream/step:** WS3 (One commit spine), step 3 — CENTRALIZE THE SUCCESS-PATH RECORDING ONLY
  (`routes.ts:434` is step 4 — NOT done here). Collapsed the duplicated success-path event recording that
  P1/P2/P4 each hand-rolled around a spine receipt into ONE helper. The two receipt SHAPES were already
  unified (WS3.2); this removes the last in-run *recording* duplication.
- **The helper:** `recordSuccessfulCommit(store, rec)` — NEW file `packages/core/src/commit-gate/record-commit.ts`,
  exported via `commit-gate/index.ts` + core `index.ts`. Records the STANDARD success-path set, in order:
  `agent-self-commit` (IFF `rec.selfCommit !== null`) THEN `recordCommitLink` + `commit` (IFF
  `rec.committedSha !== null`). `selfCommit` is CALLER CONTEXT (`{headBefore, headNow}`), NOT read off the
  receipt — a plain `commitFiles` `CommitReceipt` carries no self-commit signal, so reading it would
  silently drop `agent-self-commit` for P2/P4. SUCCESS path only: every failure convention stays at the
  call site; the gate's advisory `out-of-scope-committed` flag stays in the gate.
- **Decision (resolved explicitly — why P1's agent-self-commit does NOT move into the helper):** P1's
  `agent-self-commit` (`gate.ts:63`) fires at gate ENTRY whenever the agent self-committed — INDEPENDENT of
  whether a commit is made. It fires on TWO non-commit paths the success helper never runs: (a) an
  `auditWriteBoundary` refusal (`gate.ts:68` throws AFTER recording self-commit), and (b) a self-commit with
  an empty `changed` (no gate commit — pinned by `commit-gate.test.ts` "detects an agent self-commit",
  `changed: []`). A success-only helper CANNOT reproduce that timing, so moving it would DROP the event on
  those paths = behavior change. P1 therefore keeps its line-63 self-commit and calls the helper with
  `selfCommit: null` for the link+commit pair only. P2/P4 have no such entanglement (their self-commit is a
  pre-commit detection with no throw/empty-commit branch between it and the commit recording), so they route
  their self-commit THROUGH the helper.
- **Routing (each path's exact before/after, order-preserving):**
  - **P1 — `runCommitGate` (`gate.ts:87-92`→):** `recordCommitLink`+`commit` → `recordSuccessfulCommit(...,
    selfCommit: null)`. agent-self-commit untouched at `:63`; `out-of-scope-committed` untouched at `:94`.
  - **P2 — deb-repair manual path (`runner.ts:1253-69`):** removed the inline `if (selfCommittedRepair)
    agent-self-commit` (was `:1256`, BEFORE `commitFiles`) and the inline `if (receipt.committedSha)`
    link+commit (`:1260-61`); now ONE `recordSuccessfulCommit(..., selfCommit: selfCommittedRepair ?
    {headBefore: headBeforeRepair, headNow} : null)` AFTER `commitFiles`. `commitFiles` records no store
    event, so moving self-commit from before-commit to after-commit introduces NO intervening event → order
    unchanged (`agent-self-commit`, `commit`-link, `commit`, then `deb-repair-commit-failed`,
    `deb-repair-out-of-scope-held`). The `inScope`-only `partitionByScope` (`:1257`) and the
    quarantine-before-fault sweep guard are byte-unchanged; `gate = {...receipt, outOfLane, selfCommitted}`
    is unchanged.
  - **P4 — `projectAndCommitPortableRunHistory` (`runner.ts:~1640-55`):** removed the inline
    pre-`commitFiles` agent-self-commit and post-`commitFiles` link+commit; now ONE
    `recordSuccessfulCommit(..., selfCommit: historySelfCommitted ? {headBefore, headNow} : null)`. P4's
    FAILURE convention (THROW on `receipt.error`) stays at the caller, moved to JUST AFTER the helper —
    safe because `commitFiles` returns error ⟹ null sha (`workspace-commit.ts:67-73`), so the helper records
    NO link/commit before the throw. `historySelfCommitted` is still computed BEFORE `commitFiles` (which
    moves HEAD), so the self-commit detection value is identical.
- **EXCLUDED P5 (pre-run snapshots, `runner.ts:~893,903`):** verified it records ONLY
  `founder-presnapshot[-failed]` / `governance-presnapshot[-failed]` events — NEVER `recordCommitLink`/
  `commit`/`agent-self-commit`. Routing it through the helper would ADD commit-link/commit events it never
  emitted = a surface change. P5 stays bespoke (its own `DirtyWorkingTreeError` convention untouched).
- **Map (owner → emitter → consumers → tests, re-grepped before editing):**
  - *recordCommitLink / `commit` emitters (pre-edit):* `gate.ts:91-92` (P1), `runner.ts:1260-61` (P2),
    `runner.ts:1652-53` (P4). *agent-self-commit emitters:* `gate.ts:63` (P1), `runner.ts:1256` (P2),
    `runner.ts:1647` (P4). All three success-path pairs now flow through `recordSuccessfulCommit`; P1's
    self-commit stays at `gate.ts:63`.
  - *Spine primitive (unchanged):* `commitFiles` (`workspace-commit.ts:60`) — error xor sha, records nothing.
  - *Consumers of the events (unchanged):* `deb-repair` event still reads `gate.committedSha/committedFiles/
    outOfLane` (`runner.ts:1283`); `absorbGateResult`, `deriveRunSummary`, run-history surfaces read the SAME
    `commit`/`agent-self-commit`/commit-link rows the helper now writes.
  - *Tests pinning the contract:* NEW `commit-gate.test.ts` describe `recordSuccessfulCommit — the standard
    success-path event set (WS3.3)` (4 pins: full order+data+link; selfCommit null → no self-commit;
    null sha → self-commit but NO link/commit; nothing → nothing). Regression guards (unchanged behavior):
    `commit-gate.test.ts` gate suite (self-commit detect, audit refuse, WS3.1 failure pin), `runner.test.ts:3688`
    + `:3819` (run_231 sweep-guard + recurrence escalation — both green; neither triggers a self-commit).
- **Why ADDITIVE / behavior-preserving:** same event types, data keys, AND order on every path. The only
  motion is agent-self-commit emission point for P2/P4 (before→after `commitFiles`, no intervening store
  event) and the P4 throw (before→after the helper, guarded by error⟹null-sha). The fake-git tests cannot
  distinguish hand-rolled recording from the helper — they assert the resulting events, which are identical.
- **Tests-first / why the pins are green:** the helper is NEW code; its 4 contract pins assert the
  centralized behavior directly (they were authored against the helper, green on first run). They are NOT
  red→green against old source — there was no helper to be red against; their value is locking the
  order/conditional-emission contract so a future edit that drops self-commit or emits a phantom null-sha
  commit goes red.
- **Commit:** `b8a532b` — "commit-gate(spine): WS3.3 — centralize the success-path recording onto one
  helper". (Ledger entry committed separately, matching WS1.3/1.4/2.1/3.1/3.2.)
- **Files:** `packages/core/src/commit-gate/record-commit.ts` (NEW helper), `packages/core/src/commit-gate/index.ts`
  + `packages/core/src/index.ts` (export), `packages/core/src/commit-gate/gate.ts` (P1 routes link+commit),
  `packages/core/src/runner/runner.ts` (P2 + P4 — staged surgically), `packages/core/tests/commit-gate.test.ts`
  (+1 describe / 4 pins).
- **Tests/results:** `pnpm --filter @cocoder/core test commit-gate` → 25 passed (incl. +4 new);
  `commit-gate runner-direct` → 40 passed; run_231 `runner -t "deb-repair commit cannot sweep"` → 1 passed;
  recurrence `runner -t "recurring fault escalates"` → 1 passed; `pnpm --filter @cocoder/core test` →
  **582 passed** (was 578; +4 new); `pnpm --filter @cocoder/core typecheck` → clean; root `pnpm typecheck`
  → clean (7 pkgs); `node scripts/check-topology.mjs` → passed (same 2 pre-existing daemon test-helper
  warnings). Root `pnpm test`: first run tripped the KNOWN Deb-watcher timer-race flake (`actionable stall
  Deb watch writes current lastDispatch before prompting Deb` — passes in isolation, confirmed; this chunk
  does NOT touch the Deb watcher); re-run → ALL green (personas 29, core 582, adapters 24, session-hosts 18,
  ui 161, cli 9, daemon 345). Staged-only tree (SessionRef import present, my hunks applied) typechecks
  clean via `git stash --keep-index` — mirrors WS1.3/3.2.
- **Residual risk:** all four in-run commit paths now sit on the spine receipt AND (except P5, by design)
  the ONE recording helper. The LAST raw `git.addAndCommit` caller in the codebase is
  `daemon/src/routes.ts:434` (daemon package) — WS3 step 4. The helper centralizes recording but each caller
  still computes its own self-commit context and owns its failure convention — that is intended (the
  failure conventions differ by design: re-throw / `deb-repair-commit-failed` / throw / `DirtyWorkingTreeError`).
  This chunk did NOT touch the Deb watcher, so the known Deb-watcher timer flake does not gate it — but
  BEFORE any later WS3 chunk that CHANGES the Deb watcher, do the WS4 "de-flake the Deb-watcher stall
  family" deliverable first. The unrelated eslint-adoption dirt (`eslint.config.mjs`, `run.ts`,
  `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`, `runner.ts`'s `SessionRef` import hunk, `oz-host.ts`,
  `proof-daemon-reload.mjs`, `tsconfig.eslint.json`) was preserved, NOT committed — `runner.ts` was staged
  hunk-by-hunk (`git apply --cached` of a content-filtered patch with the `SessionRef` hunk removed);
  gate.ts/record-commit.ts/both index.ts/the test are mine and staged directly.
- **Exact next step (WS3, step 4 — route `daemon/src/routes.ts:434` onto the spine):** Replace the LAST raw
  `git.addAndCommit` caller (`daemon/src/routes.ts:434`, the baseline-tree governance commit) with the
  spine's `commitFiles` (controlled file list — daemon authored exactly those paths) so EVERY commit in the
  codebase funnels through `workspace-commit.ts`. Confirm whether the daemon route should also adopt the
  WS3.3 `recordSuccessfulCommit` durability (the daemon records receipts to its audit log + SSE, NOT the
  store event log — see `workspace-commit.ts` header: "the receipt's durable home depends on the caller"),
  so the helper may NOT apply daemon-side; if not, just the primitive swap + receipt-aware error handling.
  Re-grep `git.addAndCommit`/`addAndCommit`/`commitFiles` across `packages/daemon` to confirm `routes.ts:434`
  is the only remaining raw caller and map its current recording/error convention before editing; tests-first;
  keep the daemon suite (345) green; verify with the full command set. This is a DAEMON-package chunk — it
  does NOT touch the runner or the Deb watcher.

---

## 2026-06-24 — WS3, step 2 (unify the receipt shapes — gate speaks the spine's vocabulary)

- **Workstream/step:** WS3 (One commit spine), step 2 — UNIFY THE RECEIPT SHAPES ONLY (recording
  centralization is step 3; `routes.ts:434` is step 4 — NOT done here). Made `runCommitGate`
  (`commit-gate/gate.ts`) return the spine's `CommitReceipt` vocabulary instead of its bespoke
  `CommitGateResult`. **`CommitGateResult` is now `extends CommitReceipt` + `selfCommitted`** =
  `{committed, committedSha, committedFiles, outOfLane, error, selfCommitted}`. One receipt SHAPE across
  the spine + the gate.
- **Decision (resolved explicitly, per the prompt's DESIGN):**
  - `outOfScope` → `outOfLane` (same meaning: committed-but-flagged under advisory scope). Added
    `committed`/`error` by converging the type onto `CommitReceipt`.
  - **`selfCommitted` STAYS on the gate's receipt and is STILL computed by the gate from `headBefore`** —
    the spine (`commitFiles`) never sees `headBefore`, so it cannot carry it. The gate returns the EXTENDED
    receipt (CommitReceipt + selfCommitted). NOT dropped/defaulted — it is load-bearing
    (`absorbGateResult` → run-end `{selfCommitted}` → `deriveRunSummary` → `RunResult`).
  - The gate **re-throws on commit failure** (WS3.1's null-sha re-throw), so on return `error===null` and
    `committed===(committedSha !== null)`. `committedFiles` is still the full `changed` list (== what the
    spine's `commitFiles` commits). No surface/event shift.
- **Commit:** `6ff87c6` — "commit-gate(spine): WS3.2 — unify the gate receipt onto the spine's vocabulary".
  (Ledger entry committed separately, matching WS1.3/1.4/2.1/3.1.)
- **Files:** `packages/core/src/commit-gate/gate.ts` (type → `extends CommitReceipt`; return maps
  `outOfScope`→`outOfLane`, adds `committed`/`error`), `packages/core/src/runner/runner.ts` (P2
  hand-conversion collapse + 4 field renames — staged surgically), `packages/daemon/src/launcher.ts`
  (post-wrap-support consumer reads `gate.outOfLane`), `packages/core/tests/commit-gate.test.ts` +
  `packages/core/tests/plays-request.test.ts` (field-pin renames + 1 new converged-shape pin).
- **Map (owner → emitter → consumers → tests, re-grepped before editing):**
  - *Type owners:* `CommitGateResult` (`gate.ts:32`) vs `CommitReceipt` (`workspace-commit.ts:30`). Both
    re-exported via `commit-gate/index.ts` + core `index.ts`. **CommitReceipt is unchanged** — only the
    gate's type converged onto it.
  - *Emitter:* `runCommitGate` (`gate.ts:58→`). Daemon also emits (`launcher.ts:1013`, post-wrap-support).
  - *Consumers (field access):* `agent-step.ts:382-395` (committedSha only — no rename needed);
    `runner.ts` `renderDisposition` (`:1213` `outOfLane`), `triageFault` (`:1265` hand-conversion,
    `:1279` event-data), `absorbGateResult` (`:1536` `outOfLane`), `commitOscarSupport` (`:1584` `:1588`);
    wrap-up (`:1822` — no field access); **`daemon/launcher.ts:1027/1029/1038`** (reads `gate.outOfLane` —
    in scope because the rename breaks daemon typecheck).
  - *Tests pinning the field:* `commit-gate.test.ts` (`res.outOfScope`→`outOfLane` ×2 + new shape pin),
    `plays-request.test.ts` (`ordinaryReceipt.outOfScope`→`outOfLane`). (`commit-gate.test.ts:44` is a
    `partitionByScope` result, NOT a gate result — left as-is.)
  - *Event-data / response keys stay `outOfScope`/`outOfLanePaths`* (no event/surface change):
    `runner.ts:1279,1588`; `launcher.ts:1027,1029,1038`. The VALUE now comes from `gate.outOfLane`.
- **P2 hand-conversion deleted (the prompt's named target):** `runner.ts:1265` was
  `{committedSha: receipt.committedSha, committedFiles: receipt.committedFiles, outOfScope, selfCommitted}`
  — a field-by-field remap between two shapes. Now that the gate IS `CommitReceipt + selfCommitted`, the
  manual deb-repair path and the gate return the SAME shape, so it collapses to
  `{...receipt, outOfLane: outOfScope, selfCommitted: selfCommittedRepair}`. The held-back out-of-scope
  files (deb-repair commits `inScope` only via `commitFiles`, whose receipt `outOfLane` is `[]`) are
  surfaced by overriding `outOfLane` — same data, same slot, just the spine's name. The `inScope`-only
  partition (`runner.ts:1257-58`) and the quarantine-before-fault guard are byte-unchanged.
- **Why ADDITIVE / behavior-preserving:** every event payload (`out-of-scope-committed`, `deb-repair`,
  `oscar-support-commit`, daemon `post-wrap-support-commit`) keeps its `outOfScope`/`outOfLanePaths` KEY;
  only the in-memory field name on the receipt changed. `selfCommitted` flows end-to-end unchanged. The
  fake-git tests cannot distinguish the converged shape from the old one except by the renamed field, which
  is exactly what the rewritten pins assert.
- **Tests-first / why the pins are red→green:** the field-rename pins (`res.outOfLane`,
  `ordinaryReceipt.outOfLane`) were RED against the old source (it returned `outOfScope`), green after the
  type/return swap. The new "returns the spine receipt shape EXTENDED with selfCommitted" pin asserts the
  full converged shape (`toEqual({committed, committedSha, committedFiles, outOfLane, error,
  selfCommitted})`) with BOTH a self-commit and a gate commit co-occurring — guards that selfCommitted was
  not dropped when the shapes merged.
- **Tests/results:** `pnpm --filter @cocoder/core test commit-gate plays-request` → 32 passed (incl. +1
  new); run_231 sweep-guard `runner -t "deb-repair commit cannot sweep"` → 1 passed; `pnpm --filter
  @cocoder/core test` → **578 passed** (was 577; +1 new); `pnpm --filter @cocoder/core typecheck` → clean;
  root `pnpm typecheck` → clean (7 pkgs, incl. daemon); root `pnpm test` → ALL green (personas 29, core
  578, session-hosts 18, adapters 24, ui 161, cli 9, daemon 345 — the Deb-watcher timer-race flake family
  did not trip); `node scripts/check-topology.mjs` → passed (same 2 pre-existing daemon test-helper
  warnings). Staged-only tree (SessionRef import present, my hunks applied) typechecks clean via
  `git stash --keep-index` — mirrors WS1.3.
- **Residual risk:** the SHAPES are now unified, but the EVENT RECORDING is still split — P1 records
  commit-link/commit/self-commit INSIDE the gate; P2 (`runner.ts:1256-64`) and P4 (`runner.ts:1648-49`)
  hand-roll the same set around `commitFiles`; P5 (`runner.ts:893,903`) hand-rolls a different set with a
  THIRD failure convention (`DirtyWorkingTreeError`). That is WS3 step 3 (below). `daemon/src/routes.ts:434`
  is still a raw `git.addAndCommit` caller — WS3 step 4. This chunk did NOT touch the Deb watcher, so the
  known Deb-watcher timer flake does not gate it — but BEFORE any later WS3 chunk that CHANGES the Deb
  watcher, do the WS4 "de-flake the Deb-watcher stall family" deliverable first. The unrelated
  eslint-adoption dirt (`eslint.config.mjs`, `run.ts`, `read-claims.ts`, `p3-action.ts`, `frontmatter.ts`,
  `runner.ts`'s `SessionRef` import hunk, `oz-host.ts`, `proof-daemon-reload.mjs`, `tsconfig.eslint.json`)
  was preserved, NOT committed — `runner.ts` was staged hunk-by-hunk (`git apply --cached` of a patch with
  the `SessionRef` hunk filtered out); gate.ts/launcher.ts/both tests are mine and staged directly.
- **Exact next step (WS3, step 3 — centralize the SUCCESS-path recording):** Introduce ONE recording
  helper that takes a spine receipt + run/workItem context and records the STANDARD success-path event set
  (`recordCommitLink` + `commit` + `agent-self-commit`) for P1/P2/P4/P5, so each caller stops hand-rolling
  it. Leave EACH caller's FAILURE convention untouched: P1 re-throws on null sha, P2 records
  `deb-repair-commit-failed`, P4 THROWS on `receipt.error`, P5 throws `DirtyWorkingTreeError`. Keep
  ADDITIVE/behavior-preserving (no surface/event shift); the `inScope`-only deb-repair partition
  (`runner.ts:1257-58`) MUST survive and `runner.test.ts:3688` + `:3819` (run_231 sweep-guard) MUST stay
  green — never weaken a test; rewrite to pin the new contract and say why. Re-grep
  `recordCommitLink`/`recordEvent.*commit`/`agent-self-commit`/`commitFiles` to confirm the call-site
  inventory; map owners/emitters/consumers/tests before editing; tests-first; verify with the full command
  set. THEN step 4 = `daemon/src/routes.ts:434` (the last raw `git.addAndCommit` caller — daemon package).
  NOTE: if any of this touches the Deb watcher, do WS4's de-flake first.

---

## 2026-06-24 — WS3, step 1 (route the in-run gate onto the spine — first spine EDIT)

- **Workstream/step:** WS3 (One commit spine), step 1 — the FIRST spine edit. Route **P1 `runCommitGate`
  (`commit-gate/gate.ts`)** off the raw primitive: replaced the direct `git.addAndCommit(cwd, changed,
  message)` (`gate.ts:81`) with `commitFiles(git, cwd, changed, message)` — the spine's CONTROLLED-LIST
  commit. This removes the **last IN-RUN raw-primitive caller**; P1, P3 (oscar-support), the deb-repair
  no-files fallback, and wrap-up now all sit on the spine. The only remaining raw `git.addAndCommit` caller
  in source is `daemon/src/routes.ts:434` (daemon-side, out of this chunk).
- **Decision (commitFiles, NOT commitScoped — corrects the prior ledger's exact-next-step):** the WS3 step-0
  entry below proposed `commitScoped`. That is WRONG for the gate: `commitScoped` re-reads
  `git.changedFiles` internally (`workspace-commit.ts:87`), which (a) DOUBLE-reads per gate call and desyncs
  the suite's per-call scripted-git fakes (e.g. `runner.test.ts:3688`'s `changedCalls`-indexed fake → red),
  and (b) would commit its OWN second read instead of the `changed` the gate already read/audited/recorded
  (`gate.ts:66`) — a behavior change. The gate AUTHORED the list, so `commitFiles` (explicit list, no second
  read) is the behavior-preserving, contract-correct primitive. Single-read preserved.
- **Commit:** `2eb6def` — "commit-gate(spine): WS3.1 — route the in-run gate onto commitFiles (last in-run
  raw primitive removed)". (Ledger entry committed separately, matching WS1.3/1.4/2.1.)
- **Files:** `packages/core/src/commit-gate/gate.ts` (import `commitFiles`; swap `addAndCommit` → spine + a
  null-sha re-throw), `packages/core/tests/commit-gate.test.ts` (+1 contract pin). Both are mine — neither is
  in the eslint foreign list, so `git add` staged them directly; no surgical apply.
- **Map (owner → primitive → receipt → who records the store events):**
  - *Source of truth / primitive moved:* `runCommitGate` (`gate.ts:57`). `changed` is read ONCE at
    `gate.ts:66` and partitioned for the advisory out-of-lane flag (`:77`). The commit at `:81` is the only
    thing that moved onto the spine; the `changed` read, `partitionByScope` flag, ALL internal event
    recording (`agent-self-commit`/`commit`/`recordCommitLink`/`out-of-scope-committed`), and the
    `auditWriteBoundary` hard-refuse are byte-unchanged.
  - *Spine target:* `commitFiles(git, repo, files, msg, author?)` (`workspace-commit.ts:60`) — commits the
    explicit caller list, NO `changedFiles` read, returns `CommitReceipt {committed, committedSha,
    committedFiles, outOfLane:[], error}`. The gate keeps emitting its own `CommitGateResult` (receipt SHAPES
    not yet unified — that is a later WS3 chunk).
  - *Consumers of `runCommitGate` (unchanged):* `agent-step.ts:382` (per-atom verified commit),
    `runner.ts:1572` (P3 oscar-support via `commitOscarSupport`), `runner.ts:1822` (wrap-up Play),
    `runner.ts:1267` (deb-repair no-files-changed fallback).
  - *Pinning tests (the behavior guard):* `commit-gate.test.ts` `describe('runCommitGate')` (advisory
    commit-all, out-of-lane flag, self-commit detect, audit-boundary refuse); `runner-direct.test.ts:505`
    (real-git advisory out-of-lane); `runner.test.ts:3688` + `:3819` (run_231 sweep-guard, per-call scripted
    `changedFiles`).
- **The one behavioral edge + how it is preserved:** `commitFiles` SURFACES a commit failure in the receipt
  (`error`, `committedSha:null`) instead of throwing, whereas the old `await git.addAndCommit` rejected. To
  preserve the gate's throw-on-failure contract, the swap re-throws on a null sha
  (`if (receipt.committedSha === null) throw new Error(receipt.error ?? …)`) BEFORE recording the commit link
  — so a failed commit never records a phantom link/`commit` event with a null sha. (`changed` is non-empty
  inside the block, so null sha ⟺ failure; the `?? 'spine returned no sha'` fallback is unreachable but
  satisfies the type.)
- **Typecheck note (caught + fixed):** the first cut wrote `if (receipt.error !== null) throw` then
  `committedSha = receipt.committedSha`; TS could not narrow `committedSha` to non-null for
  `recordCommitLink({commitSha})` (the old `addAndCommit` returned `string` directly, narrowing inside the
  `if`). Re-throwing on `receipt.committedSha === null` narrows the success path to `string`. Core + root
  typecheck clean after.
- **New test (the contract pin):** `commit-gate.test.ts` — "surfaces a spine commit failure by rejecting — no
  phantom commit link or commit event (WS3.1)": a fake git whose `addAndCommit` throws → `runCommitGate`
  rejects with the git message AND records no commit link / `commit` event. GREEN before and after the swap
  by design (the old code threw directly; the swap routes through the spine's error receipt + re-throw) — its
  value is regression teeth that the spine's never-swallow contract did not silently turn a commit failure
  into a phantom null-sha commit. Not red→green (like the WS1.5/WS2.1 pins).
- **Why no observed behavior shifts:** `commitFiles` calls `git.addAndCommit(cwd, changed, message)` with the
  EXACT list and message the gate passed before; the receipt's `committedSha` is the same sha; the events,
  out-of-lane flag, and self-commit detection are untouched. A fake git cannot distinguish a direct call from
  a `commitFiles` call (both invoke `addAndCommit`), which is why a "reachable only via the spine" delegation
  test is not meaningful here (an explicit pin would have to spy on the `commitFiles` export).
- **Tests/results:** `pnpm --filter @cocoder/core test commit-gate` → 20 passed (19 + 1 new); advisory-scope
  `runner-direct -t "out-of-scope"` → 2 passed; run_231 `runner -t "deb-repair commit cannot sweep"` → 1
  passed; `pnpm --filter @cocoder/core test` → **577 passed** (was 576; +1 new); `pnpm --filter @cocoder/core
  typecheck` → clean; root `pnpm typecheck` → clean (7 pkgs); `node scripts/check-topology.mjs` → passed
  (same 2 pre-existing daemon test-helper warnings). Root `pnpm test`: ALL packages green this run (personas
  29, core 577, adapters 24, session-hosts 18, ui 161, cli 9, daemon 345) — the known Deb-watcher timer-race
  flake family did not trip.
- **Residual risk:** the two receipt SHAPES still coexist — the gate emits `CommitGateResult`, the spine
  returns `CommitReceipt`, and P2 still hand-converts one to the other (`runner.ts:1265`); P2/P4/P5 still
  hand-roll their store-event recording around `commitFiles` (three failure conventions). Those are the
  REMAINING WS3 work (next step below). `daemon/src/routes.ts:434` is still a raw `git.addAndCommit` caller
  (daemon-side, explicitly out of WS3's named scope). This chunk did NOT touch the Deb watcher, so the known
  Deb-watcher timer flake does not gate it — but BEFORE any later WS3 chunk that CHANGES the Deb watcher, do
  the WS4 "de-flake the Deb-watcher stall family" deliverable first (it lives in that exact code). The
  unrelated eslint-adoption dirt (`eslint.config.mjs`, `run.ts`, `read-claims.ts`, `p3-action.ts`,
  `frontmatter.ts`, `runner.ts`'s `SessionRef` import hunk, `oz-host.ts`, `proof-daemon-reload.mjs`,
  `tsconfig.eslint.json`) was preserved, NOT committed.
- **Exact next step (WS3, step 2 — unify the two receipt shapes, then centralize the hand-rolled recording):**
  Now that every commit (in-run + daemon-launcher) funnels through the spine except `routes.ts:434`, collapse
  the DUPLICATION the step-0 map named: (a) **unify the receipt shapes** — make `runCommitGate` return (or
  internally carry) the spine's `CommitReceipt` shape instead of its bespoke `CommitGateResult`
  (`outOfScope`→`outOfLane`, add `committed`/`error`, decide `selfCommitted`'s home), and delete P2's
  hand-conversion at `runner.ts:1265`; update `absorbGateResult` (`runner.ts:1531`) and its callers
  accordingly. Then (b) **centralize the hand-rolled event recording** — P2 (`runner.ts:1256-64`) and P4
  (`runner.ts:1648-49`) hand-roll the `recordCommitLink`+`commit`(+`agent-self-commit`) that P1 records
  INSIDE the gate; P5 (`runner.ts:893,903`) hand-rolls a different set with a THIRD failure convention
  (throw `DirtyWorkingTreeError`). Introduce ONE recording helper that takes a spine receipt + run/workItem
  context and records the standard event set, so P1/P2/P4/P5 stop each rolling their own. Keep ADDITIVE/
  behavior-preserving (no surface shift); keep `runner.test.ts:3688` + `:3819` green; the `inScope`-only deb
  repair partition (`runner.ts:1257-58`) MUST survive. Map owners/emitters/consumers/tests first (re-grep
  `addAndCommit`/`commitFiles`/`commitScoped`/`runCommitGate`/`absorbGateResult`); implement tests-first;
  verify with the full command set. Finish the spine with `routes.ts:434` as the last raw-primitive removal
  (daemon package). NOTE: if any of this touches the Deb watcher, do WS4's de-flake first.

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
