---
id: 0027
title: onboard-existing template Objective assumes a code repo; support content/ops repos as a first-class onboarding target
type: task
status: Closed
priority: new-primary-root
owner: oscar run_177
created: 2026-06-22
---

# 0027 — Onboarding template should acknowledge non-code (content/ops) repos

## Context
The seeded `templates/workspace-cocoder/cocoder/priorities/onboard-existing.md` (and the live copy at
`cocoder/priorities/onboard-existing.md`) frames the audit around **product code**: "An existing repo (real
product code …)", "deep multi-agent **code** review", "build/test commands", "dep graph", "file:line
evidence". The first live onboarding target — Job Hunt (run_178) — is a **markdown-driven operating system**
(governance/manual docs, a Playbook, an Applications/Recruiters/Outreach pipeline of trackers) with only a
thin Node tooling layer under `Process/scripts/`. The running Oscar **adapted correctly** (its recon
directive explicitly scoped "a markdown-driven executive job-hunt operating system, NOT a conventional
software product" plus the thin JS layer), so the *machinery* compensated — but the **template text** still
assumes code, which will mis-frame the audit for any content/ops/docs repo and relies on the orchestrator to
notice and override every time.

## Proposal
Update the onboard-existing template so a non-code repo is a first-class case, not an override:
- Generalize the Objective from "product code" to "an existing repo (code, content, ops/docs, or a mix)".
- In the decomposition, make subsystem typing explicit: detect and treat **content/governance subsystems**
  and **code subsystems** as distinct read targets (the live recon already proposed exactly this split).
- Keep the evidence rule but generalize "file:line" to "path (and line where it applies)" so markdown
  trackers and docs are first-class evidence, not second-class.
- Preserve everything that already works: the `cocoder/**` trust boundary, the founder gates
  (recon/spend → questions → ratify), and dual-source + cross-check.

## Acceptance
- The template Objective and decomposition no longer presuppose product code; a content/ops repo reads as
  an intended target, not an exception the orchestrator must rescue.
- A reviewer can point to the template language that tells the audit to type subsystems (code vs
  content/ops) and scope reads accordingly.
- No regression for genuine code repos (the code-subsystem path is still fully specified).

## Refs
- Template owner: `templates/workspace-cocoder/cocoder/priorities/onboard-existing.md`.
- Evidence the machinery already adapts: run_178 `directive-0.json` recon scope (markdown-OS + JS layer).
- Decision context: ADR-0020 / ADR-0026 (onboard-existing as an ordinary Oscar priority).
- Discovered: Job Hunt onboarding (run_178); reassessed run_177.

## Resolution

Resolved by run run_181 (ef093f950b80a65dc948250931733610022af245) on 2026-06-22 (Atom F).

The `onboard-existing` priority template now treats a non-code repo (content / ops / docs, or a mix) as a first-class target: the Objective no longer presupposes product code, recon + deep-read type subsystems explicitly as code vs content/governance/ops and scope reads accordingly, and the evidence rule is generalized from `file:line` to "path (and line where it applies)". The `cocoder/**` trust boundary, founder gates, dual-source + cross-check, and the code-repo path are preserved. The edit was applied identically to both byte-identical copies (`templates/workspace-cocoder/...` and `packages/personas/base/priorities/...`), and `scaffold.test.ts` restores a genuine cross-copy sync guard (fails on drift).
