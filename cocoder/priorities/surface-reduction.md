---
id: surface-reduction
title: "Surface reduction — shrink CoCoder to one-person maintainable (subtract, don't migrate)"
---

> **Founder-ratified 2026-06-20.** Successor to `orchestration-audit-and-refactor` (archived: it proved
> the duplicate-code well is dry and named **conceptual surface** as the real complexity, then collapsed
> one slice — the Play taxonomy). This priority carries that finding forward with a **comprehensive
> cross-cutting audit** (run as a direct founder+assistant session 2026-06-20, embedded below as the
> Research section) and continues the subtraction. The research is **pre-seeded** — a launch starts from
> *validate-and-plan*, not from a blank investigation.
>
> **This priority also retires the `spike` genre** (founder directive 2026-06-20): research lives inside a
> priority's research/plan phase, never as a standalone artifact the runtime can't reach. Capturing this
> very audit *as a priority* (not a spike) is the pattern in action.

## Objective
Restore CoCoder to a size **one person can hold** by reducing conceptual surface — concepts, genres,
ADRs-to-chase, persona count, vocabulary — without losing a load-bearing safeguard, and with a
behavior-pinning net underneath every cut so each reduction is provably safe, not asserted-safe.

The governing finding (Research, below): CoCoder's bottleneck is **surface-area vs. solo-maintenance
capacity**, not design quality and not build-vs-adopt. The strategic answer is **subtract, don't migrate**
(omnigent is the wrong move — see Research §3). Every cut here serves that.

**Verified when:**
1. The **`spike` genre is retired** — committed cut (see Plan §A). No standalone `cocoder/spikes/` genre in
   the directory model; the two historical spikes preserved as frozen history; the change recorded in a new
   append-only ADR; all governance/template/docs references reconciled.
2. Each **candidate cut** (Plan §B) has an evidence-backed **load-bearing verdict** — *real* (keep) or
   *suspect* (collapse via a new founder-approved ADR) — extending the predecessor's owner-map method, not
   a parallel one.
3. At least **one** suspect surface beyond spikes is actually collapsed this priority, owner + files + new
   ADR + green behavior-pinning tests proving no regression.
4. Every remaining suspect exits as a **named, sequenced follow-up**, never an unowned intention.
5. No load-bearing safeguard (verify gate, commit spine, write-scope, founder-vs-agent boundary) is weakened
   by any cut — the existing suites + `scripts/proof-*.mjs` stay green.

## Research — comprehensive surface audit (2026-06-20 session; embedded, pre-seeded)

### §1 Diagnosis
The complexity the founder *feels* is conceptual surface that has outgrown one person's capacity to keep
coherent. Direct evidence gathered this session, each a symptom of the same disease (surface > capacity),
not of bad design:

- **A founder-blocking gate.** The direct-mode launch guard refused launches on the founder's own
  uncommitted `packages/**` work — governance built to constrain *agents*, mis-aimed at its author. Fixed
  by [ADR-0029](../decisions/0029-founder-trusted-pre-run-snapshot.md) (founder WIP self-heals; the quarantine
  baseline already made the old refusal unnecessary). Root class: gates not calibrated to actor.
- **Silent test-type rot.** The `@cocoder/daemon` test typecheck was red on 26 stale-mock errors while
  vitest stayed green — CI's `typecheck` never covered test files. Fixed (ticket 0021) + closed the gap
  (`pnpm -r typecheck` now gates every package's tests). Root class: surface CI wasn't watching.
- **Doc drift at scale.** The public docs carried tmux throughout (session host is cmux) and a pile of
  commands that **do not exist** (`cocoder init`, `oz register`, `oz status|stop`, `config get`,
  `validate-contracts`, `pnpm -F @cocoder/cli build`). Fixed (ticket 0003). Root class: surface drifted
  faster than one person could keep current.
- **The ADR accretion graph.** ~29 ADRs with supersession chains (commit spine 0015→0021→0022→0023→0024→
  0029; persona/observation 0013→0016→0017→0026) plus an ADR *about* ADRs (0014). To answer "how does X
  work" you must chase the chain. The predecessor priority began linearizing this in ARCHITECTURE.md.
- **Persona/role count.** Eight personas (Oz, Oscar, Deb, Ian, Bob, Talia, Quinn, Phil); the Deb-vs-Oz
  boundary alone needs an ADR + a doc to keep straight.
- **Scope generated faster than owned.** Several backlog priorities are Grok-drafted and carry a "founder
  ownership pass owed" banner — intentions accumulating ahead of capacity.
- **Corroboration:** the archived `orchestration-audit-and-refactor` independently reached the same
  "conceptual surface" conclusion. The system, dogfooding itself, diagnosed its own disease.

### §2 The redundant genre that triggered this priority
The `spike` genre is *"exploration notes that informed ADRs"* with **no execution path** — the runtime only
runs priorities and tickets. A standalone spike sits in `cocoder/spikes/`, never launched, never archived,
accumulating ("where did that thing I asked for go?"). Every legitimate spike-need already has a launchable
home: a priority's research/plan phase (this priority), or `adhoc-session` for an exploratory poke. So the
genre is pure surface to delete — itself an instance of the thesis. Hence Plan §A.

### §3 Strategic: subtract, don't migrate (the omnigent question, resolved)
The session opened with "is CoCoder over-engineered / should it move to omnigent?" Resolved from the code:
**the governance is a *runtime*, not a *policy*.** Write-scope partition + commit spine + verify-gate +
quarantine + the Oscar→Bob atom loop + the founder-vs-agent boundary are woven *into* the runner — they are
not approval-gate hooks. omnigent offers pluggable harnesses + policy hooks; porting would mean
reimplementing the runner on an alpha dependency and **losing the one differentiated thing**, to inherit
device-sync/sandboxing the project doesn't need. Verdict: **continue CoCoder; do not port.** The flip
condition (would make omnigent right): wanting multi-device/mobile, cloud sandboxing, or team collaboration.
The real problem is maintainability-under-solo-capacity, and you answer that with subtraction, not a
dependency.

## Plan

### §A Committed cut — retire the `spike` genre (ratified; do this slice)
- Remove `spikes/` from the directory model: [ADR-0008](../decisions/0008-repository-topology.md) topology +
  the `ARCHITECTURE.md` Directory Layout tree + `cocoder/AGENTS.md` + `cocoder/priorities/AGENTS.md` /
  `tickets/AGENTS.md` + `PLAYBOOK.md` references found this session.
- Preserve the two existing spikes (`2026-05-28-cmux-socket-api.md`, `2026-05-28-headless-cli-invocations.md`)
  as **frozen history** — relocate under `cocoder/zArchive/` (they already fed ADR-0002; do not delete).
- Record the retirement in a **new append-only ADR** (supersedes the spike line in ADR-0008's topology).
- Resolve the adjacent sub-question the run surfaced: the ticket **`type: spike`** (ticket taxonomy is
  `bug | task | question | spike`). **FOUNDER-RESOLVED 2026-06-20: fold `spike` → `question`.** Reasoning:
  a spike is research-and-decide — a priority's research/plan phase, or, ticket-sized, a `question`
  ("should we proceed / is X feasible"). The earlier "it runs via ticket-fix" defense missed the thesis:
  the disease is conceptual surface, not runtime-reachability, and `spike` is residual vocabulary whose
  real home is `question`. This is **not yet executed** — it touches a code SSOT, base governance, and the
  ADR, so it runs as a verified atom (next), not the committed §A directory cut.

#### §A status (this session)
- **Directory genre `spikes/` — DONE & COMMITTED** (`0e195ef`): directory removed, both notes frozen under
  `cocoder/zArchive/spikes/`, `ADR-0030` recorded (non-destructively amends ADR-0008), topology/architecture/
  AGENTS/PLAYBOOK/decisions-README reconciled. Ticket `type: spike` was deliberately left untouched in that
  cut and is the founder-resolved item above.
- **Ticket `type: spike` fold → `question` — NEXT ATOM (verified run, not yet executed).** Owner-map of the
  live surfaces that emit the type (fold all, no second copy left behind):
  - `packages/daemon/src/routes.ts:149,172` — `TicketKind` union + `TICKET_TYPES` array (**the SSOT**).
  - `packages/personas/base/plays/create-ticket.md:24,31` — base authoring contract enum (**base governance**).
  - `cocoder/tickets/AGENTS.md:11,33` and `cocoder/tickets/INDEX.md:9` — workspace docs.
  - **Extend `ADR-0030`** (do NOT spawn 0031) to "retire the spike concept" covering both the directory genre
    and the ticket type — one concept, one ADR. ADR-0030 currently states the taxonomy is unchanged; that
    line must be replaced by the fold record. (Founder-approved 2026-06-20: extend, don't add a new ADR.)
  - Note: the `spike` in `packages/adapters/tests/adapters.test.ts` is unrelated (headless-CLI invocation
    pinning) — out of scope.

### §B Candidate cuts — VERDICT FIRST, each founder-gated before any code (NOT yet ratified)
These come from the Research; they are proposals, not decisions. Give each a load-bearing verdict, then the
founder picks which (if any) to collapse this priority. None is authorized to execute on the strength of this
document alone.
- **Persona count (8 → fewer).** Candidate: collapse toward lead / builder / verifier / control-plane.
  Verdict must check each persona for a distinct load-bearing authority boundary before any merge (the
  predecessor already ruled Oz-repair vs Deb-repair `real` — respect that).
- **ADR graph.** Candidate: a single "current truth" surface (ARCHITECTURE.md) that the ADRs feed, so the
  live graph an agent must read is the accepted set only; superseded ADRs clearly demoted.
- **Vocabulary / genres beyond spikes.** Any concept that has one real home elsewhere.

## §B Verdict — ADR graph

**Verdict:** `suspect` — collapsible as a reading graph, not as behavior: keep the safeguards, but make
`ARCHITECTURE.md` + the owner map the current-truth entry point and demote retired/signpost ADRs to
history/pointers.

1. **Actual supersession map**

Gaps are not unissued: ADR-0015, ADR-0021, and ADR-0022 were issued, then retired to
`cocoder/zArchive/v2/decisions/`; the live index says all three are superseded by ADR-0023
(`cocoder/decisions/README.md:50-55`), and the frozen index says they are history only, never read as live
(`cocoder/zArchive/v2/decisions/README.md:1-15`).

| ADR | Class | Evidence |
|---|---|---|
| 0001 | accepted-current | Rebuild charter accepted and supersedes v1 history (`cocoder/decisions/0001-rebuild-charter.md:3-5`). |
| 0002 | accepted-current | Substrate accepted (`cocoder/decisions/0002-substrate-oz-and-cmux.md:3`). |
| 0003 | addendum | Accepted data model amended by ADR-0027; hybrid model stands while portable run history moves (`cocoder/decisions/0003-data-model-hybrid.md:3-9`; `cocoder/decisions/0027-workspace-storage-contract.md:12-15`). |
| 0004 | accepted-current | Process architecture accepted and refined by ADR-0013 (`cocoder/decisions/0004-process-architecture.md:3-6`). |
| 0005 | accepted-current | Personas + Plays accepted (`cocoder/decisions/0005-personas-and-subtasks.md:3-6`). |
| 0006 | accepted-current | Adapter contract accepted (`cocoder/decisions/0006-adapter-contract.md:3-5`). |
| 0007 | addendum | Accepted write-scope rule reconciled into ADR-0023's spine scope step (`cocoder/decisions/0007-write-scope-enforcement.md:3-5`). |
| 0008 | addendum | Accepted topology; amended by ADR-0012 and ADR-0030 (`cocoder/decisions/0008-repository-topology.md:3-9`). |
| 0009 | superseded | Merged into ADR-0008 and left as a stable pointer (`cocoder/decisions/0009-extensibility.md:1-9`). |
| 0010 | addendum | Accepted taxonomy; extended by ADR-0020 and amended by ADR-0028 (`cocoder/decisions/0010-taxonomy-and-authoring.md:3-15`). |
| 0011 | superseded | Merged into ADR-0013 and left as a stable pointer (`cocoder/decisions/0011-orchestrator-verify-gate.md:1-8`). |
| 0012 | addendum | Accepted living-base persona model amends ADR-0008/0009 (`cocoder/decisions/0012-living-base-personas.md:3-6`). |
| 0013 | accepted-current | Current orchestration loop; incorporates the former ADR-0011 verify gate (`cocoder/decisions/0013-orchestration-observation.md:3-6`, `cocoder/decisions/0013-orchestration-observation.md:29-39`). |
| 0014 | meta | Living-ADR policy accepted; it defines how ADRs change (`cocoder/decisions/0014-living-adrs.md:1-3`, `cocoder/decisions/0014-living-adrs.md:18-27`). |
| 0015 | superseded | Frozen ADR status says superseded by ADR-0023 (`cocoder/zArchive/v2/decisions/0015-isolated-working-state-per-run.md:1-10`). |
| 0016 | accepted-current | Deb repair fallback accepted, with ADR-0023 reconciliation note preserving the model through the spine (`cocoder/decisions/0016-deb-scoped-repair-fallback.md:3-12`). |
| 0017 | accepted-current | Oz orchestration persona accepted and amended in place (`cocoder/decisions/0017-oz-orchestration-persona.md:3-5`). |
| 0018 | accepted-current | Persona run-mode/sub-agent contract accepted (`cocoder/decisions/0018-persona-run-mode-and-sub-agents.md:3-7`). |
| 0019 | addendum | Multi-root workspace accepted and amended by ADR-0027 (`cocoder/decisions/0019-multi-root-workspaces.md:3-13`). |
| 0020 primary | addendum | Product decision accepted; execution model amended by ADR-0026 while product structure stands (`cocoder/decisions/0020-primary-root-audit.md:3-21`). |
| 0020 addendum | superseded | Phase-executor addendum status says superseded by ADR-0026 (`cocoder/decisions/0020-addendum-phase-executor.md:1-12`). |
| 0021 | superseded | Frozen ADR status says superseded by ADR-0023 (`cocoder/zArchive/v2/decisions/0021-oz-repair-commit-authority.md:1-8`). |
| 0022 | superseded | Frozen ADR status says superseded by ADR-0023, principles retained (`cocoder/zArchive/v2/decisions/0022-orchestration-change-durability.md:1-11`). |
| 0023 | accepted-current | Current commit spine accepted and supersedes 0015/0021/0022 (`cocoder/decisions/0023-workspace-commit-spine.md:3-14`). |
| 0024 | addendum | Governance pre-run snapshot amends ADR-0023; ADR-0029 supersedes only its builder-dirt refusal (`cocoder/decisions/0024-governance-pre-run-snapshot.md:3-11`; `cocoder/decisions/0029-founder-trusted-pre-run-snapshot.md:4-8`). |
| 0025 | addendum | Atomic authoring Plays accepted and ride the ADR-0023 spine (`cocoder/decisions/0025-atomic-authoring-plays.md:3-10`). |
| 0026 | accepted-current | Current onboarding execution model; supersedes the 0020 phase-executor runner-mode and preserves tooling (`cocoder/decisions/0026-onboard-existing-as-oscar-priority.md:3-15`, `cocoder/decisions/0026-onboard-existing-as-oscar-priority.md:69-80`). |
| 0027 | addendum | Workspace storage contract accepted; amends ADR-0003 and ADR-0019 (`cocoder/decisions/0027-workspace-storage-contract.md:3-15`). |
| 0028 | addendum | Play taxonomy reframe accepted; amends ADR-0010 (`cocoder/decisions/0028-play-taxonomy-three-axes.md:3-12`). |
| 0029 | accepted-current | Current founder-vs-agent launch-dirt rule; supersedes ADR-0024 step 2 and states the boundary (`cocoder/decisions/0029-founder-trusted-pre-run-snapshot.md:3-13`, `cocoder/decisions/0029-founder-trusted-pre-run-snapshot.md:68-78`). |
| 0030 | addendum | Spike concept retirement accepted; supersedes ADR-0008's `spikes/` topology line (`cocoder/decisions/0030-retire-spike-genre.md:1-8`). |

The commit-spine chain is therefore: 0015/0021/0022 are retired history, 0023 is current spine, 0024 is a
live addendum for governance self-heal, and 0029 is the current founder-WIP/founder-vs-agent rule
(`cocoder/zArchive/v2/decisions/README.md:11-15`; `cocoder/decisions/0023-workspace-commit-spine.md:87-103`;
`cocoder/decisions/0029-founder-trusted-pre-run-snapshot.md:42-78`). The persona/observation chain is not a
supersession chain: 0013, 0016, 0017, and 0026 are all live guarded distinctions/refinements
(`cocoder/decisions/0013-orchestration-observation.md:46-63`;
`cocoder/decisions/0016-deb-scoped-repair-fallback.md:30-60`;
`cocoder/decisions/0017-oz-orchestration-persona.md:23-41`;
`cocoder/decisions/0026-onboard-existing-as-oscar-priority.md:42-80`).

2. **Load-bearing test**

Owner-map method: extend the existing map, do not invent a second one; `docs/orchestration-contract-ownership.md`
already says its run_164 section extends the existing owner inventory (`docs/orchestration-contract-ownership.md:116-126`)
and pins the active verify/commit/repair/report owners (`docs/orchestration-contract-ownership.md:186-200`).

Search command used:
`rg -n "ADR-00(09|11|15|21|22|24)|\\b00(09|11|15|21|22|24)\\b" packages/core packages/daemon packages/personas scripts ARCHITECTURE.md`
and
`rg -n "ADR-0020|0020-addendum|phase-executor|phase executor|\\b0020\\b" packages/core packages/daemon packages/personas scripts ARCHITECTURE.md`.
Representative hits:

- `ARCHITECTURE.md` is already the current-truth surface for the commit spine and explicitly marks
  0015/0021/0022 as retired history (`ARCHITECTURE.md:60-96`); it also folds ADR-0011 into ADR-0013 and
  demotes the 0020 addendum phase-executor to history (`ARCHITECTURE.md:111-146`).
- Runtime comments still cite retired ADR numbers as lineage: ADR-0015 worktree/session durability comments
  appear in `packages/core/src/commit-gate/git.ts:10`, `packages/core/src/runner/observer.ts:23`, and
  `packages/daemon/src/launcher.ts:463`; ADR-0011 verify-gate comments appear in
  `packages/core/src/runner/runner.ts:3`, `packages/core/src/runner/prompts.ts:562`, and
  `packages/core/src/runner/io.ts:31`.
- Proof/test comments still preserve lineage names: `packages/core/tests/git-worktree.test.ts:1` and
  `packages/personas/tests/base-personas.test.ts:209`.
- 0020/phase-executor hits are history/tooling references: `ARCHITECTURE.md:114`, `ARCHITECTURE.md:142-145`,
  `scripts/proof-onboard-existing.mjs:2`, and inert playbook docs such as
  `packages/personas/base/playbooks/README.md:3`.

Verdict from the hits: nothing load-bearing needs an agent to read a superseded ADR as current truth. The
safeguards are pinned by current owners and tests: verify gate by ADR-0013 and runner-direct tests
(`docs/orchestration-contract-ownership.md:186`), commit spine by the commit gate/agent-step rows
(`docs/orchestration-contract-ownership.md:188-195`), post-wrap/support/repair distinctions by the overlap
map (`docs/orchestration-contract-ownership.md:209`, `docs/orchestration-contract-ownership.md:238-245`), and the founder-vs-agent boundary by
ARCHITECTURE plus ADR-0029 (`ARCHITECTURE.md:76-89`; `cocoder/decisions/0029-founder-trusted-pre-run-snapshot.md:68-78`).
Demoting superseded ADRs would not weaken verify gate, commit spine, write-scope, or founder-vs-agent
boundary if the runtime comments/tests are retargeted to current owners or explicitly labelled historical.

3. **Concrete sequenced collapse proposal (proposal only; not executed here)**

Because the verdict is `suspect`, collapse by founder-approved ADR only:

1. Author the new founder-approved ADR asserting the reading contract: `ARCHITECTURE.md` is the concise
   current-truth entry point; `docs/orchestration-contract-ownership.md` is the drill-down owner map for
   orchestration contracts; `cocoder/decisions/README.md` remains the index/history router. Check:
   `rg -n "current truth|owner map|ADR-0015|ADR-0011|0020-addendum" ARCHITECTURE.md docs/orchestration-contract-ownership.md cocoder/decisions/README.md`.
2. Add or tighten demotion banners only where current files still look live: 0009 and 0011 can stay as
   redirect signposts; 0024 should say "partially superseded by 0029; governance self-heal remains"; 0020
   addendum stays `Superseded`; 0015/0021/0022 stay frozen in zArchive. Check:
   `rg -n "^\\*\\*Status:\\*\\*|Superseded|Merged into|Amended by" cocoder/decisions cocoder/zArchive/v2/decisions`.
3. Retarget runtime/proof comments that cite retired ADRs as current owners: ADR-0015 comments become
   "opt-in isolation/worktree machinery retained under ADR-0023 §4"; ADR-0011 comments become "ADR-0013
   verify gate"; ADR-0024 comments become "ADR-0029/launch pre-run snapshot lineage". Check:
   the two grep commands in the load-bearing test return only explicit historical/lineage references.
4. Tighten `ARCHITECTURE.md` so "what is true now" is readable without chasing chains: spine = 0023+0029,
   loop = 0013+0016+0017+0026, topology = 0008+0012+0019+0027+0030. Check:
   `node scripts/check-topology.mjs`, `pnpm -r typecheck`, and the relevant `scripts/proof-*.mjs`.
5. Re-run behavior pins named by the owner map: runner-direct for verify/commit/quarantine, daemon authoring
   for spine callers, `scripts/proof-orchestration-enforcer.mjs`, `scripts/proof-onboard-existing.mjs`, and
   `scripts/proof-drift-audit.mjs`. The collapse is reversible because it changes labels/comments/routing
   surfaces first; it does not remove code or historical ADR files.

4. **Remaining-suspect follow-ups**

- **Persona count (8 → fewer):** next verdict atom should map each persona to a distinct authority boundary
  and test row, especially Oz repair vs Deb repair already guarded by the owner map
  (`docs/orchestration-contract-ownership.md:214`, `docs/orchestration-contract-ownership.md:321`).
- **Vocabulary / genres beyond spikes:** later verdict atom should inventory nouns with two homes and test
  whether each is a guarded distinction or foldable alias, using the same owner-map rows rather than a new
  taxonomy method (`docs/orchestration-contract-ownership.md:202-216`).

## Boundary
Verdict + behavior-pinning tests first. The **only** pre-authorized code/governance mutation is §A (spike
retirement). §B cuts require a per-cut founder go-ahead and a new founder-approved ADR before touching
runner/daemon/persona code (reversing an Accepted ADR needs a new ADR — ADR-0010). Do not weaken a
load-bearing safeguard. Elegance standard: fewer concepts, never a new lane to describe the old ones.

## Required Inputs
- This Research section (the pre-seeded audit).
- `ARCHITECTURE.md`; `docs/orchestration-contract-ownership.md` (predecessor owner map — extend it).
- `cocoder/priorities/archive/orchestration-audit-and-refactor.md` — predecessor; absorb its dispositions.
- ADRs 0002, 0008 (spike sites), 0010, 0013, 0016, 0017, 0023–0029.
- `packages/core/src/runner/`, `packages/core/src/plays/`, `packages/personas/base/`, `templates/`.
- Behavior nets: `packages/core/tests/**`, `scripts/proof-orchestration-enforcer.mjs`, `scripts/proof-*.mjs`.

## Suggested Next Action
**Atom 0 (directory genre) is done & committed (`0e195ef`).** Next atom — relaunch and execute the
founder-approved **`type: spike` → `question` fold** as one verified atom: fold the SSOT
(`packages/daemon/src/routes.ts`) + base `create-ticket.md` + `tickets/AGENTS.md` + `tickets/INDEX.md`,
**extend ADR-0030** (not a new ADR) to record the fold, and keep `scripts/proof-*.mjs` + the suites green.
This is a verify-gated change (code SSOT + base governance), not a support edit. Then §B verdicts
(ADR-graph first, per founder lean) before any further cut.

Correction (2026-06-20, founder session): the `orchestration-contracts` red was **misattributed** above.
It was not pre-existing or `drift-audit`'s — it was introduced by the 0003 docs commit (`269230a`), which
correctly aligned `docs/oz-improvement-routing.md` to ARCHITECTURE's canonical **four** routing zones but
left the stale test asserting a retired fifth (`workspace-local`). Fixed by updating the stale test to the
four-zone taxonomy; full core suite green (446/446).
