---
id: 0053
title: commit-support spine sweeps out-of-lane files instead of withholding
type: bug
status: Closed
priority: orchestration-e2e-test
owner: deb
created: 2026-06-24
---

# 0053 — commit-support spine sweeps out-of-lane files instead of withholding

## Context

Logged as issue #3 in ticket [0051](./0051-orchestration-e2e-test-live-issue-log.md) from run_232 /
workspace run 88. While logging issue #2 via `cocoder oz commit-support`, the spine committed
pre-existing unrelated UI work (`packages/ui/src/renderer/sections/dashboard/Priorities.tsx` +
`tests/priorities-panel-active.test.tsx`) into Oscar's post-wrap support commit `8164afe`, marking it
"out of lane, flagged not withheld". Surface-B product code bypassed the verify gate and was mislabeled
under an `oscar-post-wrap: orchestration-e2e-test` message. High severity — luck that the swept change
was complete and tests passed; the gate contract was violated.

Control-plane repair must run only after live orchestration has torn down (0051 Safety rule; ADR-0036).

## Acceptance

- `cocoder oz commit-support <runId>` and the daemon support-commit path **withhold** out-of-lane
  pending files per the shared-standard held-back contract; they surface for founder expand/discard — never
  flag-and-commit past the verify gate.
- In-scope Surface-A governance edits still commit cleanly with a run-linked receipt.
- Tests pin the run_88 case: pre-existing out-of-lane UI files stay unstaged/uncommitted and appear in
  the held-back / out-of-lane surface for founder decision.
- Repair lands through ADR-0016 Deb machinery repair in a non-orchestrated session (or equivalent
  post-teardown ticket-fix), not from inside a live run using the spine being repaired.

## Notes

- Evidence: ticket 0051 issue #3; commit `8164afe` from run_232 post-wrap logging.
- Related: ticket [0008](../closed/0008-post-wrap-founder-interaction-contract.md) (support-commit
  contract); ADR-0023 workspace commit spine.

## Resolution

Resolved by run session-16 (non-orchestrated) (526178c82df9a24661082578720dd38f6fb84a07) on 2026-06-24.

Post-wrap support commit (requestSupportCommitRun -> runCommitGate) now passes commitOnlyScope:true: in-lane Surface-A edits commit with a run-linked receipt, out-of-lane files are WITHHELD (surfaced, not swept past the verify gate). oz-chat support-commit reply states held-back accurately; unused parseFrontmatter import removed. mutations.test.ts updated to the held-back contract + a run_88 regression pinning concurrent packages/ui edits as withheld. core 582 / daemon 347 green.
