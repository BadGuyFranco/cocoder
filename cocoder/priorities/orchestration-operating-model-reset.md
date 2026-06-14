---
id: orchestration-operating-model-reset
title: Reset CoCoder's orchestration operating model around durable founder-directed work
---

> **Founder-directed 2026-06-14.** Run this outside CoCoder's own run machinery, in a direct Claude Code
> session using Opus 4.8 as the lead model. Use Codex and Sonnet sub-agents as needed for independent
> code audit, implementation batches, adversarial review, and test writing. The current CoCoder
> orchestration machinery is part of what is being evaluated, so do not depend on a CoCoder run to make
> or land these changes.
>
> **In flight (2026-06-14).** Diagnosis evaluated and confirmed against the code; founder decisions taken
> (direct-to-branch by default, isolation opt-in, aggressive ADR supersede, `main` promoted to trunk).
> Target model is **[ADR-0023 — the workspace commit spine](../decisions/0023-workspace-commit-spine.md)**.
> Phase A (this stub + ADR-0023 + supersede 0015/0021/0022 + ARCHITECTURE/PLAYBOOK) landing; Phases
> B–E (core spine, daemon/Oz, persona prompts, live-git verification) owed.

## Objective

CoCoder's orchestration model is made first-class for a solo founder: founder-directed decisions,
priority/ADR/session-governance changes, documentation updates, orchestration repairs, and verified
small code fixes become durable commits on the managed repo's active branch through one clear,
auditable path. Per-run isolated worktrees remain available only where they genuinely help (risky or
large product implementation, parallel experiments, conflict-heavy work), not as the default path for
all code and governance.

The run must first **evaluate this diagnosis for itself** against the current code, ADRs, failure
catalog, PLAYBOOK, SESSION_LOG, and recent run branches. If the evidence disagrees with the framing
above, correct the framing before building. Ask the founder questions only for genuine product
judgments that cannot be answered by reading the repo; do not ask permission to fix mechanical
contradictions.

**Verified when:** a future CoCoder session can complete a normal founder conversation end-to-end and
leave no stranded state: post-wrap founder decisions, ADR amendments, priority edits, docs, session
handoffs, orchestration repairs, and verified implementation work all land on the active workspace
branch or are visibly held back with a concrete reason and recovery action. The founder receives a
plain receipt naming the branch, commit SHA(s), changed files, held-back files, verification evidence,
and the exact next runnable step. A fresh session launched afterward reads the updated reality without
manual git recovery.

## Required Scope

This is a cross-cutting architecture priority, not a prompt tweak. The run is authorized to edit any
CoCoder-owned surface needed to make the model real:

- `packages/core/**` runner, commit gate, run/store status, prompt generation, and tests.
- `packages/daemon/**` Oz actions, dashboard mutations, repair/governance commit paths, run landing and
  status projection.
- `packages/ui/**` only where founder-visible receipts, held-back state, or repair/commit controls must
  change.
- `packages/personas/base/**`, `cocoder/personas/**`, and Play prompts where persona behavior must match
  the implemented machinery.
- `cocoder/decisions/**`, `cocoder/priorities/**`, `cocoder/PLAYBOOK.md`,
  `cocoder/failure-catalog.md`, docs, templates, and tests.

If the audit shows the existing ADR set is now misleading, rewrite or supersede ADRs aggressively. A
full ADR reconciliation is in scope. Do not preserve obsolete decisions for continuity theater; preserve
them only as history, and make the live decision tree tell the truth.

## Operating Brief For The Direct Session

1. **Audit the current model before building.** Map every path that can create or modify tracked files:
   normal run atoms, Oscar support edits, wrap-up Play edits, Deb repair/tickets, Oz repair, daemon
   dashboard mutations, priority creation/reorder, workspace scaffold, post-wrap Q&A, stopped/failed
   runs, pending-landing resolution, and manual recovery paths. For each, record: working directory,
   branch, commit mechanism, scope gate, verification gate, founder-visible receipt, and how the next
   session reads the result.
2. **Decide the target architecture in plain English.** Recommended starting point: one shared
   workspace commit service is the default for low-risk founder-directed or agent-verified scoped
   changes; isolated run worktrees are an opt-in implementation sandbox. Validate or amend that model
   before implementing.
3. **Ask the founder only the real judgment calls.** Expected possible questions: how much direct commit
   authority to grant for managed repos by default; whether risky product code should still use
   isolation by default; how visible held-back changes should be in Oz; whether ADR history should be
   rewritten, superseded, or both.
4. **Implement the chosen model end to end.** Align source of truth, runtime emitters, persona prompts,
   daemon/UI status, run records, pickup briefs, tests, and docs. Delete or retire legacy paths that
   contradict the new model; do not leave parallel contracts.
5. **Verify with live-git evidence.** Tests must prove durable direct commits for governance/docs,
   post-wrap Q&A, daemon mutations, Oz repair, Deb/Oscar support edits, and normal implementation work.
   Tests must also prove held-back state is visible and recoverable. Include at least one fresh-session
   proof: make a decision/edit, commit it through CoCoder's machinery, then launch/read from a fresh
   context that sees the committed reality.

## Non-Negotiable Outcomes

- No founder-directed governance or orchestration edit may end as an uncommitted local diff in a run
  worktree.
- No successful wrap may claim completion unless the durable state is either committed or explicitly
  held back with a recovery path.
- No prompt may promise authority that the runtime cannot commit.
- No runtime/status surface may tell Oscar, Deb, Oz, or the founder that post-wrap Surface-A edits need
  a new run when the founder is asking for a scoped governance/orchestration/doc decision.
- No stale ADR, priority, ticket, PLAYBOOK entry, or failure-catalog row may continue to describe the
  retired orchestration model as live.
- A solo founder should not need to understand worktrees, run branches, pending-landing, repair paths, or
  manual git recovery to use CoCoder successfully.

## Boundary

This priority may rearchitect CoCoder orchestration and governance flow broadly. It must not add new
application features unrelated to orchestration reliability. It must not hide risk by disabling
verification; instead, verification should match the risk of the change. The end state should be simpler
for the founder even if the internal implementation changes substantially.
