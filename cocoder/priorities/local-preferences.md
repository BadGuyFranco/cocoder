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

**First research/decision gate (founder-ratified at launch):** where these local defaults live and how
they resolve. The seam is whether "Local Preferences" is an **installation-global** surface (one home on
the founder's machine, applied to every new/onboarded repo) or the **shipped workspace template**
(`templates/workspace-cocoder/`) seeded per repo — and how "default when the workspace doesn't specify"
is computed at scaffold/onboard time. Reconcile the chosen home with ADR-0027 (workspace storage
contract), the `scaffoldCocoderZone` contract, and ADR-0026 (onboard-existing). This gate may conclude
"document-only, no new mechanism" if the template-seed path already satisfies the need.

**Boundary:** this priority defines, researches, and documents the two defaults and their resolution
rule, and wires the default-resolution where a clear owner already exists. It does not restyle the
dashboard, does not impose the stack/design on already-onboarded workspaces that specify their own, and
does not rebuild scaffolding beyond what the resolution rule requires.
