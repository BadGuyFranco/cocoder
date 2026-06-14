# Rebuild Playbook

The phased, self-checking plan to get CoCoder v2 to **minimally viable**. Governed by the
charter ([`decisions/0001-rebuild-charter.md`](./decisions/0001-rebuild-charter.md)).

## Self-checking gates (applied at every phase)

Before anything is built or merged in a phase, it must pass these:

- **G1 — Seam-or-feature.** "Is this decision expensive to reverse?" If no → it's a feature,
  move it to the backlog; don't build or ADR it now. (Discipline D1.)
- **G2 — Earned guardrail.** "Does this check trace to a failure-catalog row or an observed
  dogfood failure?" If no → don't add it. (D2.)
- **G3 — One home.** "Does this concept now live in exactly one place, with references derived
  not restated?" If no → fix the model. (D4.)
- **G4 — Boundary, not docs.** "Does this deterministic check guard the agent→reality boundary
  rather than our own governance?" If no → it's governance-of-governance; delete it. (D3/D5.)
- **G5 — Phase exit met.** The phase's exit criterion below is demonstrably true.

## Phases

### Phase 0 — Architecture Q&A  ✅ seams resolved
Resolve the candidate seams in [`decisions/README.md`](./decisions/README.md) into clean ADRs,
reviewed together. Surface the eventual vision *only* to locate seams (G1). No v2 code.
**Exit:** every seam is an Accepted ADR or explicitly deferred; the v2 topology is decided (S3).

- **All seams resolved — ADRs 0001–0009 accepted** (S1, S2, S4, S5, S6, S7, S3, S8; S9 dissolved).
- **CoBuilder persona-rule audit captured** → [`persona-rules-to-carry.md`](./zArchive/rebuild-notes/persona-rules-to-carry.md) (feeds Phase-1 persona authoring).
- **Design implication discovered:** v2 needs a **shared-standards layer** — ~10 cross-persona
  global rules (root-cause-fix, verify-don't-assert, decision-classifier, the "you ARE the
  developer" premise) that personas *reference* rather than duplicate. Author alongside personas.
- **cmux socket-API spike — ✅ PASSED** ([`spikes/2026-05-28-cmux-socket-api.md`](./spikes/2026-05-28-cmux-socket-api.md)).
  SessionHost is satisfiable; needs `password` socket mode + `cd`-prepend for cwd. **Phase 0 is
  fully complete — Phase 1 (the spine) is unblocked.**
- **Follow-up surfaced:** cmux offers far more out-of-the-box than a pane host (workspaces, split
  panes, git-status sidebar, notifications, an embedded scriptable **browser**, agent
  teams/hooks). Map which features CoCoder *rides* vs *builds* — esp. the browser automation as
  Quinn's instrument. Tracked as a Phase-1 scoping task; keep leverage behind the `SessionHost`
  port so it doesn't become lock-in.

### Phase 1 — The spine (thin runner)  ✅ exit criterion met
The thinnest thing that runs a real task end to end: launch an orchestrator CLI in a workspace
on the chosen substrate; orchestrator spawns a focused sub-persona (CLI+model, prompt, working
dir, one write-scope rule); capture diff + test result + short result note into a run record.
No contracts, no boundary-resolution engine.
**Exit:** an orchestrator→coder→admin flow runs on the CoCoder repo by hand and produces a
committed diff + a run record. Post-run scope check is **block-but-surface (ADR-0007)** — not
warn-only (superseded): in-scope changes commit; out-of-scope are held back and surfaced. Earned
by F6 (explicit run↔commit linkage) + F11 (an honest gate).

**Done (2026-05-28):** `cocoder run phase1-dogfood` drove Oscar (claude) → Bob (codex) in cmux on
the CoCoder repo, producing commit `57c0781` (3 files in `packages/**`) with a linked run record
(`local/runs/<runId>/record.md`) and DB rows (run/session×2/work_item/commit_link/event). Six
packages with an inward-only topology check (with teeth); cmux `SessionHost` driver; node:sqlite
`RunStore`; flat-file personas + shared-standards; claude/codex adapters with deterministic
preflight; the commit-gate. Build notes in `decisions/` + spikes; the headless-CLI spike caught
two F10-class traps (codex stdin hang; codex auth on stderr).

### Phase 2 — Oz thin (the feedback instrument)  ✅ built (2026-05-28)
Keep the v1 daemon security posture (loopback, token, Origin/Host, CSRF, argv-only) if/where
S4 retains a daemon. Four surfaces only: workspace list · priority list + launch ·
**persona→CLI+model editor** · run list/detail (diff, output, result, deep-link to the live
session). Defer any chat-command control plane (feature, not seam — G1).
**Exit:** the founder launches every run from Oz and can see what each did.

**Built (2026-05-28):** loopback `node:http` daemon (`@cocoder/daemon`, always-on owner) + a vanilla
static dashboard (`@cocoder/ui`, no build step) over the existing ports — see
[`oz-thin.md`](./zArchive/rebuild-notes/oz-thin.md). Transport decided as loopback-HTTP-browser; the v1 security checklist
ported to node:http (C-S1/2/3/4/6/7), **C-S5 dropped as unearned** (no secret endpoint in the thin
route set — G2/F5). ADR-0004's deferred liveness probe implemented: `cocoder run` probes → client
vs standalone, two writers never coexist. ADR-0002-C1 crash-relaunch stays deferred (orphan rows are
reconciled to `failed` on daemon boot, not resumed). Preceded by a 5-lens **adversarial plan review**
(ADRs + F1–F11 + gates): 11 confirmed findings folded in before building — 3 blockers (double-created
run row → `onRunCreated` hook; cross-run working-tree commit contamination → one-in-flight-per-workspace
409; fire-and-forget zombie `running` rows → launcher `.catch` + boot reconciliation). 78 tests; six
incremental commits on `rebuild/phase-2-oz`. **Exit (founder's first real launch from Oz) pending** —
stop any stale v1 daemon on :7878 first.

### Phase 3 — Dogfood + earn guardrails
Run real CoCoder v2 work through the thin system. Each guardrail added only in response to a
repeated observed failure, smallest fix first, logged in an "earned guardrails" section here.
Likely (do not pre-build): scope warn→block, result-summary quality, session isolation.
**Exit:** N consecutive runs with zero orchestration-machinery bugs needing an in-run fix —
the spine is boring.

### Phase 4 — Adversarial layer (earned, tiered, optional)
Reintroduce an independent reviewer lane **only** with teeth (can block) and an oracle (tests
that run). Tier by change risk: light lane (writer + test gate) for small changes; full
adversarial lane for new subsystems. Re-decide which (if any) v1 primitives to port vs delete.
**Exit:** a documented light-lane / full-lane routing with the cutover rule.

### Phase 5 — First external repo
Onboard CoBuilder or cofounder: scaffold the workspace, map the repo, set personas, ship one
real product change, founder-reviewed.
**Exit:** a real change shipped through CoCoder v2 in a repo that is **not** CoCoder. This is
the only test that validates the whole bet.

## Priority roadmap (interim — migrates to Oz/DB)

The ordered view of v2 priorities. **Interim home** until full-Oz's drag-reorder owns sequencing in
Oz/the DB; one line each, derived from each Playbook (not restated), no owner/route pointer (so no
F1/F4). Active priorities are flat files in `cocoder/priorities/`; deferred ones in
`cocoder/priorities/backlog/`. See [`../priorities/AGENTS.md`](./priorities/AGENTS.md).

**Done (archived to `zArchive/v2/`):**
- `objective-presence-gate` — ADR-0010 minimal-slice gate. ✅ (`bc6c3e8`).
- `oscar-orchestrates-bob` — ADR-0013 tier 1: multi-atom loop + the reusable monitor primitive (Deb/Oz
  reuse it). ✅ built + validated live on `run_15`; plus run-id/labels/commit-gate hardening + atom isolation.
- `base-and-extension-personas` — ADR-0012 living base + repo deltas; persona loader/merge. ✅ built +
  proven on `run_17` (propagation test). Folded into the `personas-and-plays` master priority.
- `plays-mechanism` — ADR-0005 Plays registry, proven by making **wrap-up** the first Play (cheap-model
  tiering). ✅ proven end-to-end on `run_29` (`05cbcb2`).
- `deb` — ADR-0013 **tier 2**: debugger persona (watch + nudge Oscar; observe-only on Bob). ✅ built +
  **live-proven on `run_33`**: a real induced `directive-timeout` was triaged by live codex Deb →
  `cocoder-bug` with a propose-only fix; nudge-Oscar watchdog added (`34ecf13`). Cross-run learning loop /
  Deb↔dashboard reconciliation deferred to `full-oz-dashboard`.
- `loop-packets` — loop-shaped dispatch as a first-class atom shape: structured `loop` directive,
  runner-enforced caps + iteration ledger + criterion rerun before sentinel acceptance, loop-aware
  monitor, base standard + `oscar.md` guidance. ✅ built run_47/51 (7/7 atoms, zero rejections),
  measured (loop atoms = 1 round-trip ≈3.5 min avg vs ≈25.1 min comparable historical unit),
  **live-proven on `run_52`** post-restart (runner-recorded `loop-iteration` ×4 +
  `loop-criterion-rerun` ×1, plus loud malformed-loop rejection). Archived 2026-06-11
  (founder-confirmed, run_53).
- `run-resolution-and-loop-reliability` — loop unjam (runs 43–46 landed/resolved, ADR-0015 resolve
  exit built, directive-0 fix, stale-daemon self-heal, ADR-0018 drafted). ✅ objective (a)–(e)
  met 2026-06-09; run_73 follow-up hardening (`6d1b0ee`, `d37ed7b`) closed the run_71 silent-strand
  class (F17) and fixed trunkBranch reads in run records. **Archived 2026-06-13** (founder-confirmed,
  run_73; landed by hand after the runner stranded run_73's own commits — an instance of F17, the
  meta-pattern now generalized by ADR-0022). Live proof of the F17 fix is now runnable via
  `node scripts/proof-4-strands.mjs` and otherwise tracked under `orchestration-change-durability`.
- `orchestration-change-durability` — the prerequisite: every governance/orchestration change lands
  where the next session reads it. Broad-by-default access + the two-surface (A/B) boundary shipped to
  the base personas; wrap-brief single-owner enforced (proof 2, test-pinned); the terminal landing
  invariant (ADR-0022 §3) built + verified by **run_76** (3 atoms, all first-try; core 251 · daemon 198)
  and runnable as `node scripts/proof-4-strands.mjs` (**17/17 green** = the standing Proof-4). Conflicts
  resolved: ticket 0004 closed, ADR-0007 reconciled, ADR-0021 generalized — **ADR-0022 Accepted**. F18
  (orchestrator ends on un-runnable "Next Action") caught + fixed here. **Archived 2026-06-13**
  (founder-confirmed; runs 76/77).
- `deb-scoped-repair-fallback` — ADR-0016 full Deb rebuild (escalation engineer: `deb-status`,
  Oscar-only `deb-nudge`, gate-enforced `deb-repair`, cross-run recurrence escalation, base/delta
  scope split). ✅ built + **live-proven run_33** (`34ecf13`); the `deb` tier-2 entry above is its
  first slice. **Archived 2026-06-13** (priority audit) — had lingered in active `priorities/`.
- `cli-config-and-model-discovery` — per-CLI required-config injection + deterministic
  `listModels()`/`runReadiness`; `GET /clis` + `POST /clis/:id/test`; truthful Personas Model picker.
  ✅ built run_41/42 (`d76cb5a`), suites green. **Archived 2026-06-13** (priority audit); a founder
  live demo of the picker is opportunistic, not blocking.
- `daemon-auto-restart` (was backlog) — stale-daemon self-heal. ✅ delivered `4964a5a` inside
  `run-resolution-and-loop-reliability` Phase 4 (idle-only re-exec onto current HEAD, never mid-run,
  test-pinned). **Archived 2026-06-13** (priority audit) — obsolete as a standing priority.
- `isolated-working-state-per-run` — ADR-0015 run isolation + verified auto-merge + `merge-conflict`
  Play + GC. ✅ all four clauses green via `node scripts/proof-isolation.mjs` (40/40 live-git tests)
  AND exercised on **every run** (run_76/77 cut worktrees → verify → ff-merge; boot-sweep + teardown
  ran). **Archived 2026-06-13** (founder-confirmed, priority audit) — no live proof owed; runs
  continuously in production.

**Active (launchable; recommended sequence — the `priorities/` directory is the live index):**
1. `personas-and-plays` — **master priority** (merges the done `base-and-extension-personas` + the folded
   `no-brainer-plays`): one living-base+extension model for **both personas and Plays**. Completes the
   base QA roster — **Quinn** (user-simulation) and **Talia** (acceptance QA) — and lands the no-brainer
   Plays (`documentation`, `code-review`, Quinn's `electron-test`), and extends the ADR-0012 base/delta model
   to Plays. **CODE-COMPLETE (run_79):** run_78 landed Quinn+Talia, the Plays base/delta mechanism, the three
   no-brainer base Plays, and the first Play delta (`cocoder/plays/deltas/electron-test.md`); run_79 wired
   Play deltas into run-launch (`buildRunInput` → `loadEffectivePlay`, `c2a838c`) and added
   `node scripts/proof-plays.mjs` (4/4 machine-provable clauses PASS). **No buildable atoms left.**
   **Archive-candidate** pending 2 founder-present live proofs only: documentation/code-review Plays dispatch
   on assigned CLI/models on a real run; Quinn's `electron-test` delta drives the real Oz dashboard GUI with
   captured evidence (no CDP/GUI driver — run_78 boundary). Do NOT relaunch as a build run.
2. `full-oz-dashboard` — the v1-designed control plane, earned in slices; the road to feature-complete.
   **In progress / continue** — Electron dashboard wired to every existing daemon endpoint; run_54 landed
   priority reorder (ADR-0010 `order.json`), free-text ad-hoc runs, and run-drawer Resolve; run_55 landed
   sub-agents over the `plays` map (ADR-0018 stage 1), the "Awaiting you" Dashboard strip, and daemon
   priority-create (`POST …/priorities`); run_56 landed priority-create UI consumption (surface #8
   closed end-to-end), ADR-0018 stage 2 (`mode` persists + Play dispatch honors it), and an
   `ENDPOINTS_OWED.md` truth sweep; run_57 landed the Workspaces daemon model end-to-end (ADR-0019 —
   registry reader, full CRUD, Workspaces screen live with raw-path fidelity); run_58 landed
   cooperative `POST /runs/:id/stop` end-to-end (core `stopped` status, daemon endpoint, Oz-chat
   `stop` verb + dashboard Stop action); run_59 landed Oz-chat SSE end-to-end (`GET /oz/events` +
   UI consumption debounced into existing refresh paths, polling retained as fallback) and ADR-0018
   stage 3 for the Oscar session (`OscarDriver` seam, headless honoring via one-shot
   captured-subprocess invocations, Personas run-mode editor for Oscar only); run_60 landed
   Oz-as-persona (ADR-0017 slice 1) — oz base persona, daemon-hosted one-shot agent turns,
   bounded `OZ_TOOL` tool loop over the shared action layer, and the `refresh` tool (one gate
   rejection + rebuild on the status workspace guard); run_61 landed the Oz `nudge` verb
   end-to-end (core `oz-nudge.json` channel + daemon tool-only verb, all three atoms first-try);
   run_62 fixed both founder-directed fresh-workspace bugs from CoPublisher onboarding (Bug A:
   stale-gate compares bootSha to engine repo not workspace HEAD; Bug B: `POST /workspaces`
   scaffolds governance zone with portable base template + seeded assignments, create-only-if-missing;
   F12/F13 recorded); run_63 live-proved Bug A on CoPublisher (launched, built, landed) but exposed
   F12 instance 3 (worktree dirs under workspace `local/`); CoPublisher reset (founder decision —
   onboarding re-runs as `backlog/workspace-onboarding.md` after Oz);    run_64 closed the run_63
   fallout (worktree dirs under ENGINE `local/worktrees/` for every workspace, scaffold
   `AGENTS.md`/`CLAUDE.md`, priorities-pane design audit at
   `packages/ui/design-audit-priorities-pane.md`, rebuild Atom B for `not-landed` active-run
   semantics — four atoms, all first-try);    run_65 **completed the priorities-pane rebuild**
   (audit atoms A, C, D, E, F — five atoms, all first-try; handoff geometry, bounded renderer
   detail enrichment, first-run vs empty-queue signal, polish pass, regression gap-fill; ui 108
   tests — the founder's "priorities pane is all wrong" complaint is closed at code level);
   run_66 **closed Bob session `mode` honoring end-to-end (ADR-0018 stage 3 for the builder
   session — the last buildable slice)** — five atoms, all first-try: incremental-output +
   abort seams on `runHeadlessProcess`, behavior-preserving `BuilderDriver` extraction, headless
   honoring (fresh one-shot captured-subprocess turn per atom; monitor watches LIVE via capture;
   loop atoms work headless; stop kills child before quarantine), UI tail (`MODE_HONORED_PERSONAS`
   = {oscar, bob}; core 238 · daemon 164 · ui 109). **All builder-delegable code on this priority
   is now landed.**
   run_67 (2026-06-12, Oscar wrap-up only): drafted **ADR-0021** for Oz repair trunk-commit
   authority — idle-only one-shot repair over trunk, governance in-scope, machinery propose-only in
   v1 — and the founder **ACCEPTED it at the same wrap** (restrictions expected to loosen once Oz is
   in real use — future amendment), plus a previously-unrecorded founder item: a **"Launch Oz
   dashboard" button** on the lightweight web dashboard. ⚠️ That wrap commit stranded off trunk
   (authored after the run had landed), so run_68 (0 atoms) wrongly reaffirmed the block.
   run_69 (2026-06-12, 5 atoms, all first-try): **recovered the stranded acceptance** and built
   everything it unblocked — the **Oz `repair` verb end-to-end** (idle-only headless turn over the
   engine trunk, whole-tree diff, `oz-repair` gate-commit, hold-back surfacing, failed turns commit
   nothing; tool-only through `executeOzCommand`, parser/help frozen), the **launch-dashboard
   button** (CSRF-gated `POST /oz/dashboard/launch`, detached spawn, honest dev-vs-built probe),
   and BOTH halves of the strand class (post-land support commits re-land or park visibly; a
   teardown+boot stranded-commit detector surfaces unlanded branch tips for Resolve — no auto-land).
   core 242 · daemon 188 · ui 109.
   run_70 (2026-06-12/13, 0 atoms): Oscar wrap-up only — all run_69 work confirmed on trunk; a
   post-wrap memory-migration support commit landed (`dfc4df0`). The wrap surfaced ONE live bug
   that re-opens a small build atom: the founder hit a **blank dashboard** — the run_69 Launch
   button's probe trusts a partial `out/` left by `electron-vite dev` and loads a missing
   renderer (**failure-catalog F16**).
   run_72 (2026-06-13, 1 atom, first-try): **F16 FIXED (`88888d7`) — the last buildable atom.**
   `resolveDashboardLaunch` now requires BOTH `out/main/main.js` AND `out/renderer/index.html`
   before choosing built mode, else falls back to dev (regression-pinned). Confirmed live as the
   cause of the founder's blank-window report (engine `out/` held only main+preload). Daemon 189 ·
   root typecheck clean. **Code-complete — zero further builder atoms without inventing work.**
   run_74 (2026-06-13, 0 atoms): Oscar wrap-up — CODE-COMPLETE reaffirmed; zero builder atoms; no
   code changes; archive blocked on live proofs only.
   run_75 (2026-06-13, 0 atoms): 5th reaffirmation (after run_68/70/74) — verified on-branch: F16
   fix present, `ENDPOINTS_OWED.md` truthed, no open tickets belong to this priority; still
   founder-present live ladder only; no builder atoms without a new live finding.
   Founder directive: complete Oz first, then workspace onboarding.
   Next: **founder live proofs only** — restart the daemon onto current trunk first (Restart-daemon
   button or relaunch; confirm via `/health` bootSha), then launch the dashboard (should render,
   not blank). Then the live ladder: Oz chat exercise with a real CLI assigned
   (status/launch/stop/nudge/repair/Refresh), eyeball the rebuilt priorities pane vs design-ref,
   one live headless-Oscar run + one live headless-Bob run (flip mode in Personas); then a **full
   founder Q/A pass with an expected punch-list run** (founder instruction, run_66 — restored
   run_70). Archive-candidate only AFTER the Q/A pass + punch-list, not after the live proofs
   alone. Mechanical surfaces + the bounded 3-item live remainder: `node scripts/proof-oz-surfaces.mjs`
   (do NOT relaunch this priority for a reaffirmation wrap — F18).
3. `new-primary-root` — the primary-root audit: bootstrap a new root's `cocoder/` + propose-only
   drift re-audit, one base Play pinned to a top-tier model. Design drafted as **ADR-0020 (proposed,
   2026-06-10)** — founder acceptance gates the build. The concrete form of Phase 5 ("first external repo").
Plus two always-available meta-priorities: `build-priorities-from-plan` (Oscar drafts priorities from
the plan/ADRs) and `adhoc-session` (no named priority — draft one, or run a read-only review/research).

**Deferred — `backlog/` (blocked on the Plays mechanism + Phase 5, an external app/deploy target):**
- `quinn-app-testing` — Quinn persona + browser/Electron test Plays.
- `deployment-plays` — human-gated deploys (Vercel/GCloud/signed-Electron/GitHub) + `local/secrets`.

**Vision backlog (re-author from frozen v1 reference when earned):** cloud/managed adapters (v1
`v0.2`, cf. ADR-0006/0009) · onboarding/workspace lifecycle (v1 `v0.3`, Phase 5) · the deferred Oz G1
items folded into `full-oz-dashboard`. Sources in `cocoder/zArchive/priorities/`.

## Earned guardrails log

Appended during Phase 3+. Each entry: the observed failure → the guardrail added → why it's at
the agent→reality boundary (G4).

_(none yet — Phase 0)_
