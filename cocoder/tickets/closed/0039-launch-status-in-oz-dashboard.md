---
id: 0039
title: Launch Status in Oz Dashboard
type: task
status: Closed
priority: none
owner: founder-session
created: 2026-06-23
---

# 0039 — Launch Status in Oz Dashboard

When launching a priority or ticket there is a ~6 second delay before the cmux session launches.

## Original diagnostic tasks
a. If there's a built-in delay, why is it there?
b. If there's a genuine issue with launch, understand and fix it.
c. If the delay is needed due to the launch process, surface a status modal while launch is happening.

## Updated UX requirement (2026-06-24)

A launch status modal was implemented with Oscar/Bob/Deb progress bars. This is **not working well**:
- The progress bars are near-static — they load all at once at the end rather than showing real-time progress
- The bars do not reflect where actual time is being spent
- The pause still feels unexplained to the user

**New direction:** Replace the Oscar/Bob/Deb progress bar UI with a simple spinning progress wheel (no per-agent bars). If real timing data is available, show a one-line status label describing the current launch phase. Otherwise a plain spinner is preferable to the static multi-bar display.

**Acceptance criteria:**
- Launch modal shows a spinner for the duration of the delay
- No static progress bars that give false impression of activity
- Modal closes when launch is confirmed successful
- Optionally: a short status line (e.g. "Starting workspace…") if phase information is cheaply available

## Resolution

Resolved by run run_239 (7bb83ffde2578424e5c58e6751948bdb82d7a303) on 2026-06-25.

Ticket fix run completed successfully. Replaced per-agent progress bars with a single spinner and optional phase label per the 2026-06-24 direction. Original diagnostic tasks a/b were descoped by that direction; file a new ticket if launch-delay root-cause is still desired.
