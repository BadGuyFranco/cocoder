---
id: 0056
title: No mutual exclusion — the same ticket can be in the build lane and the Deb-repair lane concurrently (D2)
type: bug
status: Open
priority: none
owner: deb
created: 2026-06-24
---

# 0056 — No mutual exclusion between build lane and Deb-repair lane (D2)

## Context

Defect **D2** from [ADR-0041](../../decisions/0041-orchestration-ownership-and-actor-authority.md).
In run_234 the runner held ticket 0054 in the build lane (Oscar→Bob→verify; `delegation`@20:32:49) while
Deb processed the *same* 0054 in the repair lane and landed the fix mid-run (`549ab11`@20:37:05). Bob's atom
was redundant (`verify-rejected`@20:39:54: "fix … already landed on main"); nothing collided only because
the two touched disjoint files. The ADR-0036 in-daemon dialogue has an idle guard
(refuses while `sourceRun.status === 'running'`), but a Deb persona acting in its own agentic session
bypasses it, and detect-don't-prevent never blocks its raw commit.

## Acceptance

- A ticket dispatched to the build lane (an active run targeting it) cannot simultaneously be admitted to the
  Deb-repair lane — build XOR repair, enforced in code, not prompt.
- Attempting to open the repair lane for a ticket with a live run is refused with a named error (or queued
  until teardown), never run concurrently.
- A regression test pins the run_234 case: repair admission for 0054 is refused while run_234 is `running`.

## Notes

- Evidence: run_234 `delegation`@20:32:49 vs `549ab11`@20:37:05; `verify-rejected` reason; ADR-0041 §2.
- Low-risk guardrail (ADR-0041 §3 R2) — closed by the guardrail built in this session.
- Related: [0055](./0055-deb-repair-commits-and-closes-outside-runner-sequence.md) (D1, the redesign that
  fully subordinates the repair lane).
