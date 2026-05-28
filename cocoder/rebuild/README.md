# CoCoder Rebuild

The ground-up rebuild of CoCoder. Everything about *planning and governing the rebuild*
lives in this directory. The v2 product code will live in the repo's `packages/` (replacing
v1 only after the architecture is decided — see the Topology ADR).

## Why we're rebuilding

v1 works and v0.1.0 shipped, but it was built **guardrails-first**: a heavy
contract/boundary/governance engine was designed up front, before a running loop revealed
which guardrails were actually needed. The result is real ceremony cost, machinery that
guards its own machinery, and a system that — so far — only manages itself. The concept is
sound; the foundation is over-engineered. See [`decisions/0001-rebuild-charter.md`](./decisions/0001-rebuild-charter.md).

## Navigation

| File | What it is |
|---|---|
| [`decisions/0001-rebuild-charter.md`](./decisions/0001-rebuild-charter.md) | The charter — why, the binding disciplines, what's locked |
| [`decisions/README.md`](./decisions/README.md) | ADR index + the **candidate irreversible seams** the Q&A must resolve |
| [`PLAYBOOK.md`](./PLAYBOOK.md) | The phased, self-checking plan to MVP + exit criteria |
| [`failure-catalog.md`](./failure-catalog.md) | v1 failures (mined from history) → architectural implications |
| `../zArchive/` | Frozen v1 source reference |

## Where we are

**Phase 0 — Architecture Q&A: seams resolved.** ADRs 0001–0009 accepted (all nine seams; S9
dissolved). CoBuilder persona rules audited into [`persona-rules-to-carry.md`](./persona-rules-to-carry.md).
**Remaining Phase-0 exit gate:** the cmux socket-API spike (ADR-0002). Then Phase 1 (the spine).

| File | What it is |
|---|---|
| [`persona-rules-to-carry.md`](./persona-rules-to-carry.md) | Durable persona rules mined from CoBuilder (feeds Phase-1 persona authoring) |

## The two rules that govern everything here

1. **Seam, not feature.** We only decide (and ADR) things that are *expensive to reverse*.
   Anything cheap to change later is implementation — it goes in a backlog, not the
   foundation. The architecture must *admit* the eventual vision; the implementation stays
   minimal.
2. **Guardrails are earned, not guessed.** Every deterministic check must point at a real
   failure in [`failure-catalog.md`](./failure-catalog.md) or one observed during dogfooding —
   and it guards the **agent→reality boundary** (scope, tests, commits), never our own
   governance docs.
