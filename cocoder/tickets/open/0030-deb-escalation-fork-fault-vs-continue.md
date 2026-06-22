---
id: 0030
title: Deb escalation fork — formal fault (A) vs in-flight repair (B)
type: question
status: Open
priority: deb-follows-oscar
owner: founder
created: 2026-06-22
---

# 0030 — Deb escalation fork — formal fault (A) vs in-flight repair (B)

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
