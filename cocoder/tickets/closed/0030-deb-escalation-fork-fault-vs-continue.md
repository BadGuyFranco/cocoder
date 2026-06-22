---
id: 0030
title: Deb escalation fork — formal fault (A) vs in-flight repair (B)
type: question
status: Closed
priority: deb-follows-oscar
owner: founder
created: 2026-06-22
closed: 2026-06-22
---

# 0030 — Deb escalation fork — formal fault (A) vs in-flight repair (B)

## Resolution (founder, 2026-06-22)

Neither A nor B — the framing was wrong. The founder specified a third model: Oscar hits an orchestration
issue and tasks Deb to research and **propose** a fix; Deb either applies an easy in-scope fix or hands the
proposed fix back to **Oscar to evaluate**, and Oscar directs it. It is **Oscar↔Deb only (never Bob)**, can
fire **any time including after Oscar has wrapped**, and escalates to the **founder** for genuinely risky
items. It is the existing manual self-improvement pattern made autonomous — not a within-run watcher event.

**Decision: split.** Because it is Bob-free and fires after wrap, it cannot live inside `runRun` (the
watcher's home) and is a different capability (daemon-resident, propose→evaluate→direct handshake, founder
tier). So:
- `deb-follows-oscar` is narrowed to the **watcher + Oscar-only nudge** half (Objective amended; the green
  run_184 watcher diff re-lands there with the `deb-investigate`/fault path stripped).
- The **Oscar↔Deb autonomous repair loop** moves to a new priority `deb-oscar-repair-loop` governed by
  `ADR-0036` (extends ADR-0016 / ADR-0013).

This closes the question; the two follow-on priorities carry the work.

## Context

Run_184 (`deb-follows-oscar`) built a full Deb tier-2 watcher plus Oscar-requested escalation. Core
suite is green (465 passing, incl. new Deb-watcher and Oz/Deb nudge-ordering tests), but landing is
blocked because the Objective is internally tense: "to continue or clarify" after Deb repair points at
in-flight resume (Option B), while "does not create a second orchestration lane" and "does not rescue a
formally failed run" point at formal fault + relaunch (Option A).

**Option A (as built, recommended):** Oscar writes `{"kind":"deb-investigate","blocker":"…"}`; the
runner routes it through the existing fault/triage/repair owner — the run formally fails, Deb diagnoses
and repairs CoCoder-owned machinery, founder relaunchs unblocked. Reuses single triage/repair lane;
lowest new machinery.

**Option B:** Deb diagnoses/repairs machinery and Oscar continues the same run. Matches "continue"
wording but needs a non-fault escalate+resume path — risks a second orchestration lane and "rescuing"
a blocked run.

Watcher/nudge halves (atoms 0, 2, 3) are ready and need no rework once the fork is decided.

## Acceptance

Founder picks A or B and reconciles the `deb-follows-oscar` Objective wording. On **A:** relaunch
`deb-follows-oscar` to land the green implementation as one verified atom. On **B:** amend the Objective
to authorize continue-after-repair, then relaunch with a design slice before implementation.

## Notes

- Run: run_184 (display 41). Oscar recommendation: **Option A**; soften Objective "to continue" to
  "so the founder can relaunch unblocked" if A is chosen.
- Reply in run_184 with **A** or **B** to unblock.
