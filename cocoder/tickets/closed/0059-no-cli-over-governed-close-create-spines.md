---
id: 0059
title: No CLI over the governed closeTicket / create-priority spines forces ad-hoc tsx (D5)
type: bug
status: Closed
priority: none
owner: deb
created: 2026-06-24
---

# 0059 — No CLI over the governed close/create spines (D5)

## Context

Defect **D5** from [ADR-0041](../../decisions/0041-orchestration-ownership-and-actor-authority.md).
The governed `closeTicket()` (`packages/core/src/tickets/close.ts:79`) and the create-priority/authoring
spines have **no CLI wrapper**, forcing ad-hoc `tsx` invocations from a non-run session. Deb's `tsx -e`
close failed on top-level await (a `.mts` *file* works). The friction of "to do it right you must
hand-author a script" is precisely what nudges an agent toward a raw `git commit` / hand-close — so D5
materially feeds D1.

## Acceptance

- `cocoder oz close-ticket <id>` closes a ticket through the existing governed `closeTicket` spine (files +
  INDEX + order.json + governed commit), no ad-hoc `tsx`.
- A create-priority CLI wrapper covers the governed create-priority spine equivalently.
- A CLI test pins both: invocation produces the same governed file moves + commit as the spine, and refuses
  loudly on a missing/closed ticket rather than half-acting.

## Notes

- Evidence: the session-brief account of Deb's `tsx -e` top-level-await failure; `bd5fdf5` hand-message vs
  the `launcher.ts:476` spine message; ADR-0041 §2 D5.
- Low-risk ergonomics guardrail (ADR-0041 §3 R3) — closed by the CLI built in this session.
- Related: ADR-0040 (oz-action reversible-edit lane that this CLI surfaces).

## Resolution

Resolved by run cli-close-ticket (no code change) on 2026-06-25.

Shipped cocoder oz close-ticket (governed closeTicket + commitFiles) and cocoder oz create-priority over the existing authoring spine; close-ticket refuses while a daemon is live (loop-down control-plane op). Tests-first: close-ticket.test.ts pins the governed file moves + commit, oz-args.test.ts pins the invocation mapping. Commit 369a518.
