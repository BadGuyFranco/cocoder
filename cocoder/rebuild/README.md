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

**Phase 2 — Oz thin: ✅ built (2026-05-28), exit pending the founder's first real launch.**
A loopback-HTTP daemon (`@cocoder/daemon`, always-on owner) + a vanilla static dashboard
(`@cocoder/ui`) over the spine: workspace list · priority list + launch · persona→CLI/model editor ·
run list/detail with a live cmux deep-link. `cocoder run` now probes for the daemon (client vs
standalone). Built on `rebuild/phase-2-oz` after a 5-lens adversarial plan review (11 findings folded
in). See [`oz-thin.md`](./oz-thin.md) + [`PLAYBOOK.md`](./PLAYBOOK.md). **To finish the exit:** stop
any stale v1 daemon on :7878, `cocoder oz start`, launch a priority from the dashboard.

**Phase 1 — The spine: ✅ complete (2026-05-28).** `cocoder run <priority>` drives a real
Oscar(claude)→Bob(codex) orchestration in cmux on the CoCoder repo, gated by the write-scope
commit-gate, with a durable run record. Evidence: commit `57c0781` produced via the flow; build
notes in [`PLAYBOOK.md`](./PLAYBOOK.md) (Phase 1 section) + the spikes.

- Phase 0 (architecture): ADRs 0001–0009 accepted; cmux spike passed.
- Phase 1 (spine): six packages (core/adapters/session-hosts/daemon/cli/ui) on `rebuild/phase-1-spine`,
  inward-only topology check, cmux `SessionHost` driver, node:sqlite `RunStore`, flat-file personas
  + shared standards, claude/codex adapters w/ preflight, the commit-gate, the thin runner.

**👉 Pick up next: Phase 3 — dogfood + earn guardrails.** Run real work through Oz; add a guardrail
only in response to a repeated observed failure. The `daemon`/`ui` packages are now built (Phase 2).

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
