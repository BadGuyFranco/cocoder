---
id: plays-documentation
title: Plays mechanism (ADR-0005) + documentation as the first Play
---

## Objective
ADR-0005's Plays registry is stood up — a **Play** = a delegatable procedure with a default prompt, a
default write-scope, and a per-(persona, Play) model assignment — and proven by a real `documentation`
Play that updates the docs affected by a change. **Verified** when a persona delegates the
`documentation` Play on a live run and the resulting doc edit commits within the Play's doc-only scope,
with the Play's model set independently of the delegating persona's. Boundary: the registry mechanism +
the single `documentation` Play; no other Play types are built here (they're earned later).

This implements the defined-but-unbuilt ADR-0005 ("sub-task" renamed **Play** per ADR-0010) and is the
foundation the deferred [`quinn-app-testing`](./backlog/quinn-app-testing.md) and
[`deployment-plays`](./backlog/deployment-plays.md) priorities both depend on. `documentation` is
read-mostly with a doc-paths-only default scope (ADR-0007).
