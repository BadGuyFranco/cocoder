---
id: priority-architecture-contract
title: "Priority Architecture Contract — governing-architecture gate before launch (deferred: founder Objective + ADR pass owed)"
---

## Objective
*(Founder-owned — draft and approve before any code.)* Every launchable priority must carry an explicit,
machine-checkable **Governing Architecture** section that the runner validates before starting a run —
refusing launch with a clear error when the contract is missing or stale. **Verified** when: (1) a
priority without a valid contract cannot launch; (2) a priority with a valid contract launches normally;
(3) the contract loader, runner gate, and orchestrator prompts agree on the same schema; (4) no existing
active priority is bricked by a partial rollout. Boundary: the launch-refusal gate and governing-section
parser only — not redefining priority authoring taxonomy (ADR-0010) or Oz drag-reorder.

**Blocked on founder approval:** a verifiable Objective (this stub is a placeholder), an ADR-conflict
pass (governing / superseded / conflicts / gaps / invariants), and resolution of the contested ADR-0017
number (two ADR trees; a prior deleted rebuild-0017). **Do not implement inside another priority's run**
— run_45 showed a builder can slip this into `packages/core` when commit scope is run-level `packages/**`.

**Origin:** founder chat proposal surfaced twice during run_45 (`full-oz-dashboard`); Oscar reverted the
unreviewed implementation (`4b7a4e6`). Promote out of `backlog/` only after Objective + ADR pass land.
