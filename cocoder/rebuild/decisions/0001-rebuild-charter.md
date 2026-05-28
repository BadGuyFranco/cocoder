# ADR-0001 — Rebuild Charter

**Status:** Accepted (founder + Claude, 2026-05-28)
**Supersedes:** the v1 ADR set under `cocoder/decisions/` is treated as *history*; where a
rebuild ADR conflicts with a v1 ADR, the rebuild ADR wins.

## Context

CoCoder v1 shipped `v0.1.0` and the *concept* is sound: drive multiple model CLIs from
explicit priorities with bounded scope, durable evidence, and result artifacts, watched from
a local dashboard (Oz). But v1 was built **guardrails-first** — a contract/boundary/governance
engine was designed up front, before a running loop revealed which guardrails were actually
needed. Consequences, documented in [`../failure-catalog.md`](../failure-catalog.md):

- Real ceremony cost on every run; heaviest path applied even to trivial changes.
- Machinery that guards its own machinery (F5).
- Scattered governance state causing ghost priorities, dangling ADRs, config fragmentation
  (F1–F4).
- The system, to date, only manages **itself** — never a second repo.

The founder values architecture where **every concern has exactly one logical home**, and a
**deterministic + probabilistic** split (deterministic where there's an oracle; probabilistic
for judgment). v1 violated the first and misapplied the second.

## Decision

Rebuild CoCoder from the ground up in a clean structure, under the following **binding
disciplines**. These govern every subsequent rebuild ADR and every line of v2 code.

### Locked decisions (not reopened)

1. **Path B — CLIs, not APIs.** Each model runs via its own CLI (Claude Code, Codex,
   cursor-agent, …) as a visible process. Rationale: founder visibility into what's happening,
   and CLI subscriptions are materially cheaper than metered API calls. *This is a conviction,
   not a default.*
2. **Keep Oz.** A local control surface to launch priorities, set CLI+model per persona, and
   observe runs. Oz's role is retained; its implementation (incl. a possible Electron app) is a
   seam to be decided (see seam S1).
3. **Tiered personas.** Orchestrator / coder / cheap-admin tiering is sound and retained as the
   *shape*. Personas are bound to tasks; the orchestrator spins off focused work.
4. **Dogfood first, then external.** v2 is proven on CoCoder itself, then on an existing repo
   (CoBuilder / cofounder). External onboarding is the real validation.

### Binding disciplines

- **D1 — Seam, not feature.** We decide and ADR only what is *expensive to reverse*. The
  architecture must *admit* the eventual vision; the implementation stays minimal-viable.
  Anything cheap to change later is backlog, not foundation. The Q&A surfaces the vision **only
  to locate seams**, never to build features.
- **D2 — Guardrails are earned.** Every deterministic check traces to a row in the failure
  catalog or a failure observed during dogfooding. No speculative guardrails.
- **D3 — Deterministic at the boundary, probabilistic for judgment.** Deterministic checks
  guard the **agent→reality boundary** (did the diff stay in scope, did tests run, did the
  commit link to the run). They never police our own governance docs (that was F5). Judgment
  (is this the right design, is this code good) stays probabilistic.
- **D4 — One concept, one home.** Every concern has a single logical location; cross-references
  derive from the source, never restate it. This is an *enforced invariant* (see the Topology
  and data-model seams), and would have prevented F1/F2/F4 outright.
- **D5 — No governance-of-governance.** Governance stays simple enough that it needs no checker
  to keep it consistent. If we're tempted to write a validator for our own markdown, the
  governance model is too complex — simplify it instead.
- **D6 — Earned, not big-bang.** Build the thinnest spine + the feedback instrument first; add
  capability only as dogfooding demands it. "Finish Oz / build the vision" up front is the
  exact trap we're escaping.

### Process

1. Resolve the candidate seams in [`README.md`](./README.md) into clean ADRs, **reviewed
   together** before v2 code is written (Phase 0, [`../PLAYBOOK.md`](../PLAYBOOK.md)).
2. v1 stays frozen in `../zArchive/` and tag `archive/pre-rebuild`. Reusing a v1 primitive is a
   deliberate *port* recorded in an ADR — never a silent import.
3. v1 `packages/` is left untouched until the Topology ADR defines where v2 code lands and what
   gets removed.

## Consequences

- We trade the comfort of an existing engine for a foundation that matches the founder's
  architectural values and the lessons of the failure catalog.
- Risk: "architecturally sound enough to grow to the vision" can regenerate v1's
  over-engineering. D1 is the explicit guard against that and must be enforced in every Q&A
  answer ("seam or feature?").
- The v1 ADRs remain readable as history; they are not authoritative for v2.

## Open seams

Tracked in [`README.md`](./README.md). None are decided by this charter; the charter only sets
*how* we decide them.
