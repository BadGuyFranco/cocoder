# Onboarding Playbook Skeletons (frozen design history)

**Status: FROZEN — retired by [ADR-0032](../../decisions/0032-retire-playbooks-genre.md). The retired
loader no longer reads these files; they are retained only as design history.**

An **onboarding Playbook** was the sanctioned **baked-plan** design (ADR-0020 Decision 1): a multi-phase
plan authored + adversarially reviewed once, shipped with the living base (propagates to every install —
ADR-0012), and run many times. The existing-repo path now lives as an ordinary priority in the living
base: `packages/personas/base/priorities/onboard-existing.md`.

| File | Type | When |
|---|---|---|
| [`new-primary.md`](./new-primary.md) | **New Primary** | a fresh/empty primary root (little-to-no code) |
| [`drift-audit.md`](./drift-audit.md) | **Drift Audit** | an already-managed `cocoder/` root — propose-only |
| `packages/personas/base/priorities/onboard-existing.md` | **Onboard Existing** | an existing repo with code — the big-lift audit, now an ordinary priority |

Shared contract: write-scope = the target primary root's `cocoder/**` only; commits go
through the commit spine (ADR-0023) direct to the target's active branch; the founder ratifies every
drafted Objective; top-tier model pins ride ADR-0018 play assignments. See ADR-0020 for the full
decision set these onboarding flows enact.

The remaining skeletons fix the **phase structure, gates, scopes, and outputs**. The per-phase agent
prompts are refined at build time (and adversarially reviewed before first live use on a repo that
matters).
