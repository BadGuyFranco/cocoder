# ADR-0032 — Retire the base `playbooks` skeleton genre

**Status:** Accepted (founder-directed, 2026-06-21).
**Supersedes:** [0008](./0008-repository-topology.md)'s base-persona `playbooks/` topology line — the
standalone skeleton directory genre is retired from the live directory model. ADR-0008 remains the
canonical topology ADR; this ADR supersedes only the line that treated
`packages/personas/base/playbooks/` as a live home.
**Builds on:** [0008](./0008-repository-topology.md) (repository topology and one-home enforcement),
[0012](./0012-living-base-personas.md) (living base personas and repo extensions),
[0020](./0020-primary-root-audit.md) (the onboarding product structure), and
[0026](./0026-onboard-existing-as-oscar-priority.md) (onboarding runs through ordinary Oscar-driven
priorities rather than a standalone phase-executor/loader surface).

## Context

The base `playbooks/` directory survived the ADR-0026 retirement as a set of inert skeleton markdown
files under `packages/personas/base/playbooks/`. Its own README already stated that the retired loader no
longer read the directory. That made the directory design history, not a runtime surface.

Keeping it under the living base made the dead genre look current. The live delivery model is now
scaffold-seeded priorities plus ordinary Oscar-driven priority runs. The existing-repo path already lives
as `packages/personas/base/priorities/onboard-existing.md`; Drift has been rebuilt as an ordinary
priority; New Primary's remaining design notes are historical inputs until earned as a scaffold-seeded
priority or starter mechanism.

The live code module `packages/core/src/playbooks/` is a different concept. It contains reusable audit
tooling such as recon, drift reality reads, and p1-p6 helpers. This ADR does not retire or rename that
module.

## Decision

**Retire base `playbooks/` as a live CoCoder directory genre.**

The live directory model has no `packages/personas/base/playbooks/` home. Onboarding and drift work must
be reachable through launchable priorities or scaffold-seeded priority templates, not inert skeleton
files in the living base.

The historical files formerly in `packages/personas/base/playbooks/` move to `cocoder/zArchive/playbooks/`
with frozen-history markers:

- `README.md`
- `drift-audit.md`
- `new-primary.md`
- `new-primary-tech-stack.md`

## Consequences

- `packages/personas/base/playbooks/` is removed from live routing, topology, and architecture diagrams.
- Frozen skeleton notes remain available in `cocoder/zArchive/playbooks/` for ADR archaeology.
- New onboarding/drift work must be reachable through a priority, ticket, or scaffold-seeded priority
  template; a standalone file in the retired base `playbooks/` directory is no longer valid.
- The live `packages/core/src/playbooks/` code module stays untouched.
- ADR-0008 continues to own repository topology except where this ADR supersedes the retired
  `playbooks/` line.
