---
id: 0091
title: Onboard-existing recon: capture a per-root test convention profile to back the test-architecture detect-and-honor posture
type: task
status: Open
priority: none
owner: founder-session
created: 2026-06-30
---

# 0091 — Onboard-existing recon: capture a per-root test convention profile to back the test-architecture detect-and-honor posture

## Context / origin

Ticket 0089 (closed run_297) closed the two documentation gaps in
`cocoder/standards/test-architecture.md`: the four rules are now language-neutral, and the Existing
Repos clause states a detect-and-honor / default-for-new / convergence-target /
propose-opt-in-split posture. But that detection is currently PROSE the persona follows by judgment
during onboarding. The standard's own 'Proposed direction' floated automating it; 0089's close spun
that automation out to this ticket.

## Seam

When CoCoder onboards an existing repo, nothing programmatically captures the repo's established
test conventions for the standard to defer to — the persona infers framework/layout/naming each
time. A captured profile would make the detect-and-honor posture repeatable instead of re-derived
per session.

## Proposed direction

Extend the onboard-existing recon flow (`inventoryRepo` in `packages/core/src/playbooks/recon.ts`,
surfaced via the onboard-existing path — see `docs/onboarding-rebuild-ownermap.md`) to capture a
per-root **convention profile**: test framework, directory layout (co-located vs a tests/ dir),
naming convention, and the repo's shared-fixtures module pattern. The test-architecture standard
then explicitly defers to that profile. A future builder must re-verify the live recon surfaces
before wiring this — the ownermap doc is a historical record.

## Founder decision pending

This would be the FIRST programmatic backing of a prose CoCoder standard (today all standards are
prose followed by agents). Whether to build it, and at what scope, is a founder prioritization call
— this ticket only captures the thread; it does not authorize the build.
