---
id: deployment-plays
title: "Deployment Plays — human-gated deploys + key storage (deferred: Phase 5)"
---

## Objective
**Human-gated deployment Plays** cover the common targets — Vercel, Google Cloud, signed Electron
(Apple/Microsoft), GitHub — with the associated keys stored in the workspace `local/secrets` zone
(ADR-0008). **Verified** by one real, founder-approved deploy of an onboarded repo to one target, keys
sourced from `local/secrets`, with the deploy step gated on explicit human go-ahead (irreversible →
human decision; WISER tiered autonomy). Boundary: deployment procedures + key storage; **not** a new
"Charlie" persona — these are Plays + the existing secrets zone.

**Deferred — blocked on:** Phase 5 only — a repo that actually deploys (CoCoder doesn't). The generic
Plays prerequisite is **built** (the Plays base/delta mechanism + no-brainer Plays landed run_78/79,
`personas-and-plays` archived 2026-06-14), so the remaining blocker is an external deploy target plus
the secrets/keys UX. A constant CoBuilder pain, captured now so it's first in line at Phase 5; promote
out of `backlog/` when unblocked.
