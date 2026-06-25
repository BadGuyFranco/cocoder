---
id: orchestration-e2e-test
title: End-to-end orchestration self-test (live Oscar/Bob/Deb loop)
scopeNarrowing:
  - cocoder/audit/orchestration-e2e/**
---

## Objective

Exercise the **full CoCoder runner loop on live infrastructure** after the runner-decoupling refactor —
directive → builder dispatch → monitor → verify gate → per-atom commit → wrap-up — and prove it turns over
cleanly end to end. This priority is **self-aware**: it exists to be the orchestration's own smoke test.
Oscar, you are running the system that is being tested; narrate the loop you observe and surface anything
that misbehaves.

**The bounded work (one atom, fully reversible, scope-narrowed):** delegate to the builder a single atom
that authors `cocoder/audit/orchestration-e2e/e2e-evidence.md` containing, in this order: an `# E2E
evidence` heading; a `- Priority:` line naming `orchestration-e2e-test`; and a `## Loop stages observed`
checklist with one line per stage actually exercised (directive issued, builder dispatched, monitor saw
the completion marker, verify verdict, commit). Then VERIFY by reading the actual file against that spec
(the verify gate must pass on the real diff, not the builder's word), let the runner commit it, and WRAP
UP with a pickup that states plainly whether the loop completed cleanly and lists any anomaly.

**Verified when** a single run completes one full directive→dispatch→monitor→verify→commit→wrap-up cycle,
the evidence file is committed under the sandbox, and the run record + deb-status feed reflect a clean
terminal status (completed). A run that faults is still a *useful* test result — it found a real defect;
record it (see below) rather than papering over it.

**Boundary — keep this safe to run repeatedly:** the builder writes ONLY under
`cocoder/audit/orchestration-e2e/**` (enforced by this priority's scope narrowing); the evidence file is
disposable and may be overwritten by later runs. Do NOT touch the control plane (the runner, monitor,
commit-gate, personas, Plays) from this run — that is product/governance code outside this test's lane and
its repair belongs to a separate non-orchestrated session, never to the live run that is exercising it.

## Logging what the test finds

Every orchestration anomaly observed during a run of this priority — a false builder-blocker, a stall the
monitor missed or over-nudged, a commit that swept the wrong files, a status-feed / run-record / portable-
history disagreement, a dead "waiting for WRAP-UP READY" after a terminal fault, a Deb mis-triage — is a
**finding of this test**. Record each one in ticket **`0051`** (`cocoder/tickets/open/`), the live issue
log for this priority, with: the run reference, the surface involved, what was expected vs observed, and a
severity. Oscar names anomalies in the wrap-up pickup; the founder and the supervisor session append the
durable entries to 0051. Do NOT attempt to fix control-plane defects from inside this run.
