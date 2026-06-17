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
  ran). **Archived 2026-06-13** (founder-confirmed, priority audit) — no live proof owed. (Per ADR-0023,
  isolation is now opt-in, not the default; this machinery runs only on the opt-in lane.)
- `full-oz-dashboard` — the v1-designed control plane (chat, oversight/debugger, settings, drag-reorder
  priorities, workspaces, run lifecycle), earned in slices over runs 43–72. ✅ **feature-complete** — all
  daemon surfaces served (`node scripts/proof-oz-surfaces.mjs`); the last design-conformance defect
  (priorities pane) fixed run_81. **Archived 2026-06-14** (priority audit). Live Q/A is a founder activity;
  defects become focused priorities. (Its old punch-list item `oz-held-back-expand-scope` is CANCELLED
  2026-06-15 — superseded by the scope-advisory change; nothing is held back any more.)
- `build-priorities-from-plan` — a standing meta-priority to draft priority stubs from decided-but-unbuilt
  plan/ADR work. **Archived 2026-06-14** (priority audit) — never exercised in practice (priorities were
  drafted conversationally); the capability lives in the create-priority Play + `adhoc-session`, and the
  rebuild plan is spent (forward work now comes from dogfood findings + onboarding).
- `oz-dashboard-priorities-pane` — founder-reported dashboard defect (column 1 showed runs, not the
  orderable priorities queue). ✅ fixed run_81 (off-design `AwaitingYouPanel` removed; regression test +
  `scripts/proof-priorities-queue.mjs` harness pin it) — the **first live run on the post-reset stack**,
  committed straight to `main` (158d208…f1d04d0). **Archived 2026-06-14.** Surfaced one full-oz punch-list
  item (no founder-reachable expand-scope path for held-back files).
- `orchestration-operating-model-reset` — the operating-model reset to **ADR-0023** (the workspace
  commit spine: direct-to-branch default, isolation opt-in, one commit service, derived receipts),
  dissolving the F14/F17/F19/F20 strand class structurally. ✅ all six phases on `main` (A `e4a9172` ·
  B `9dc1c4d` · C `724a3d1` · D `bce0140` · F `32e4795` · E `751d920`); `node scripts/proof-direct-spine.mjs`
  10/10; 626 tests; `main` promoted to canonical trunk + pushed. **Archived 2026-06-14** — the live
  end-to-end validation exercised on `oz-dashboard-priorities-pane` run_81 (first live run post-reset);
  re-opens only if a run surfaces a machinery defect.
- `personas-and-plays` — one living-base+delta model for **personas AND Plays**; base QA roster (Quinn,
  Talia) + the no-brainer Plays (`documentation`, `code-review`, `electron-test`) + Play deltas honored
  at run-launch. ✅ CODE-COMPLETE run_78/79; `node scripts/proof-plays.mjs` 4/4. **Archived 2026-06-14**
  (priority audit) — buildable work done; the 2 founder-present live proofs (Plays dispatch on a real
  run; Quinn drives the Oz GUI) are opportunistic, not blocking.
- `plays-first-class` — Oz Play catalog + persona binding + write-scope/CLI-capability surfacing
  (`GET /workspaces/:id/plays`, top-level Plays nav catalog — relocated `12d2f0c` by founder directive,
  catalog picker, `headlessCapable` data, ⚠️ misconfig guard). ✅ run_88 (5 atoms); re-verified run_89
  (592 tests). **Archived 2026-06-15** (founder-confirmed, run_90) — verified-when met; deferred boundary
  resolved (one-level dispatch stands — see `priorities/archive/play-dispatch-boundary.md`). File moved to
  `zArchive/priorities/v2/plays-first-class.md`.

**Active build priorities (launchable; the `priorities/` directory is the live index):**
- `fix-ticket-0011` — **archive-candidate (run_120, 2026-06-17).** Teardown receiver fix shipped
  (`6d05475` — `ctx.sessionHost.closeWorkspace({ workspaceRef })` preserves `this`); receiver-sensitive
  regression in `mutations.test.ts` catches the unbound path; [ticket 0011](./tickets/closed/0011-teardown-cli-undefined-on-final-oscar-surface.md)
  closed. All verify gates green. **Only gate:** founder archive confirmation.
1. `headless-adapter-lane` — **ARCHIVED (run_104, founder-confirmed 2026-06-16).** Claude Code + Codex real
   headless invocation built (`BuildInput.headless`, claude print mode + codex exec), wired through
   `dispatchPlay` + `oz-host`, `headlessCapable=true` (single source). Flags verified vs real binaries;
   `node scripts/proof-headless-lane.mjs` re-proves (PASS claude, PASS codex). Oz-on-claude and latent
   headless-Play pins no longer hang. Closes ticket 0006. Playbook moved to `priorities/archive/`; dropped
   from `order.json` (next launchable: `new-primary-root`).
2. `governance-authoring-plays` — **ARCHIVE-READY (run_99, 2026-06-16).** Founder-directed: never leave
   launch-blocking governance dirt. Parts 1 & 2 are done: launch self-heal ([ADR-0024](./decisions/0024-governance-pre-run-snapshot.md),
   `5842e32`); three authoring Plays (`8492d32`); dispatch harness (`85f3a0a`); one-tool-action
   (`f7d16e0`, resolves `oz-dashboard-bugs` #12); [ADR-0025](./decisions/0025-atomic-authoring-plays.md).
   Deb granted the three Plays to oz/oscar/deb, fixed the governance-commit daemon-stale edge needed for
   immediate launch, and reran `node scripts/proof-governance-authoring.mjs`: **8/8 clauses green**.
3. `oz-dashboard-bugs` — **ARCHIVED (run_103, founder-confirmed 2026-06-16).** All 12 founder-reported
   Oz dashboard defects fixed at the cause (run_94; renderer/daemon vitest + UI build green). #12 closed
   via `governance-authoring-plays` (one-tool `author`, run_98). Machine proof
   (`node scripts/proof-oz-surfaces.mjs`) green; the three irreducibly-live founder proofs (Oz chat with
   real CLI, one headless Oscar + Bob run, Q/A acceptance) were the founder's acceptance gate, cleared by
   the explicit `archive` go-ahead. Playbook moved to `priorities/archive/`. Open follow-ons (do NOT
   reopen this priority): ticket 0006 closed via `headless-adapter-lane` (run_104, archive-candidate) ·
   ticket 0012 (design-ref rebuild guard).
4. `new-primary-root` — **ACTIVE (run_123, 2026-06-17).** Onboard a primary root via the
   bootstrap/takeover/drift onboarding Playbooks (ADR-0020 Accepted). **Engine foundation built and
   live-wired** (run_83 + run_86): loader extension (§7), `scaffoldCocoderZone` + `createWorkspace`
   wiring (D1 complete), `deep-read` hardened for P3. **Executor design ratified** (run_110 cleared
   founder gate; addendum A–E + tech-stack approach accepted). **Executor build in progress**
   (run_111–123): Atoms F/1/5a/3/4 (run_111–112); **run_123 landed the full P1 input layer** — Atom 2
   run-target + daemon launch surface (`9f76e98`), Atom 5b agentic recon (`c165778`), Atoms C/D
   estimate + intent (`7b9395f`/`2080437`), intent-artifact enumerator (`28ba44a`). core 303 + daemon 206
   green. **Next:** **executor P1 ACTION integration** (fresh session) — wire producers through
   `executeAgentStep`, write `playbook/P1/*.json` + `pickup.md`, pause at P1 `awaiting-founder` gate;
   prove start→P1→pause→resume on a fake-agent fixture. Then Atoms 6–11 + tech-stack-template build;
   live CoPublisher Takeover + dogfood Drift Audit proofs remain gated on executor end-to-end on fakes.
   **Absorbs `workspace-onboarding`.** Phase 5 ("first external repo").

**Queued after `new-primary-root` (founder go-ahead 2026-06-16, priority-audit run_106 — in `order.json`):**
- `hybrid-plays` — deterministic code spine inside a Play (promotes "verify, don't assert — evidence over
  claims" to first-class structure; e.g. `integration-verify` *runs* the real check instead of prompting an
  agent to). Step 1 is an **ADR-0010 taxonomy amendment** the founder confirms at launch (the Play-component
  shape); then schema (`Play` type) + dispatch + reimplement `integration-verify` as the hybrid proof.
- `tickets-review` — **DELIVERABLE 1 CODE-COMPLETE; atom 4 UNBLOCKED (run_122, 2026-06-17).** Objective
  ratified 2026-06-17. Landed: ticket-index hygiene + tickets data layer + 3-tab panel (run_121); live-review
  fixes (`0266172`/`bdddf29`/`efb9714` — tab header, `POST /tickets` + `NewTicketModal`). **Founder:
  `scripts/oz.sh restart`** to activate tickets GET+POST on the live daemon (Bug 2 count=0 is stale-process,
  not code). **Remaining = atom 4, a ticket-fix run** that closes a ticket through the spine — run-target
  dependency **cleared** (`new-primary-root` Atom 2 landed run_123, `9f76e98`). **Queued after** executor
  P1 ACTION integration on `new-primary-root`; then relaunch for atom 4 (proof ticket one of
  `0003/0005/0012`).
- `oz-dashboard-design-tweaks` — **archive-candidate (run_115):** rounds 1–3 code-complete — settings
  trim + collapsible personas/plays + contrast (run_113), panel↔background reversal + Oz-card de-gradient
  (run_114, `97bc3a4`), Round-3 persona-card consistency + priority-row separation + stacked priority
  actions + scrollbar legibility (run_115, `1afcb33`). `fusion.css` + design-ref mirrored; typecheck + UI
  suite 113/113 green. **Only gate:** founder eye-check on the auto-rebuilt Oz dashboard (dark + light);
  then archive.
- ~~`play-dispatch-boundary`~~ — **RESOLVED 2026-06-15, ARCHIVED 2026-06-16** (run_106): one-level dispatch
  stands; no engine reversal. Decision record now at `priorities/archive/play-dispatch-boundary.md`.

**Standing tools (always available — not build work):** `priority-audit` (assess the priority set for
staleness → a founder-decision table; the pruning tool) · `adhoc-session` (no named priority — draft one,
or run a read-only review/research). The Oz dashboard itself is feature-complete and archived; running it
end-to-end is a founder activity, and any defect found becomes its own focused priority (the model
`oz-dashboard-priorities-pane` proved).

**Deferred — `backlog/` (each file's `## Objective` names what it's blocked on):**
- ~~`oz-held-back-expand-scope`~~ — **CANCELLED 2026-06-15, ARCHIVED 2026-06-16** (run_106). Superseded by
  the scope-advisory change (ADR-0023 amendment / F21): the spine never withholds, so there is no held-back
  state to expand. Decision record now at `priorities/archive/`.
- `quinn-app-testing` — Quinn **browser** app-testing Plays only (base Quinn + the `electron-test` Play
  already shipped under the archived `personas-and-plays`); blocked on a Phase-5 web app to drive.
- `deployment-plays` — human-gated deploys (Vercel/GCloud/signed-Electron/GitHub) + `local/secrets`;
  blocker is now **Phase 5 only** — the Plays mechanism is built.
- `multi-repo-commit-spine` — per-root commit spine (slice 2 of ADR-0019); reconcile with ADR-0023 at
  pickup; needs an Objective + ADR amendment before it's runnable.
- `priority-architecture-contract` — founder-owned placeholder; re-scope to a real launch boundary (not
  governance-of-governance — G4/F5) before any build.
- `research-sandboxing` — decision spike (IF/WHEN/minimal-form) on OS-level run sandboxing; default
  expected answer is "not now." **Blocked on the commit spine being boringly reliable first**; explicitly
  bars over-constraint, security theater, and any happy-path/doc blockers (opt-in, off by default).

**Vision backlog (re-author from frozen v1 reference when earned):** cloud/managed adapters (v1
`v0.2`, cf. ADR-0006/0009) · onboarding/workspace lifecycle (v1 `v0.3`, Phase 5) · the deferred Oz G1
items folded into `full-oz-dashboard`. Sources in `cocoder/zArchive/priorities/`.

## Earned guardrails log

Appended during Phase 3+. Each entry: the observed failure → the guardrail added → why it's at
the agent→reality boundary (G4).

_(none yet — Phase 0)_
