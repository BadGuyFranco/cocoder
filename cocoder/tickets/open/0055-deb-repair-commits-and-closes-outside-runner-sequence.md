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

**Reframed 2026-06-25 (founder input — see [ADR-0041](../../decisions/0041-orchestration-ownership-and-actor-authority.md) §3):**
the original direction ("subordinate Deb-repair to the runner") is **retired** — Deb must stay
runner-independent (she diagnoses the runner; subordinating her deadlocks when it's broken). Deb is an
**always-on run overseer**, not a ticket owner or repair worker. The fix is the **overseer model bounded by
an interference check**, not subordination. Gated behind founder approval of ADR-0041 §3. Do not implement
before that.

## Acceptance (overseer model, ADR-0041 §3)

- **Interference check** (file-domain rail): a Deb change that touches the **runner** or the **active run's
  target code files** interferes; an **`.md`/instruction** edit does not (default-when-unsure → interfering).
  Enforced in code, independent of Deb's "minor?" judgment.
- Deb's **direct self-fix** is limited to non-interfering `.md`/instruction edits and commits **through the
  governed spine** (`commitFiles`/gate, in the ledger) — never a raw `git commit`.
- **Interfering** changes are **not** made live: Deb surfaces a run-end suggestion; the founder decides
  *file a ticket* or *approve*; on approval Deb commits through the normal governed process.
- The ADR-0036 Deb-repair path is reshaped to observe / nudge / non-interfering self-fix / run-end founder
  suggestion — no autonomous authoring+commit+close of interfering changes.
- A regression test pins run_234: a runner-touching fix is classified interfering and cannot land as an
  autonomous mid-run Deb commit; any Deb commit appears in a governed ledger.

## Notes

- Evidence: `549ab11`, `bd5fdf5`, `cocoder/runs/90-run_234/commits.jsonl`, ADR-0041 §2-§3.
- Companion: [0058](./0058-detect-dont-prevent-self-commits-root-enabler.md) (D4) — detection stays; add the
  run-wrap audit assertion as the raw-shell backstop.
- Related: ADR-0016 (Deb advises, runner delivers), ADR-0036 (Oscar↔Deb dialogue — to be reshaped),
  ADR-0040 (oz-action lane). Reference model: CoBuilder "Debugger".
