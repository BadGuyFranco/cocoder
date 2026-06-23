---
id: domain-glossary
title: "Domain glossary — every onboarded primary root ships a canonical vocabulary surface"
---

## Objective

Every onboarded primary root receives a **domain glossary** as a standard, scaffolded governance
deliverable: one canonical, deliberately thin surface holding *this repository's* product/domain
terms-of-art so every persona uses the repo's nouns consistently. The deliverable is established with a
**boundary so clear no persona is unsure where a term's definition belongs** — distinct by construction
from `memory/`, `decisions/`, `standards/`, and from CoCoder's own *engine* glossary.

**Verified when:**
- A fresh **New Primary** scaffold writes `cocoder/glossary.md` (seeded with the convention + one example
  row, otherwise empty) into the target's `cocoder/` zone and commits it through the spine — proven by the
  scaffold test asserting the file in the delivered governance set, and by a runnable proof
  (`scripts/proof-*onboard*.mjs`) showing it in the committed set.
- `cocoder/AGENTS.md` "Start Here" routing points to `cocoder/glossary.md` (the per-repo analog of the
  install `ARCHITECTURE.md → docs/glossary.md` link; onboarded repos carry no `ARCHITECTURE.md`).
- An **Onboard-existing** run drafts real domain terms into `cocoder/glossary.md` during synthesis (P5/P6),
  so the file is alive on first onboarding rather than a dead stub — covered by the onboarding synthesis
  test/proof.
- An ADR records the deliverable **and** the boundary below as the single source the templates reference;
  an automated check fails if a second copy of the boundary rule appears.

## Boundary — one owner per concept (the research, made explicit)

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

## Conflict scan (ADR-0035) — surfaced for founder

- **`new-primary-root` (onboarding machinery, disposition `blocked`).** Genuine overlap: this priority adds
  a new artifact to the onboarding *deliverable set* that `new-primary-root` built (touches the scaffold
  template, `scaffoldCocoderZone`, the `onboard-existing` Playbook, and the `cocoder/AGENTS.md` template).
  **Boundary:** `new-primary-root` owns the onboarding *flow/machinery* and stays as-is; this priority owns
  *adding the domain-glossary artifact + its boundary ADR* to what that flow delivers. It extends, does not
  reopen, `new-primary-root`.
- **`oz-file-access` / `oz-autonomy`.** Synergy only — a domain glossary is another flat file Oz can read
  and (under `oz-autonomy`) help maintain. No collision.
- No existing priority owns vocabulary/glossary; no direct id or scope collision.

## Boundary / scope

Writes CoCoder **engine** source and base governance, not target product code: `templates/workspace-cocoder/**`,
`packages/core/src/scaffold/**`, the base `onboard-existing` Playbook + `cocoder/AGENTS.md` template, a new
ADR under `cocoder/decisions/**`, and a one-line note in `docs/glossary.md`/`ARCHITECTURE.md` describing the
two-tier (engine vs domain) glossary model. Base-governance + scaffold code ⇒ a **verified run** with the
scaffold/onboarding/persona-Play tests, committed via the spine (ADR-0023). Decomposition into atoms happens
at delegation, not here.

## Key decisions / relations

- [ADR-0008](../decisions/0008-repository-topology.md) — repository topology; file-driven extensibility of the
  `cocoder/` zone (the home a domain glossary joins).
- [ADR-0020](../decisions/0020-primary-root-audit.md) / [ADR-0026](../decisions/0026-onboard-existing-as-oscar-priority.md)
  — onboarding situations + scaffold-seeded delivery + Onboard-existing as an ordinary Oscar priority (the
  machinery this deliverable plugs into).
- [ADR-0023](../decisions/0023-workspace-commit-spine.md) — the spine the scaffold writes through.
- `docs/glossary.md` (engine glossary) + its "Elegance / Elegant" precedent — the two-tier model and the
  "link to the owning surface" convention this priority generalizes to the domain tier.
