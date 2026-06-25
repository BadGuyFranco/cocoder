---
id: 0055
title: Deb-repair authors, self-commits, and closes tickets outside the runner's deterministic sequence (D1)
type: bug
status: Open
priority: none
owner: deb
created: 2026-06-24
---

# 0055 — Deb-repair acts outside the runner's deterministic sequence (D1)

## Context

Defect **D1** from [ADR-0041](../../decisions/0041-orchestration-ownership-and-actor-authority.md).
In run_234 (ticket-fix-0054) Deb authored the entire fix and committed it (`549ab11`, hand-written message
`fix(runner): refresh terminal Deb status after watcher stop` — neither the runner's
`ticket-fix-NNNN: atom N` format nor the `deb-repair` spine label) and closed the ticket (`bd5fdf5`, message
`governance: close ticket 0054` **missing** the `via run <id>` suffix that
`closeTicketAfterSuccessfulRun` stamps — `packages/daemon/src/launcher.ts:476`). **Neither commit appears in
`cocoder/runs/90-run_234/commits.jsonl`** (which records only `76652aa` + `f304c4c`): the run's substantive
change happened *beside* the spine, invisible to its own ledger. A second, non-deterministic owner raced the
first.

This is the deep redesign half — it reverses the current Deb-repair authors+commits+closes path
(ADR-0016/0036) and is **gated behind founder approval of ADR-0041 §3 R4**. Do not implement before that.

## Acceptance

- Deb *proposes* a repair; the runner (or the daemon on its behalf) sequences, gates, and commits it with
  the run fingerprint (`… via CoCoder <runRef>` / `… via run <runId>`), and the commit is recorded in the
  run's `commits.jsonl`. No direct Deb `git commit` for a run's own target.
- A Deb-authored close of a run's target routes through `closeTicketAfterSuccessfulRun` (or carries the
  `via run <id>` fingerprint), never a raw hand-close.
- A regression test pins the run_234 case: a repair for a ticket under an active run cannot land a commit
  absent from that run's ledger.

## Notes

- Evidence: `549ab11`, `bd5fdf5`, `cocoder/runs/90-run_234/commits.jsonl`, ADR-0041 §2.
- Depends on the founder decision in [0058](./0058-detect-dont-prevent-self-commits-root-enabler.md) (D4):
  whether subordination alone holds, or prevention is required.
- Related: ADR-0016 (Deb advises, runner delivers), ADR-0036 (Oscar↔Deb dialogue), ADR-0040 (oz-action lane).
