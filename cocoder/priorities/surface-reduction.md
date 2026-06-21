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
