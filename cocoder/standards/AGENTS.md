# `cocoder/standards/` — workspace extensions of the shipped base standard

CoCoder's shared operating standard **ships with the install** at
`packages/personas/base/shared-standards.md` — it is prepended to every persona prompt in every run,
in every workspace (ADR-0012's living-base model, applied to standards exactly as to personas).

This directory holds the **workspace-specific extensions** to that base: rules that are true for
*this* repo but would be noise or wrong elsewhere. The relationship mirrors
`packages/personas/base/` ⇄ `cocoder/personas/deltas/` — base behavior ships, extensions live here.

## When a rule belongs here vs the base

Apply the portability test (ADR-0012): strip the repo nouns — if the rule still teaches every
workspace something, it belongs in the shipped base (`shared-standards.md`, review-gated); if it
only makes sense with this repo's nouns in it, it belongs here.

| Situation | Belongs |
|---|---|
| "Verify with evidence, not the builder's claim" | Base (it's already there) |
| Dogfood-specific accountability or write-boundary nuances | Here |
| Code style, linter config | Neither — lives with the package, enforced by tooling |
| Architectural decisions | Neither — ADRs in `../decisions/` |

**Status:** intentionally empty today (D6 — earned, not pre-built). The first real
dogfood-specific standard creates the first file; until then the base standard is the whole
standard. When a file lands: short name, one-sentence purpose, concrete rules, cross-referenced
from whatever depends on it.
