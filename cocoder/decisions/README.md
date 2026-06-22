# Decisions (ADR index)

The live ADR set — the one decisions tree. The frozen v1 ADRs live at
[`../zArchive/v1/decisions/`](../zArchive/v1/decisions/) (see [ADR-0001](./0001-rebuild-charter.md), Supersedes);
their still-live content was absorbed into [ADR-0019](./0019-multi-root-workspaces.md).

## Accepted

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-rebuild-charter.md) | Rebuild Charter — why, disciplines, locked decisions | Accepted |
| [0002](./0002-substrate-oz-and-cmux.md) | Substrate: Oz brain + cmux terminal host (S1) | Accepted |
| [0003](./0003-data-model-hybrid.md) | Data model: hybrid files + central Oz-owned SQLite (S2) — *amended by [0027](./0027-workspace-storage-contract.md): portable run/session history relocated to tracked `cocoder/runs/**`; DB demoted to machine-local index* | Accepted |
| [0004](./0004-process-architecture.md) | Process architecture: core lib, optional daemon, CLI-standalone (S4) | Accepted |
| [0005](./0005-personas-and-subtasks.md) | Personas + delegatable Plays (S5; dissolves S9) | Accepted |
| [0006](./0006-adapter-contract.md) | Adapter contract: trust-the-CLI + capability probe (S6) | Accepted |
| [0007](./0007-write-scope-enforcement.md) | Write-scope: allow-list + commit-gate enforcement (S7) — *reconciled into 0023 (the spine's scope step)* | Accepted |
| [0008](./0008-repository-topology.md) | Repository topology + one-home enforcement (S3; relates to 0005; ~resolves S8) — *amended by [0030](./0030-retire-spike-genre.md): standalone `spikes/` is retired as a live directory genre; historical spike notes move to `zArchive/spikes/`; amended by [0032](./0032-retire-playbooks-genre.md): base `playbooks/` skeletons are retired as a live directory genre and frozen under `zArchive/playbooks/`* | Accepted |
| [0009](./0009-extensibility.md) | Extensibility — *merged into 0008 §Extensibility* (redirect signpost) | Merged → 0008 |
| [0010](./0010-taxonomy-and-authoring.md) | Taxonomy & authoring lifecycle: Playbooks, Plays, Objectives (refines 0005) — *amended by [0028](./0028-play-taxonomy-three-axes.md): Play taxonomy is three orthogonal axes plus existing `kind`; `tool/API-triggered` and `interactive` are reserved/forward-declared, no enum deletion; amended by [0035](./0035-priority-creation-always-placed-or-halted.md): no "draft" state, founder Objective-ratification moves to the first-run gate, conflict/overlap halt at authoring* | Accepted |
| [0011](./0011-orchestrator-verify-gate.md) | Orchestrator verify-gate — *merged into 0013* (redirect signpost) | Merged → 0013 |
| [0012](./0012-living-base-personas.md) | Living base personas + repo extensions — base ships with the install & propagates; repos layer deltas (amends 0008/0009) | Accepted |
| [0013](./0013-orchestration-observation.md) | Orchestration + observation: Oscar drives Bob through a multi-atom plan; tiered continuous monitoring (Oscar→Bob, Deb→Oscar, Oz→sessions) with the direct-your-primary rule (refines 0004) | Accepted |
| [0014](./0014-living-adrs.md) | ADRs are living documents (founder-approved, conflict-audited) | Accepted |
| [0016](./0016-deb-scoped-repair-fallback.md) | Deb: the scoped CoCoder repair fallback — live status feed + nudge-request channel + gate-enforced repair mode; base/delta write-scope split (refines 0013; repairs land via the spine, ADR-0023) | Accepted |
| [0017](./0017-oz-orchestration-persona.md) | Oz orchestration: Oz is a CLI-backed persona in a window, with a bounded tool surface (builds on 0005/0013) | Accepted |
| [0018](./0018-persona-run-mode-and-sub-agents.md) | Persona run-mode + sub-agents: sub-agents ARE per-persona Play assignments; `mode` honored the slice it lands (refines 0005) | Accepted |
| [0019](./0019-multi-root-workspaces.md) | Multi-root workspaces: `.code-workspace` files in `local/workspace/`, three root roles, no nesting (absorbs live v1-0007/0006) — *amended by [0027](./0027-workspace-storage-contract.md): portable identity split out to tracked `cocoder/workspace.json`; `.code-workspace` narrows to machine-local routing* | Accepted |
| [0023](./0023-workspace-commit-spine.md) | **The workspace commit spine: direct-to-branch by default, isolation opt-in** — one commit service for all actors; collapses the three divergent commit paths; dissolves the run-branch strand class (supersedes 0015/0021/0022, reconciles 0007) | Accepted |
| [0020](./0020-primary-root-audit.md) | **Onboarding Playbooks** — bootstrap / **onboard-existing** (was "takeover") / drift as shipped baked-plan Playbooks (multi-agent audit, propose-only drift, top-tier pins, founder checkpoints; extends 0010) — **execution amended by [0026](./0026-onboard-existing-as-oscar-priority.md)** (Oscar-driven priority, not phase-executor); product structure current | Accepted (2026-06-14) |
| [0024](./0024-governance-pre-run-snapshot.md) | **Launch self-heals governance dirt** — the launch guard partitions dirty-in-scope by builder vs. governance scope; governance-only dirt is auto-committed as a `governance: pre-run snapshot` and the launch proceeds, while builder/product WIP still refuses (amends 0023 §2/§3) — *builder-dirt refusal superseded by [0029](./0029-founder-trusted-pre-run-snapshot.md): founder WIP now self-heals too* | Accepted (2026-06-16) |
| [0025](./0025-atomic-authoring-plays.md) | **Atomic authoring Plays** — `create`/`edit`/`archive-priority` Plays validate→write→commit through the one spine in a single dispatch (`requestAuthoringPlay`, generalizing `requestOzRepair` with `commitOnlyScope`); Oz authors as one `OZ_TOOL author` action (resolves `oz-dashboard-bugs` #12); create/Objective-edits stay founder-approved (ADR-0010); pairs with 0024's hand-edit backstop | Accepted (2026-06-16) |
| [0026](./0026-onboard-existing-as-oscar-priority.md) | **Onboard (existing repo) runs as an Oscar-driven priority, not a standalone phase-executor** — the executor had no founder-facing interaction surface (a real audit would freeze at the first gate); reframe onto the proven Oscar↔founder loop (questions/status/multi-session/ratify), reuse the audit Plays/convergence/trust-boundary/scaffold as tooling; renames "Takeover" → "Onboard (existing repo)" (supersedes the 0020-addendum executor runner-mode; amends 0020 — execution only) | Accepted (2026-06-17) |
| [0027](./0027-workspace-storage-contract.md) | **Workspace storage contract** — portable workspace history (run/session/work/commit/event records + display counters + identity) lives in git-tracked `cocoder/`; machine-local coordination (live refs, cmux surface refs, run dirs, internal run-id allocator) stays in the shared install `local/`; the DB is demoted to a rebuildable index/coordination cache. The storage SSOT for the `workspace-segmentation` priority (amends [0003](./0003-data-model-hybrid.md) + [0019](./0019-multi-root-workspaces.md); preserves 0008/0023) | Accepted (2026-06-18) |
| [0028](./0028-play-taxonomy-three-axes.md) | **Play taxonomy is three axes plus reserved future values** — amends ADR-0010's 2026-06-19 "five named Play classes" framing; live taxonomy is `triggerClass`, `executionModel`, `writeScope`, plus existing `kind`; `tool/API-triggered` is reserved for API-triggered dispatch and `interactive` is reserved for interactive browser control; no enum deletion | Accepted (2026-06-20) |
| [0029](./0029-founder-trusted-pre-run-snapshot.md) | **The founder is a trusted actor: builder WIP self-heals too** — supersedes 0024's builder-dirt refusal; the founder's uncommitted `packages/**` work is snapshotted to its own founder-attributed `founder: pre-run WIP snapshot` commit (mixed dirt → both snapshots) and the launch proceeds, instead of refusing; `strictPreRunDirt` (CLI `--strict-dirt`) restores the hard-stop for shared repos / CI; draws the founder-vs-agent boundary (gates bind agents, preserve the founder) | Accepted (2026-06-20) |
| [0030](./0030-retire-spike-genre.md) | **Retire the standalone `spikes/` directory genre** — supersedes ADR-0008's live `spikes/` topology line; standalone spike notes have no execution path, so research belongs in a priority phase or `adhoc-session`; existing notes are frozen under `zArchive/spikes/`; ticket `type: spike` remains unchanged | Accepted (2026-06-20) |
| [0031](./0031-architecture-reading-contract.md) | **Architecture reading contract** — first CoCoder instance of ADR-0014's current-truth surface rule: ARCHITECTURE.md is the concise current-truth entry point; docs/orchestration-contract-ownership.md is the orchestration contract owner map; this index remains the ADR/history router; superseded ADR detail feeds the current surfaces | Accepted (2026-06-21) |
| [0032](./0032-retire-playbooks-genre.md) | **Retire the base `playbooks` skeleton genre** — supersedes ADR-0008's live base `playbooks/` topology line; inert skeletons have no loader path after ADR-0026, so onboarding/drift work belongs in scaffold-seeded priorities or ordinary Oscar-driven priorities; existing skeletons are frozen under `zArchive/playbooks/` | Accepted (2026-06-21) |
| [0033](./0033-testing-as-a-play-capability.md) | **Testing is a Play capability, not a base persona** — supersedes ADR-0005's acceptance-QA-as-standalone-persona reading; testing moves into function-named Plays such as `write-tests` and `run-tests` callable by every persona; Talia retires, Quinn remains the `real` experience-QA persona, and the live base persona set becomes Oz/Oscar/Bob/Deb/Quinn | Accepted (2026-06-21) |
| [0034](./0034-retire-adr0015-merge-machinery.md) | **Retire ADR-0015's run-branch merge/landing machinery (dead code)** — implementation close-out of the already-superseded+frozen ADR-0015; the seven merge/landing `Git`-port primitives (`isAncestor`/`mergeFastForwardOnly`/`unmergedCommits`/`mergeInto`/`conflictedFiles`/`completeMerge`/`abortMerge`) had no live caller under the single-mode spine (ADR-0023) and are removed; worktree primitives + `resetHard` are kept | Accepted (2026-06-21) |
| [0035](./0035-priority-creation-always-placed-or-halted.md) | **Priority creation: always placed or halted — no "draft" state** — a created priority is placed in the active stack or halted-and-surfaced; open questions are the priority's first research gate (it may conclude no-op→archive), and founder ratification of the Objective moves from pre-creation to that first-run gate; the sole pre-creation gate is a **conflict/overlap halt** (overlap → recommend folding into the existing priority with a plain-English why; conflict with an Accepted ADR/priority → surface for supersede/reframe/drop). Amends ADR-0010 authoring lifecycle | Accepted (2026-06-22) |

## Proposed (founder review owed)

| ADR | Title | Status |
|---|---|---|
| _(none currently — 0026 accepted 2026-06-17; the 0020 addendum it superseded moved to history below)_ | | |

## Retired to history (superseded — not in the live tree)

The live tree above carries only **current-truth** decisions. ADRs whose decisions later changed are
moved to history so none sits in "Accepted" while contradicting reality (founder directive 2026-06-14):

- **0015, 0021, 0022 → superseded by 0023**, retired to
  [`../zArchive/v2/decisions/`](../zArchive/v2/decisions/README.md). 0015 made isolation the default
  (the strand surface); 0021 gave Oz a special out-of-run commit path; 0022 built the run-branch landing
  invariant. ADR-0023 (the commit spine) replaces all three — its principles inherit 0022's
  broad-by-default/two-surface/derived-receipt; the worktree+merge machinery survives only as 0023's
  opt-in isolation lane.
- **0020 Addendum (phase executor) → superseded by 0026** (run_131). The standalone executor runner-mode
  had no founder-facing interaction surface (a real audit would freeze at the first gate); 0026 reframes
  the existing-repo audit onto an Oscar-driven priority. The addendum file is **kept in place** (not
  moved to `zArchive/`) because many docs link it and it is **retained as the historical design of the
  reused audit tooling** (`deep-read`/convergence/trust-boundary/scaffold) — its `Status:` is flipped to
  Superseded with a forward-pointer, so it no longer claims current truth.

Two **merged** ADRs remain in the live tree as one-line redirect signposts (their decisions live wholly
inside their target, ~70 citations resolve through them): **0009 → 0008 §Extensibility**, **0011 → 0013**.

**Phase-0 architecture Q&A complete — all seams resolved (ADRs 0001–0009).** ADR-0010 (taxonomy &
authoring) accepted 2026-05-29 after a 6-lens adversarial review. ADR-0011 (orchestrator verify-gate)
accepted 2026-05-29 — earned from a dogfood run where an unverified builder diff broke a sibling
package's tests and was auto-committed. ADR-0012 (living base personas) accepted 2026-05-29 — the base
set is referenced & propagates to all installs (replaces copy-on-init); required for Deb to improve the
base for everyone.

## Reading order (foundational-first) & consolidation

The files are numbered chronologically (the order seams were resolved), **not** by importance. To
assemble the current model, read in this order:

1. **0001** charter (disciplines D1–D6) · **0014** living-ADR policy (how to read & change these)
2. **0002** substrate · **0003** data model · **0004** process architecture
3. **0005** personas + Plays · **0008** topology + one-home · **0012** living base personas
4. **0006** adapter contract · **0007** write-scope · **0013** run lifecycle (multi-atom loop + the
   0011 verify-gate + observation)
5. **0023** the workspace commit spine — **the current orchestration operating model**: how every
   actor commits (direct-to-branch by default, isolation opt-in). Read it last; it supersedes
   0015/0021/0022 and is the single ground truth for how work reaches trunk.

**Consolidation (2026-05-30, per ADR-0014):** the set is leaned out by *content*, not by renumbering —
ADR numbers are stable handles cited in ~70 places (code, personas, priorities), so a physical renumber
is deliberately avoided (cosmetic gain, large breakage). Done so far: stale bodies brought to current
truth (0005), 0012 slimmed (implementation log → its priority). **Merged (founder-approved):** the
extensibility corollary **0009 → 0008 §Extensibility**, and the verify-gate **0011 → 0013**, each left as
a redirect signpost so existing citations resolve. **0010** (taxonomy) stays standalone — too
substantial to fold. Net: **12 substantive ADRs** (+ 2 signposts), all current-truth, no renumber.

## Candidate irreversible seams (the Phase-0 Q&A agenda)

These are the decisions that are **expensive to reverse** (per discipline D1). Each becomes an
ADR (0002+) once we resolve it together in the Q&A. They are listed, not decided. Options shown
are the space to explore, not recommendations. Order is rough priority.

| Seam | Question | Why it's a seam (hard to reverse) | Option space (not decided) |
|---|---|---|---|
| ~~S1 — Terminal host & substrate~~ | **RESOLVED → [ADR-0002](./0002-substrate-oz-and-cmux.md):** Oz brain + cmux terminal host, behind a `SessionHost` port; terminal disposable, run-state durable in Oz. | | |
| ~~S2 — Core data model~~ | **RESOLVED → [ADR-0003](./0003-data-model-hybrid.md):** hybrid — governance in git-tracked files; operational state in one central Oz-owned SQLite (workspace-tagged, WAL, sole writer); write-once run receipts; DB references governance by ID, never copies. | | |
| ~~S3 — One concept, one home (topology)~~ | **RESOLVED → [ADR-0008](./0008-repository-topology.md):** v1 storage zones retained; six packages (core/adapters/session-hosts/daemon/cli/ui) with inward-only deps enforced by a deterministic CI check; personas = flat governance markdown files (+ scripts), default set in templates, loader in core. | | |
| ~~S4 — Oz ↔ runner boundary~~ | **RESOLVED → [ADR-0004](./0004-process-architecture.md):** I/O-agnostic `core` library (deps inward); Oz daemon = always-on owner in interactive use; CLI runs standalone headless; single-writer-at-a-time via SQLite lock. | | |
| ~~S5 — Persona / model-tiering contract~~ | **RESOLVED → [ADR-0005](./0005-personas-and-subtasks.md):** two tiers — top-level personas + a shared registry of delegatable Plays; CLI+model set per-persona AND per-(persona,Play) in Oz; one-level delegation for MVP. | | |
| ~~S9 — Collaboration model~~ (surfaced mid-Q&A) | **DISSOLVED → [ADR-0005](./0005-personas-and-subtasks.md):** no standing "route" concept; collaboration = the Play delegation graph + dynamic persona-to-persona assignment within configured personas. Kills the F1 route→priority coupling. | | |
| ~~S6 — Adapter / sandbox contract~~ | **RESOLVED → [ADR-0006](./0006-adapter-contract.md):** per-CLI driver behind a common interface; trust-the-CLI (normal perms, no OS sandbox); deterministic preflight (installed/authed/model); + a "Test CLI permissions" probe = deterministic capability verification + agentic setup guidance. | | |
| ~~S7 — Write-scope & enforcement boundary~~ | **RESOLVED → [ADR-0007](./0007-write-scope-enforcement.md):** allow-list globs (per-persona default, priority-narrowable; Play types carry default scopes); enforced by deterministic git-diff check at CoCoder's commit gate; out-of-scope = block-commit-but-surface-for-approval; honest that out-of-band git isn't policed. | | |
| ~~S8 — Persona extensibility seam~~ | **RESOLVED → [ADR-0009](./0009-extensibility.md):** extend by adding governance files (custom personas/Plays/scopes) — no core fork; defaults ship in templates, adopters override in their workspace. One exception: a new CLI needs an adapter driver (code) until data-driven adapters are earned. | | |

## Conventions

- ADRs are numbered sequentially from 0002. One decision per ADR.
- An ADR is added to **Accepted** only after founder review.
- A seam graduates from this table to an ADR when resolved; the table row then links to it.
- **HARD RULE — no stale decisions (founder directive 2026-06-14, reaffirmed 2026-06-17).** An accepted
  ADR must never sit in the live tree claiming current truth while a later decision contradicts it. So
  **whenever a new ADR supersedes or amends an existing one, that same change MUST update the
  superseded/amended ADR** — flip its `Status:` to Superseded/Amended, add a forward-pointer banner to
  the superseding ADR, and update this index (move it to *Retired to history*, or note the amendment).
  Never land the superseding ADR alone. Prefer status-flip + forward-pointer over rewriting an ADR's body
  (preserve the historical record); a body that would actively mislead gets a banner reframing it.
