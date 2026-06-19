---
id: scaffold-template-reconciliation
title: "Reconcile live scaffoldWorkspaceGovernance with templates/workspace-cocoder as the single source of truth"
---

> **Drafted by Grok** — This priority was initially constructed by Grok (Grok Build AI coding harness) during a structured codebase review. It requires further review, validation, refinement, and explicit ownership by the founder / Oscar as the **first step** before any scoping or implementation work.

## Objective
Eliminate the divergence between the runtime scaffolding path (`scaffoldCocoderZone` / `scaffoldWorkspaceGovernance` in the daemon) and the canonical template tree at `templates/workspace-cocoder/`. After this work, the template tree (plus any required minimal seed files such as `assignments.json` and `adhoc-session.md`) is the single source; the scaffolding code simply copies it.

Deliver:
- The template tree produces a launch-ready `cocoder/` zone (AGENTS.md, priorities with adhoc, assignments.json, etc.) that matches or exceeds what the current inline scaffold produces.
- The daemon route and `scaffoldCocoderZone` are updated (or simplified) to use the template as the source.
- Any differences in the two paths are removed (see SESSION_LOG divergence note around `assignments.json`, adhoc priority, and CLAUDE pointer).
- Existing onboarding and workspace creation flows continue to work (or improve).
- Tests and proofs that touch scaffolding are updated.

**Verified when:**
- Creating a brand new workspace via Oz or CLI produces identical (or demonstrably better) governance files from the template.
- The previous inline scaffolding code paths no longer duplicate governance content.
- A fresh `cocoder init` or `POST /workspaces` produces a workspace that can immediately launch Oz and a priority without manual fixes.
- No regression in dogfood or any live workspace creation.

**Boundaries:** This is a hygiene / single-source-of-truth fix. It does not change the shape of governance that users get, the onboarding playbooks, or persona behavior.

## Context & Evidence
- SESSION_LOG (multiple recent atoms around Executor / scaffold work): "Divergence found (NOT yet reconciled — a deliberate next atom): the live `createWorkspace` scaffold writes a *different, minimal inline* file set ... and **ignores the `templates/workspace-cocoder/` tree**."
- `packages/daemon/src/routes.ts` contains `scaffoldWorkspaceGovernance` which calls `scaffoldCocoderZone`.
- Templates live at `templates/workspace-cocoder/` and are documented as what adopters receive.
- This is a classic F1/F4 single-source violation (governance content spread and at risk of drifting).
- The scaffold was hardened to always emit the files the launch path hard-requires (`assignments.json`, adhoc priority, etc.).

## Suggested Next Action
Audit both the template tree and the current scaffold implementation, fold any runtime-required seeds into the template, rewire the scaffold function to be a thin copier + light post-processing if needed, delete or deprecate the duplicated inline content, and prove end-to-end with a new workspace creation + launch.