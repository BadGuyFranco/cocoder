# ADR-0030 — Retire the `spike` concept

**Status:** Accepted (founder-directed, 2026-06-20).
**Supersedes:** [0008](./0008-repository-topology.md)'s `spikes/` topology line — the standalone
directory genre is retired from the live directory model. ADR-0008 remains the canonical topology ADR;
this ADR supersedes only the line that treated `cocoder/spikes/` as a live home. As of 2026-06-20, this
ADR also retires `spike` as a ticket type by folding that vocabulary into `question`.
**Builds on:** [0008](./0008-repository-topology.md) (repository topology and one-home enforcement),
[0010](./0010-taxonomy-and-authoring.md) (launchable priority model), and
[0026](./0026-onboard-existing-as-oscar-priority.md) (work runs through Oscar-driven priorities rather
than standalone executor surfaces).

## Context

The `spikes/` directory survived the rebuild as a sibling under `cocoder/` for exploration notes that
informed ADRs. That made sense while the architecture seams were being discovered, but it has no runtime
execution path. CoCoder launches priorities and tickets; it does not scan or dispatch standalone spike
files. A separate spike directory therefore accumulates unreachable work: it looks like a live genre, but
nothing can run it.

The legitimate need remains. Sometimes a run must research a tool, validate an assumption, or explore a
thin design before building. Those needs already have launchable homes: a priority's research or planning
phase, or an `adhoc-session` when no named priority exists yet. Keeping a third home weakens the topology
without adding execution capability.

The two existing standalone spike notes are historical inputs to ADR-0002. They are preserved under
`cocoder/zArchive/spikes/`, not deleted.

## Decision

**Retire `spike` as a live CoCoder concept.**

The live directory model has no standalone spike home. Research belongs inside the launchable work that
needs it:

- a priority's research, planning, or validation phase when the work is tied to a named outcome; or
- `adhoc-session` when the founder needs a one-off investigation before deciding whether to create a
  priority or ticket.

The historical files formerly in `cocoder/spikes/` move unchanged to `cocoder/zArchive/spikes/`.

The ticket taxonomy now follows the same concept boundary: `spike` is no longer a ticket type.
Spike-shaped needs are research questions and use `type: question`.

## Consequences

- `cocoder/spikes/` is removed from live routing, topology, and architecture diagrams.
- Frozen spike notes remain available in `cocoder/zArchive/spikes/` for ADR archaeology.
- New research work must be reachable through a priority, ticket, or `adhoc-session`; a standalone file in
  a live `spikes/` directory is no longer valid.
- The ticket-create SSOT in `packages/daemon/src/routes.ts` accepts only `bug`, `task`, and `question`.
- The base `create-ticket` Play in `packages/personas/base/plays/create-ticket.md` no longer emits
  `spike` as a ticket kind.
- The workspace ticket conventions in `cocoder/tickets/AGENTS.md` and `cocoder/tickets/INDEX.md` list
  only `bug`, `task`, and `question`.
- ADR-0008 continues to own repository topology except where this ADR supersedes the retired `spikes/`
  line.
