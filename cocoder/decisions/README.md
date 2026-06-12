# Decisions (ADR index)

The live ADR set — the one decisions tree. The frozen v1 ADRs live at
[`../zArchive/v1/decisions/`](../zArchive/v1/decisions/) (see [ADR-0001](./0001-rebuild-charter.md), Supersedes);
their still-live content was absorbed into [ADR-0019](./0019-multi-root-workspaces.md).

## Accepted

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-rebuild-charter.md) | Rebuild Charter — why, disciplines, locked decisions | Accepted |
| [0002](./0002-substrate-oz-and-cmux.md) | Substrate: Oz brain + cmux terminal host (S1) | Accepted |
| [0003](./0003-data-model-hybrid.md) | Data model: hybrid files + central Oz-owned SQLite (S2) | Accepted |
| [0004](./0004-process-architecture.md) | Process architecture: core lib, optional daemon, CLI-standalone (S4) | Accepted |
| [0005](./0005-personas-and-subtasks.md) | Personas + delegatable Plays (S5; dissolves S9) | Accepted |
| [0006](./0006-adapter-contract.md) | Adapter contract: trust-the-CLI + capability probe (S6) | Accepted |
| [0007](./0007-write-scope-enforcement.md) | Write-scope: allow-list + commit-gate enforcement (S7) | Accepted |
| [0008](./0008-repository-topology.md) | Repository topology + one-home enforcement (S3; relates to 0005; ~resolves S8) | Accepted |
| [0009](./0009-extensibility.md) | Extensibility — *merged into 0008 §Extensibility* (redirect signpost) | Merged → 0008 |
| [0010](./0010-taxonomy-and-authoring.md) | Taxonomy & authoring lifecycle: Playbooks, Plays, Objectives (refines 0005) | Accepted |
| [0011](./0011-orchestrator-verify-gate.md) | Orchestrator verify-gate — *merged into 0013* (redirect signpost) | Merged → 0013 |
| [0012](./0012-living-base-personas.md) | Living base personas + repo extensions — base ships with the install & propagates; repos layer deltas (amends 0008/0009) | Accepted |
| [0013](./0013-orchestration-observation.md) | Orchestration + observation: Oscar drives Bob through a multi-atom plan; tiered continuous monitoring (Oscar→Bob, Deb→Oscar, Oz→sessions) with the direct-your-primary rule (refines 0004) | Accepted |
| [0014](./0014-living-adrs.md) | ADRs are living documents (founder-approved, conflict-audited) | Accepted |
| [0015](./0015-isolated-working-state-per-run.md) | Isolated working state per run: worktree + branch, verified auto-merge on green | Accepted |
| [0016](./0016-deb-scoped-repair-fallback.md) | Deb: the scoped CoCoder repair fallback — live status feed + nudge-request channel + gate-enforced repair mode; base/delta write-scope split (refines 0013) | Accepted |
| [0017](./0017-oz-orchestration-persona.md) | Oz orchestration: Oz is a CLI-backed persona in a window, with a bounded tool surface (builds on 0005/0013) | Accepted |
| [0018](./0018-persona-run-mode-and-sub-agents.md) | Persona run-mode + sub-agents: sub-agents ARE per-persona Play assignments; `mode` honored the slice it lands (refines 0005) | Accepted |
| [0019](./0019-multi-root-workspaces.md) | Multi-root workspaces: `.code-workspace` files in `local/workspace/`, three root roles, no nesting (absorbs live v1-0007/0006) | Accepted |

## Proposed (founder review owed)

| ADR | Title | Status |
|---|---|---|
| [0020](./0020-primary-root-audit.md) | Primary-root audit: bootstrap + drift as one base Play, top-tier model via play assignment, shipped meta-priorities | Proposed |
| [0021](./0021-oz-repair-commit-authority.md) | Oz repair: trunk commit authority outside any run — idle-only one-shot repair, governance in-scope, machinery propose-only in v1 | Proposed |

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
