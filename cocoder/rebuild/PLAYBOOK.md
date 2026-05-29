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
- **CoBuilder persona-rule audit captured** → [`persona-rules-to-carry.md`](./persona-rules-to-carry.md) (feeds Phase-1 persona authoring).
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
[`oz-thin.md`](./oz-thin.md). Transport decided as loopback-HTTP-browser; the v1 security checklist
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

## Earned guardrails log

Appended during Phase 3+. Each entry: the observed failure → the guardrail added → why it's at
the agent→reality boundary (G4).

_(none yet — Phase 0)_
