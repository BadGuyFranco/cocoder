---
id: 0055
title: Deb-repair authors, self-commits, and closes tickets outside the runner's deterministic sequence (D1)
type: bug
status: Closed
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

## Progress (2026-06-25, loop-down operator session)

Most of the reframed acceptance landed (see [ADR-0041](../../decisions/0041-orchestration-ownership-and-actor-authority.md) §7). Kept **open** for the one residual item below.

- **Done — interference check (A):** pure `interferes(changeSet)` rail in core (`a2cab84`), conservative
  per the §3.1 founder decision (any non-`.md` change interferes; default-when-unsure → interfering).
- **Done — `.md`-only self-fix through the governed spine, never raw git (B+C):** the ADR-0036 applied /
  directed-apply path now gates on the rail and commits only non-interfering `.md` self-fixes via
  `commitFiles` + the shared governance author (`75a9cb5`); `deb.md` aligned (`4a5b52a`).
- **Done — interfering changes not made live:** held for the founder (`held-for-founder`, surfaced via the
  `interfering-held` event + `outOfLanePaths`); never an autonomous commit, even under Oscar direction.
- **Done — ADR-0036 reshape + run_234 regression:** runner-touching fix classified interfering at both the
  predicate and daemon-path levels; HEAD unchanged; every Deb commit rides a governed ledger.
- **Done — reconciliation close (E):** guarded against active-run targets, through the governed
  `closeTicket` spine (`538eed4`).
- **Residual (why this stays open):** a dedicated run-end **founder-suggestion artifact** presenting the
  explicit *file-a-ticket | approve* options, plus the **on-approval governed-commit** flow. Today an
  interfering change is held + surfaced and the founder disposes via existing ticket/run paths; the
  one-button approve→commit needs a small ADR-0036 dialogue state-machine transition.

## Resolution

Resolved by run cli-close-ticket (no code change) on 2026-06-25.

Overseer build (ADR-0041 §3) complete: interference rail, governed .md self-fix, run-wrap audit, reconciliation close, and now the run-end founder-suggestion artifact (FounderEscalation-shaped, explicit file-a-ticket | approve) for held interfering Deb fixes on both the applied and directed-applied paths. Per the §3.2 'approve' decision (option B), approve routes to the existing ticket/run path — Deb never commits interfering code herself, no new commit op; the held diff is captured (quarantined) and the tree reverted to HEAD. run_234 pinned at predicate + daemon-path levels. Delivered in commits ffb750d (+ docs 027b61b).
