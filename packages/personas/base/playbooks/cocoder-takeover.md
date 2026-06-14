---
id: cocoder-takeover
title: "CoCoder Takeover — onboard an existing repo via a deep multi-agent audit"
type: onboarding-playbook
mode: takeover
writeScope: ["cocoder/**"]
modelPin: top-tier
---

> **DRAFT — pending [ADR-0020](../../../../cocoder/decisions/0020-primary-root-audit.md). Inert until the
> loader reads `base/playbooks/`.**

## Objective
An existing repo (real code, no `cocoder/` yet) is migrated into a CoCoder-style build through a
**world-class, multi-pass code review + audit** that authors its governance — never one cheap pass. The
audit deep-reads the repo, cross-checks itself, and drafts `cocoder/**` governance (memory, architecture
notes, candidate priorities, persona/standards deltas); the founder ratifies every Objective; a first
ordinary run then executes against ratified work. **Verified when:** a real external repo is taken over
end-to-end — scaffold → audited → founder ratifies the drafted Objectives → first run lands — with the
audit's findings traceable to repo reality (not hallucinated). Boundary: writes only the target's
`cocoder/**`; never product code; never the engine install. This is the **big lift** — expensive by
design (multi-agent, top-tier).

## The baked Playbook

| Phase | Det/Agentic · model | Founder gate | Output |
|---|---|---|---|
| **P0 · Scaffold** | deterministic — create-only `cocoder/` skeleton, non-destructive | — | the governance skeleton |
| **P1 · Recon** | light agent — map languages, packages/modules, build+test commands, entry points, dep graph, size; structured inventory | **▸ approve the map before the expensive read** | repo inventory artifact |
| **P2 · Parallel deep read** | **top-tier sub-agents, one per subsystem** (ADR-0018 sub-agents = play assignments) — each emits structured findings: architecture, conventions, domain, risks, tech debt | — | per-subsystem findings |
| **P3 · Adversarial cross-check** | agent reviewer over the findings — gaps, disagreements, hallucinated structure; optional founder-triggered Ultra | — | verified findings (+ flagged uncertainties) |
| **P4 · Synthesize** | agent — from *verified* findings draft `memory/` (codebase map, tech stack), architecture notes, candidate priorities with draft Objectives, persona deltas, standards extensions | — | drafted `cocoder/**` governance |
| **P5 · Ratify** | founder approves/edits **each** Objective (ADR-0010 rigor) — nothing runnable until ratified | **▸ hard gate** | ratified, launchable priorities |
| **P6 · Prove** | launch a first ordinary run against a ratified priority | — | a first successful run |

**Quality is mechanism, not vibes.** P2's fan-out (not one context window) + P3's cross-check are how the
"world-class" bar is met; the P1/P5 checkpoints protect spend and truth. The P2 read unit is the shared
`deep-read` audit Play (built with this template); a finding that cannot be traced to a file:line is
treated as unverified at P3. Never silently accept builder/agent confidence as fact (shared-standards).
