---
id: local-preferences
title: Local Preferences — default tech stack and design spec for new/unspecified work
---

## Objective

Establish two founder-owned **local default** surfaces that apply whenever an onboarded workspace does
not specify its own, each with a single owner and a documented resolution rule (workspace-specified
value wins; otherwise the local default applies):

1. **Preferred tech stack for new repos.** Research, verify, and document the canonical preferred stack
   (languages, frameworks, test runner, build tooling, lint/format, pinned versions) as the local
   default seeded into a newly scaffolded repo. Note: today this is **not** actually configured —
   `templates/workspace-cocoder/cocoder/memory/tech-stack.md` ships as a stub ("# Tech stack (stub)"),
   so the assumption that it is already set is the first thing to correct. Verified by: a researched,
   evidence-backed stack decision living at one owner surface, with a short rationale per choice, that a
   freshly scaffolded repo actually receives.

2. **Default design spec.** Capture the CoCoder dashboard's design language / aesthetic / CSS
   (`packages/ui/src/renderer/styles/`) as the documented local-default design spec — color, type,
   spacing, and core component patterns — that any new UI inherits when the onboarded workspace defines
   no CSS/design of its own. Verified by: a design-spec document with one owner (extracted as
   tokens/patterns, not a second hand-copy of the CSS) plus the stated default-resolution rule.

**First research/decision gate — RESOLVED (run 78).** Home and resolution rule are settled by evidence
and founder-ratified:

- **Home = the shipped workspace template**, not an installation-global surface. `scaffoldCocoderZone`
  (`packages/core/src/scaffold/scaffold.ts`) copies `templates/workspace-cocoder/cocoder/**` into each
  repo's `cocoder/` zone **create-only** (`copyFileCreateOnly` skips any file that already exists).
- **Resolution rule = that create-only copy.** A freshly scaffolded repo receives the default; if a
  workspace later specifies its own value the seeded file is never overwritten, so **workspace-specified
  wins; otherwise the template default applies.** This needs **no new mechanism** — it is reconciled
  with ADR-0027 (workspace storage) and ADR-0026 (onboard-existing); the conclusion is **document-only**.
- **Owners differ per concept under that one mechanism.** The design-spec's single owner is
  `packages/ui/src/renderer/styles/design-spec.md` (co-located with its source CSS); the tech-stack has
  no product-code source, so its owner is the seeded file itself,
  `templates/workspace-cocoder/cocoder/memory/tech-stack.md`.

**Boundary:** this priority defines, researches, and documents the two defaults and their resolution
rule, and wires the default-resolution where a clear owner already exists. It does not restyle the
dashboard, does not impose the stack/design on already-onboarded workspaces that specify their own, and
does not rebuild scaffolding beyond what the resolution rule requires.

## Completion (run 79)

> **Disposition: `archive-candidate` (run_79).** Both deliverables landed and verified. Design-spec owner:
> `packages/ui/src/renderer/styles/design-spec.md` (run_78). Tech-stack owner + template seed:
> `templates/workspace-cocoder/cocoder/memory/tech-stack.md` (run_79). Design-spec template pointer:
> `templates/workspace-cocoder/cocoder/memory/design-spec.md` (run_79). Scaffold create-only copy
> (`copyFileCreateOnly`) seeds both files; workspace-specified values never overwritten. Standing proof:
> scaffold + mutations test file-set pins (green on every `pnpm test`). Founder archive confirmation only.
