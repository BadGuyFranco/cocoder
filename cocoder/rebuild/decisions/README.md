# Rebuild Decisions (ADR index)

Clean ADR set for the v2 rebuild. Authoritative for v2; the v1 ADRs under
`cocoder/decisions/` are history (see [ADR-0001](./0001-rebuild-charter.md), Supersedes).

## Accepted

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-rebuild-charter.md) | Rebuild Charter — why, disciplines, locked decisions | Accepted |
| [0002](./0002-substrate-oz-and-cmux.md) | Substrate: Oz brain + cmux terminal host (S1) | Accepted |
| [0003](./0003-data-model-hybrid.md) | Data model: hybrid files + central Oz-owned SQLite (S2) | Accepted |
| [0004](./0004-process-architecture.md) | Process architecture: core lib, optional daemon, CLI-standalone (S4) | Accepted |
| [0005](./0005-personas-and-subtasks.md) | Personas + delegatable sub-tasks (S5; dissolves S9) | Accepted |
| [0006](./0006-adapter-contract.md) | Adapter contract: trust-the-CLI + capability probe (S6) | Accepted |
| [0007](./0007-write-scope-enforcement.md) | Write-scope: allow-list + commit-gate enforcement (S7) | Accepted |
| [0008](./0008-repository-topology.md) | Repository topology + one-home enforcement (S3; amends 0005; ~resolves S8) | Accepted |
| [0009](./0009-extensibility.md) | Extensibility: extend by files; new CLIs need a driver (S8) | Accepted |
| [0010](./0010-taxonomy-and-authoring.md) | Taxonomy & authoring lifecycle: Playbooks, Plays, Objectives (amends 0005) | Accepted |
| [0011](./0011-orchestrator-verify-gate.md) | Orchestrator verify-gate: the commit runs only on Oscar's pass (refines 0004) | Accepted |
| [0012](./0012-living-base-personas.md) | Living base personas + repo extensions — base ships with the install & propagates; repos layer deltas (amends 0008/0009) | Accepted |

**Phase-0 architecture Q&A complete — all seams resolved (ADRs 0001–0009).** ADR-0010 (taxonomy &
authoring) accepted 2026-05-29 after a 6-lens adversarial review. ADR-0011 (orchestrator verify-gate)
accepted 2026-05-29 — earned from a dogfood run where an unverified builder diff broke a sibling
package's tests and was auto-committed. ADR-0012 (living base personas) accepted 2026-05-29 — the base
set is referenced & propagates to all installs (replaces copy-on-init); required for Deb to improve the
base for everyone.

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
| ~~S5 — Persona / model-tiering contract~~ | **RESOLVED → [ADR-0005](./0005-personas-and-subtasks.md):** two tiers — top-level personas + a shared registry of delegatable sub-tasks; CLI+model set per-persona AND per-(persona,sub-task) in Oz; one-level delegation for MVP. | | |
| ~~S9 — Collaboration model~~ (surfaced mid-Q&A) | **DISSOLVED → [ADR-0005](./0005-personas-and-subtasks.md):** no standing "route" concept; collaboration = the sub-task delegation graph + dynamic persona-to-persona assignment within configured personas. Kills the F1 route→priority coupling. | | |
| ~~S6 — Adapter / sandbox contract~~ | **RESOLVED → [ADR-0006](./0006-adapter-contract.md):** per-CLI driver behind a common interface; trust-the-CLI (normal perms, no OS sandbox); deterministic preflight (installed/authed/model); + a "Test CLI permissions" probe = deterministic capability verification + agentic setup guidance. | | |
| ~~S7 — Write-scope & enforcement boundary~~ | **RESOLVED → [ADR-0007](./0007-write-scope-enforcement.md):** allow-list globs (per-persona default, priority-narrowable; sub-task types carry default scopes); enforced by deterministic git-diff check at CoCoder's commit gate; out-of-scope = block-commit-but-surface-for-approval; honest that out-of-band git isn't policed. | | |
| ~~S8 — Persona extensibility seam~~ | **RESOLVED → [ADR-0009](./0009-extensibility.md):** extend by adding governance files (custom personas/sub-tasks/scopes) — no core fork; defaults ship in templates, adopters override in their workspace. One exception: a new CLI needs an adapter driver (code) until data-driven adapters are earned. | | |

## Conventions

- ADRs are numbered sequentially from 0002. One decision per ADR.
- An ADR is added to **Accepted** only after founder review.
- A seam graduates from this table to an ADR when resolved; the table row then links to it.
