---
id: 0058
title: Detect-don't-prevent self-commits is the root enabler of out-of-spine agent action (D4)
type: bug
status: Open
priority: none
owner: deb
created: 2026-06-24
---

# 0058 — Detect-don't-prevent self-commits, the root enabler (D4)

## Context

Defect **D4** from [ADR-0041](../../decisions/0041-orchestration-ownership-and-actor-authority.md).
The commit gate computes `selfCommitted = headNow !== headBefore`
(`packages/core/src/commit-gate/gate.ts:60-61`) and, when true, records an `agent-self-commit` event but
**does not throw** (`gate.ts:62-63`); the default committable set is commit-all
(`commitOnlyScope ? inScope : changed`, `gate.ts:75-76`). A raw `git commit` outside any gate isn't
intercepted at all. This posture — chosen deliberately in F21 / ticket 0018 / ADR-0023 — is what lets an
agent act **beside** the spine (D1) rather than **through** it; D1–D3 are downstream of it.

**This is the crux and a founder decision (ADR-0041 §4/§5 R5), not a guardrail.** Deciding to *prevent*
(pre-commit hook / sandboxed identity / gate-held HEAD-lock) reverses a deliberate decision and risks
friction for legitimate human/founder commits. Do not flip detection→prevention without explicit founder
sign-off. The recommended interim mitigation (ADR-0041 §4) is to keep detection and add a run-wrap audit
assertion that fails the run if HEAD moved via a non-run commit during the run, escalating to prevention
only if a post-R4 dogfood still shows bypasses.

## Acceptance

- A founder decision is recorded (in this ticket or a follow-up ADR) on keep-detection vs add-prevention.
- If detection is kept: a run-wrap audit assertion fails the run when HEAD advanced via a commit absent from
  the run's `commits.jsonl` during the run window; test pins the run_234 bypass.
- If prevention is chosen: the mechanism (hook / identity / HEAD-lock) rejects any commit not carrying the
  current run/lane fingerprint, with a clean carve-out for legitimate founder commits; F21/0018/0023 receive
  carry-forward amendment pointers.

## Notes

- Evidence: `gate.ts:60-63,75-76,96`; `549ab11`/`bd5fdf5` never entering run_234's gate event stream; ADR-0041 §4.
- Gates the implementation of [0055](./0055-deb-repair-commits-and-closes-outside-runner-sequence.md) (D1).
- Related: F21, ticket 0018 (gate-bypass guard deliberately not enforced), ADR-0023 (scope advisory).
