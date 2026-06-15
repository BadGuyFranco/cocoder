---
id: play-dispatch-boundary
title: Play dispatch boundary ADR — multi-bindings and dynamic sub-delegation
---

> **Spawned from [plays-first-class](./plays-first-class.md) (2026-06-15, run_88)** — the catalog +
> binding + permission-surfacing slice shipped; this is the explicitly deferred engine/schema boundary.
> **Decision before code** — nothing in `packages/core/src/plays/dispatch.ts` changes until the ADR is
> Accepted.

## Objective

Draft and founder-accept **ADR-0024** (working title: Play dispatch boundary) deciding:

1. **Adversarial multi-bindings** — the same Play id bound on different personas with different
   cli+model assignments (today: one `persona.plays[id]` entry per persona; dispatch is one-level, no
   further delegation in `packages/core/src/plays/dispatch.ts`).
2. **Dynamic per-persona sub-delegation** — a default Play/skill that applies to any sub-agent task for
   that persona (beyond explicit per-Play assignments).

**Verified when:** ADR-0024 is Accepted with explicit in/out scope, schema implications for
`PlayAssignment` / persona config, and a clear build-or-defer verdict for each clause. **Boundary:** no
implementation in this priority — ADR authorship + conflict audit only. Build atoms that follow require
a separate launch after acceptance.
