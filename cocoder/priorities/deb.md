---
id: deb
title: Deb — orchestration/session debugger persona
---

## Objective
A "Deb" debugger persona launches visible beside Oscar and Bob (per-persona toggle in
`assignments.json`, default **on**), watches the live run, and on a fault triages it to exactly one
disposition: (1) **CoCoder issue** → offer a fix as a PR to the CoCoder repo for founder review;
(2) **repo-specific issue** → ask the founder whether to fix it in their repo (persona/tools/Plays
there); (3) **isolated, unlikely-to-repeat** → log it to `local` and fix only on a **second**
occurrence (then via 1 or 2). She may nudge Oscar when he stalls. **Verified** when Deb runs on a real
CoCoder run, catches a seeded fault, and produces the correct one of those three dispositions.
Boundary: Deb observes and *proposes/logs* — she never commits a fix unreviewed; her write-scope is
gated like any persona.

Deb is the automated continuous feedback loop for orchestration improvement — the dogfood instrument
the rebuild is organized around (D6 / Phase 3). Conflict context for the build run (not decided here):
how Deb observes Oscar's session (DB events vs pane vs artifacts), her gated write-scope, and how
"log → fix on 2nd occurrence" rides the operational store + the 3× learning-loop rule. Her oversight
overlaps [`full-oz-dashboard`](./full-oz-dashboard.md)'s run-oversight surface — build **one** debugger
(Deb = the active agent; Oz-oversight = the founder's view); reconcile at design time.
