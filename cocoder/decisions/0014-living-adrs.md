# ADR-0014 — ADRs are living documents (founder-approved, conflict-audited)

**Status:** Accepted (founder + Claude, 2026-05-30)
**Seam:** governance / decision-record lifecycle
**Charter:** [0001](./0001-rebuild-charter.md) (D3 probabilistic-for-judgment · D4 one-home · D5 no-governance-of-governance)
**Relates to:** every ADR (this defines how any ADR may change)

## Context

The traditional ADR convention is append-only immutability: once accepted, an ADR is never edited;
changes arrive as *new* ADRs that supersede, with the old kept verbatim as history. That convention
serves human teams scanning a decision timeline. It is actively harmful for **agentic coding**: an
agent assembling context must reconstruct the *current* truth from a stack of superseded specs,
amendment headers, and cross-references. That is noise, and noise degrades model decisions. In
CoCoder the ADR set is loaded as the embodiment of the codebase's **current** decisions — it must
read as current truth, not as a changelog.

## Decision

### An ADR is the current, clear embodiment of a decision — and may be rewritten in place
ADRs may be **edited directly** to sharpen clarity or to reflect an evolved decision, rather than
only appended-to or superseded. The body always states the decision **as it stands now**. A short
**History** note may be added below the spec when the evolution is itself worth remembering (what
changed and why); it is optional and stays brief — it must never crowd out the current truth.

### Changing an ADR requires explicit founder approval + a briefing
An ADR is founder-owned. Before any ADR is edited or added, the founder receives a briefing and gives
**explicit approval**. The briefing contains:
1. **Why** — what is changing and the reason.
2. **An ADR conflict audit** — a summary of how the change interacts with the other ADRs: what it
   amends, what it relocates, and any collision or ambiguity it introduces, surfaced for the founder
   to resolve.

This is a **judgment briefing, not an automated checker** (charter D3 + D5): a persona surfaces the
audit and the founder decides. We do **not** build a validator over our own ADR markdown — that is
the governance-of-governance trap D5 forbids.

### Cross-references stay as live relationships, not a mutation log
The existing "Amends / Amended by / Relates to" headers remain — but as **current relationships**
between live decisions, not an append-only record of edits. When an ADR is rewritten in place, its
cross-refs are updated to the new truth; superseded phrasing leaves the body (optionally captured in
a brief History note).

### ADRs feed one current-truth surface per scope
ADRs preserve the decision and its rationale, but they are not always the fastest current-truth read.
When an architectural scope has a current-truth surface, ADRs feed that surface. Superseded detail is
demoted to history that explains the current surface instead of forcing readers to chase an ADR chain.

A narrower scope earns its own current-truth surface, with exactly one parent link, only when it is
independently shipped or owned, or when its current-truth section no longer fits on one screen. The
default is one surface per scope; split only when the narrower surface is earned.

### Who proposes; who approves
Any persona may **propose** an ADR change with the briefing — commonly Deb (base-vs-repo fixes) or
Oscar. Only the founder **approves**. A base/product ADR change ships to all installs, so it lands
review-gated (consistent with ADR-0012's propagation gate).

## Consequences

- The ADR set stays readable as **current truth** — the right shape for loading into an agent's
  context, and the reason this departs from append-only convention.
- Architectural readers get one current-truth surface per earned scope, with ADRs as rationale/history
  rather than a chain the reader must resolve.
- The cost moves from "scan a changelog" to "trust the body + a focused conflict audit at change
  time" — paid by judgment (D3), never by a governance validator (D5).
- v1 ADRs remain frozen history (ADR-0001); this lifecycle governs the **rebuild** ADR tree only.

## History

- **2026-06-21:** Founder-approved amendment: ADRs now explicitly feed one current-truth surface per
  architectural scope, and superseded detail is demoted to history once the current surface owns the
  read.
