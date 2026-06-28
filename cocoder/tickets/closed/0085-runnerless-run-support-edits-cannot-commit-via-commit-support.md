---
id: 0085
title: Post-wrap support edits in runnerless/independent runs cannot commit — cocoder oz commit-support 404s (unknown run), tickets strand
type: bug
priority: ticketing-paths-hardening
binding-reason: Resolving the runnerless commit-support 404 strand advances this priority objective (one governed commit path that always works).
owner: founder-session
created: 2026-06-28
status: Closed
---

# 0085 — Support edits in independent runs strand uncommitted (commit-support 404 unknown run)

## Context

Surfaced in run_279 (CoCoder run 137), an **independent / runnerless** destructive run launched via
`cocoder run-independent` (`independent-of-runner: true`). After wrap-up, Oscar made in-scope Surface-A
support edits (tickets 0083, 0084 under `cocoder/tickets/**`) and ran the prescribed post-wrap commit
command:

```
pnpm … exec cocoder oz commit-support run_279
→ cocoder: support commit failed (404): {"error":"unknown run"}
```

`commit-support` routes to the **daemon**, but an independent run is not in the daemon's run store, so
the daemon rejects it as an unknown run. Result: the support edits could not be committed by the only
prescribed affordance and **stranded uncommitted on the working tree** — the founder had to intervene and
ask for a manual commit.

This is the recurring "support edits must commit immediately or they strand" failure class (cf. the
run_53/run_74 strand the post-wrap-commit rule was meant to retire). Both the run prompt's
*Oscar support edits and wrap commits* section **and** the `WRAP-UP READY` delivery instruct Oscar to run
`cocoder oz commit-support <runId>` — which is simply wrong for an independent run, with no fallback
named.

## Impact

In any independent/runnerless run, every post-wrap governance/doc/ticket edit Oscar makes silently fails
to commit through the documented path. Tickets, failure-catalog entries, and priority updates strand
until a human notices — exactly the invisible-loss mode the immediate-commit rule exists to prevent.

## Acceptance

Post-wrap support edits in an independent run have a **working, immediate** commit path, via one owner of
the fix:

- `commit-support` (or an equivalent independent-harness affordance) resolves independent run ids and
  commits their in-scope support files with a receipt — **or**
- the run prompt + `WRAP-UP READY` delivery for independent runs prescribe the correct affordance instead
  of the daemon `commit-support` command.

A support edit must never strand uncommitted on the working tree. Add a regression check that an
independent run's post-wrap in-scope support edit commits (or that the prescribed command for that run
type succeeds). Cross-link 0083 (the wrap-up should not emit broken/founder-executed commands).

## Resolution

Closed by reconciliation queued-authoring on 2026-06-28.

Resolved by run_138: cocoder oz commit-support now succeeds for runnerless/independent runs through one governed commit path (no 404, no strand). Closed via run_281's fresh-HEAD daemon (bootSha 4e6a5de) exercising the atomic, status-less-robust closeTicket: status-less source got status: Closed inserted, file moved to closed/, order.json pruned, INDEX row moved to Recently Closed, committed.
