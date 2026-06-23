---
id: 0036
title: Skills (Plays) Still appears in the oz dashboard
type: bug
status: Closed
priority: none
owner: founder-session
created: 2026-06-23
closed: 2026-06-23
---

# 0036 — Skills (Plays) Still appears in the oz dashboard

We have decided not to use "skills" as a thinkg in cobuilder - we decided to remove the term "Skills" in the left nav menu for this reason and just simply call that "Plays" - yet skills still appears

## Resolution

The live dashboard left nav is owned by `packages/ui/src/renderer/ui/Sidebar.tsx`, where the route label is `Plays`. `packages/ui/tests/app.test.tsx` now pins that visible nav and rejects the old `Skills` / `Skills (Plays)` labels.

The artifact leak was a stale compiled renderer bundle under `packages/ui/out/renderer/assets/`; rebuilding the UI cleaned that old hash, and the current generated `index.html` points at a bundle with no `Skills` / `Skills (Plays)` UI text. The remaining stale visible terminology in the historical design reference now says `Plays` / `No Plays bound` so it cannot keep reintroducing or confusing the retired label.
