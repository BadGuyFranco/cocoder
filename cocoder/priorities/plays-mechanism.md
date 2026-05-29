---
id: plays-mechanism
title: Plays mechanism (ADR-0005) — proven by extracting wrap-up as the first Play
---

## Objective
ADR-0005's Plays registry is stood up — a **Play** = a delegatable procedure with a default prompt, a
default write-scope, and a per-(persona, Play) model assignment — and proven by extracting **wrap-up**
(Oscar's existing inline closeout procedure) into the **first Play**, run on a cheaper model via the
per-(persona, Play) assignment. **Verified** when Oscar delegates the wrap-up Play on a real run, it
executes on its assigned (cheaper) model, and produces the closeout (pickup brief / docs / commit /
report) within the Play's scope. Boundary: the registry mechanism + wrap-up as the proof Play;
`documentation` is the named fast-follow Play, not built here.

Wrap-up is the natural first Play — it is a battle-tested procedure (runs every closeout, defined inline
in `../personas/oscar.md` today) and the literal cheap-model tiering case the Plays mechanism exists to
enable (ADR-0010 / ADR-0005). Extracting it proves the mechanism end to end; `documentation` and other
Plays then become cheap governance adds (ADR-0009). This is the foundation the deferred
[`quinn-app-testing`](./backlog/quinn-app-testing.md) and [`deployment-plays`](./backlog/deployment-plays.md)
priorities both depend on.
