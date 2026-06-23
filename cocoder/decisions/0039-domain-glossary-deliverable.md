# ADR-0039 — Domain glossary deliverable and boundary

**Status:** Accepted (founder-directed, 2026-06-23)
**Builds on:** [0008](./0008-repository-topology.md) (the tracked `cocoder/` governance zone),
[0020](./0020-primary-root-audit.md) / [0026](./0026-onboard-existing-as-oscar-priority.md)
(onboarding deliverables), and [0023](./0023-workspace-commit-spine.md) (committed through the spine).

## Context

CoCoder already has an install-owned engine glossary at `docs/glossary.md`: it defines CoCoder framework
terms such as runner, atom, persona, and commit spine. Onboarded workspaces also need a place for their own
product vocabulary, but that surface must not become a second memory tree, decision log, or standards file.

The `domain-glossary` priority established the deliverable and its boundary. This ADR is the single
canonical source for that deliverable and boundary so scaffold and onboarding templates can reference one
owner instead of restating the rule.

## Decision

Every onboarded primary root ships `cocoder/glossary.md`: one canonical, deliberately thin governance
surface holding *this repository's* product/domain terms-of-art. It is scaffold-seeded with the convention
and one example row, otherwise empty, and committed through the spine.

The glossary model has two tiers:

| Glossary | Owner | Scope |
|---|---|---|
| `docs/glossary.md` | CoCoder install | CoCoder framework terms: runner, atom, persona, commit spine, and other engine vocabulary. |
| `cocoder/glossary.md` | Each workspace | That repo's product/domain terms-of-art. It must not redefine engine terms; where one is referenced, it links to `docs/glossary.md`. |

The domain glossary boundary is:

The glossary is the **only** governance surface whose unit is *the word itself*. Every other surface is
organized by topic, decision, or file; the glossary is organized by **term** and **points outward** to the
surface that owns the concept. This is what keeps it from duplicating anything.

| Surface | Unit | Answers | Holds |
|---|---|---|---|
| `cocoder/glossary.md` (this) | a **term** | "what does this word mean, so we all use it the same way?" | one-line canonical definition **+ a link to the owning surface**. Nothing more. |
| `cocoder/memory/**` | a **subsystem / fact** | "how is the codebase laid out, what's the stack, what have we learned?" | structural and technical knowledge (codebase map, tech stack, onboarding findings). |
| `cocoder/decisions/**` | a **decision** | "why was this chosen?" | durable rationale (ADRs). |
| `cocoder/standards/**` | a **rule** | "how must personas operate on this repo?" | RACI, write boundaries, evidence, escalation, protocols. |
| `docs/glossary.md` (engine) | a **framework term** | "what does this CoCoder concept mean?" | runner, atom, persona, commit spine — CoCoder-system vocabulary, install-owned. |

Operating rules that make the boundary self-enforcing:
1. **A glossary entry is a gloss + an owner link, never the substance.** If the explanation needs more than
   a line, the substance lives in the linked owner (a decision, a standard, a memory section, or code) and
   the glossary only points there. An entry with no owner surface yet is a one-line stub until one exists.
2. **"What a word means" vs "how/where it works."** Consistent meaning of a noun → glossary. Layout, stack,
   or how-it-works → `memory/`. Why a choice was made → `decisions/`. How personas must behave →
   `standards/`.
3. **Domain, not framework.** The domain glossary holds the *product's* terms-of-art. It must **not**
   redefine CoCoder engine terms; where one is referenced, it links to the engine `docs/glossary.md`. Two
   tiers, two owners: engine glossary (install) and domain glossary (per workspace).

## Consequences

- New-primary and onboard-existing paths add `cocoder/glossary.md` to the delivered governance set.
- Templates and onboarding prose reference this ADR for the boundary rule instead of restating the table or
  operating rules.
- `docs/glossary.md` remains the install-owned engine glossary; domain glossaries link to it for framework
  terms instead of redefining them.

**Verified when:** the boundary rule has exactly one home: this ADR. Scaffold and onboarding templates
reference it rather than restating it, and an automated check fails if a second copy of the boundary rule
appears.
