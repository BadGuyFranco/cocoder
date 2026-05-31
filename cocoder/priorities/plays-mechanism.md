---
id: plays-mechanism
title: Plays mechanism (ADR-0005) — proven by extracting wrap-up as the first Play
---

## Objective
ADR-0005's Plays registry is stood up — a **Play** = a delegatable procedure with a default prompt, a
default write-scope, and a per-(persona, Play) model assignment — and proven by making **wrap-up** the
**first Play**, run on a cheaper model via the per-(persona, Play) assignment. **Verified** when Oscar
delegates the wrap-up Play on a real run, it executes on its assigned (cheaper) model, and produces the
closeout (pickup brief / docs / commit / founder report) within the Play's scope. Boundary: the registry
mechanism + wrap-up as the proof Play; `documentation` is the named fast-follow Play, not built here.

Wrap-up is the natural first Play — the literal cheap-model tiering case the Plays mechanism exists to
enable (F9 / ADR-0010 / ADR-0005). **Framing note (refreshed):** the multi-atom loop (ADR-0013, now built)
already decides and triggers *when* Oscar wraps up — he emits a wrap-up directive and a pickup brief. So
this Play extracts the wrap-up **procedure itself** (pickup brief / docs / commit / report) that Oscar runs
at that trigger onto a cheaper assigned model — it is no longer "extract the old inline closeout from
`../personas/oscar.md`" (the loop already superseded that). Extracting it proves the mechanism end to end;
`documentation` and other Plays then become cheap governance adds (ADR-0009). This is the foundation the
deferred [`quinn-app-testing`](./backlog/quinn-app-testing.md) and
[`deployment-plays`](./backlog/deployment-plays.md) priorities both depend on.

## Status

**Live proof landed in run_29.** Oscar delegated the wrap-up Play on its per-(persona, Play) assignment
(`oscar` → `wrap-up` → `cursor-agent`, per `cocoder/personas/assignments.json`); it ran headless as a
captured subprocess to completion (e8b9848 fix for the run_28 cmux hang), authored this closeout within
the Play's writeScope, and the runner committed the in-scope edit. The `documentation` fast-follow Play
remains named but not built here.
