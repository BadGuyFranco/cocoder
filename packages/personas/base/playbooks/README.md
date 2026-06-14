# Onboarding Playbooks (shipped, baked-plan) — DRAFT

**Status: DRAFT — pending [ADR-0020](../../../../cocoder/decisions/0020-primary-root-audit.md) acceptance
+ build. These files are INERT until the priority loader reads this directory (ADR-0020 Decision 7).**

An **onboarding Playbook** is the one sanctioned **baked-plan** Playbook (ADR-0020 Decision 1): a
multi-phase plan authored + adversarially reviewed once, shipped with the living base (propagates to
every install — ADR-0012), and run many times. It is NOT a one-off priority (ADR-0010: improvised plan,
stub file) and NOT a single Play (ADR-0005: one delegatable task) — a Playbook **orchestrates** Plays +
atoms across phases, with founder checkpoints and ratification gates.

| File | Type | When |
|---|---|---|
| [`new-primary.md`](./new-primary.md) | **New Primary** | a fresh/empty primary root (little-to-no code) |
| [`cocoder-takeover.md`](./cocoder-takeover.md) | **CoCoder Takeover** | an existing repo with code — the big-lift audit |
| [`drift-audit.md`](./drift-audit.md) | **Drift Audit** | an already-managed `cocoder/` root — propose-only |

Shared contract (all three): write-scope = the target primary root's `cocoder/**` only; commits go
through the commit spine (ADR-0023) direct to the target's active branch; the founder ratifies every
drafted Objective; top-tier model pins ride ADR-0018 play assignments. See ADR-0020 for the full
decision set each Playbook enacts.

These skeletons fix the **phase structure, gates, scopes, and outputs**. The per-phase agent prompts are
refined at build time (and adversarially reviewed before first live use on a repo that matters).
