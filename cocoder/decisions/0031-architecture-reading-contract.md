# ADR-0031 — Architecture reading contract

**Status:** Accepted (founder-approved, 2026-06-21).
**Builds on:** [0014](./0014-living-adrs.md) (ADRs feed one current-truth surface per earned scope),
[0008](./0008-repository-topology.md) (one-home topology), and
[0013](./0013-orchestration-observation.md) (orchestration surfaces).
**Relates to:** [ARCHITECTURE.md](../../ARCHITECTURE.md),
[docs/orchestration-contract-ownership.md](../../docs/orchestration-contract-ownership.md), and
[README.md](./README.md).

## Context

The dogfood repo now has enough accepted ADRs that a reader can learn the current architecture only by
resolving chains of amendments, supersessions, and historical rationale. That violates ADR-0014's
current-truth reading rule: decisions should feed the live surface for their architectural scope, not
force every persona to reconstruct the live model from archaeology.

This ADR is the first concrete instance of the ADR-0014 rule. It names the CoCoder reading contract only;
it does not move content, retarget comments, or change runtime behavior.

## Decision

**ARCHITECTURE.md is the concise current-truth entry point for CoCoder.** A persona that needs the current
architecture starts there. It carries the live map of the product, package boundaries, storage zones, and
the pointers to deeper owners.

**docs/orchestration-contract-ownership.md is the drill-down owner map for orchestration contracts.** When
the question is which prompt, runtime surface, validator, status projection, or test owns an orchestration
contract, that document is the scoped current-truth surface.

**cocoder/decisions/README.md remains the ADR index and history router.** It lists accepted decisions,
explains which historical records were superseded or merged, and routes readers to the rationale behind
the current surfaces.

Superseded ADR detail is demoted to history that feeds ARCHITECTURE.md and its linked drill-down surfaces.
The relationship is "feeds," not "replaces": ADRs keep the founder-approved reasoning, while the named
current-truth surfaces own the live read for their scope.

## Consequences

- A reader should not chase ADR chains to assemble CoCoder's current architecture; they start at
  ARCHITECTURE.md, then follow only the scoped drill-downs it names.
- Orchestration contract ownership has one drill-down owner map:
  docs/orchestration-contract-ownership.md.
- cocoder/decisions/README.md remains useful as the ADR index and history router, but it is not the
  architecture entry point.
- Later mechanics may move, demote, or retarget content to satisfy this contract. This ADR does not make
  those changes.
