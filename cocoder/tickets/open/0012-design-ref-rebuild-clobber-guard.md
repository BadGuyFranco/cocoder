---
id: 0012
title: Guard against design-ref rebuilds reverting committed packages/ui/app fixes
type: task
status: Open
priority: oz-dashboard-bugs
owner: oscar run_94
created: 2026-06-15
---

# 0012 — design-ref rebuild-clobber guard

## Context
Found in run_94 (failure-catalog **F21**). Six Oz dashboard bug fixes were committed 2026-06-14, but a
later wholesale *"rebuild the renderer against the V1 design (Fusion)"* commit (`2ccff89`) regenerated
`packages/ui/app` from the frozen `packages/ui/design-ref/` snapshot — which never held those fixes —
silently reverting #2/#5/#7/#8. run_94 spent two atoms re-fixing them. The risk is **still live**:
`design-ref/` still contains the old `claude-code` CLI id (and the pre-relabel/pre-order text), so
run_94's #11 `claude` rename and the "Skills (Plays)" relabels will be re-clobbered the next time anyone
regenerates `packages/ui/app` from `design-ref/`.

Root cause (F1/F4 single-source class, generated-vs-source flavour): `design-ref/` is treated as a live
regeneration source of truth, but hand-applied fixes to the generated tree are never folded back into
it, so any regenerate-from-design-ref clobbers them.

## Ask
Pick ONE direction of truth and enforce it:
- **Option A (retire design-ref as a live source):** mark `design-ref/` as a one-time historical
  reference (it has served its purpose; `packages/ui/app` is now the maintained tree). Add a guard/CI
  check that fails if a change regenerates `packages/ui/app` wholesale from `design-ref/` in a way that
  reverts committed app behavior (e.g. a diff-gate flagging mass reversions, or a lint banning bulk
  copy-from-design-ref). Lowest-risk; matches reality.
- **Option B (fold fixes back):** make `design-ref/` the true source and re-derive `packages/ui/app`
  from it — requires porting every committed app fix (incl. run_94's) back into `design-ref/` and a
  build step. Higher cost; only worth it if design-ref regeneration is still a deliberate workflow.

Recommendation: **Option A** — the app has diverged enough that design-ref is no longer a faithful
source; a guard + a "design-ref is historical" note is cheaper and prevents recurrence.

## Boundary
Tooling/governance + a possible `packages/ui` note. Does not change shipped dashboard behavior.
Founder decides A vs B (architecture call).
