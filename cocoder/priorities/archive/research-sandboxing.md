---
id: research-sandboxing
title: Research sandboxing — decide IF/WHEN/minimal-form, default to "not now"
---

> **Archived 2026-06-29 (founder) — archive confirmed.** Cleared per 2026-06-29 audit; commit-time holdback premise is stale after ADR-0023/0045; revive with refreshed premise.

**Status:** backlog — research spike, recorded 2026-06-15 (founder-directed, from the Omnigent
comparison read). **Blocked on the commit spine being boringly reliable first** (ADR-0023): we are
still unwinding existing constraints around correct commits, so no new enforcement layer gets
designed — let alone built — until plain "commit the right files to the right branch" is solved and
calm. This file exists to preserve the intent, not to schedule work.

## Objective

Produce a **founder-decision recommendation** (one short doc; an ADR only if the answer is "yes, and
here is the minimal slice") answering: *does CoCoder need OS-level sandboxing of agent runs, and if
so, what is the smallest form that buys real safety without adding friction?* The deliverable is a
**decision, not an implementation.** "No / defer indefinitely" is an acceptable — and the **default
expected — outcome**, and counts as the priority succeeding, not failing.

**This is research (G1): surface the vision only to locate the real seam, then write the decision.
Do not build the sandbox under this priority.** If the recommendation is "yes," it spawns a *separate*
narrowly-scoped build priority with its own Objective and founder approval.

### Hard constraints (the answer must honor all of these — a proposal that violates any is out of scope)

1. **No over-constraint.** Nothing here may make the happy path slower, more interactive, or more
   gated. If a builder run has to ask permission for an ordinary file write, the proposal has failed.
2. **No security theater / no over-engineering.** Reject anything justified by a threat we don't
   actually run into (G2 — earned guardrails only: trace it to a failure-catalog row or a real
   observed dogfood failure, or it doesn't ship). We are a single-operator, attended, macOS-first,
   local tool — not a multi-tenant host. The cloud-sandbox-provider model (Modal/Daytona/Islo) that
   platforms like Omnigent need is **explicitly out of scope** — it solves a tenancy problem we don't
   have.
3. **No blockers to execution or documentation.** The mechanism must be **off by default and opt-in**,
   compose with the existing single-writer lock (ADR-0004) and commit spine (ADR-0023) rather than
   replace or precede them, and never sit in the path of governance/docs commits (light/no-verify by
   ADR-0023). If it can't be added without touching the happy path, the answer is "not yet."
4. **Boundary, not governance (G4).** Any real value is at the agent→filesystem reality boundary
   (turning write-scope from a commit-time convention into an actual filesystem limit), never more
   rules about our own governance.

### What the research should actually weigh

The honest finding from the Omnigent read (clone was at `/tmp/omnigent-compare`):

- **The real gap, if any:** today our "bounded write scope" (ADR-0007) is enforced at *git-commit
  time* — the spine holds back out-of-scope **tracked** changes and `restoreToHead` quarantines. It
  is **not** a filesystem boundary. Below the commit layer it leaks: a destructive shell command
  (`rm -rf`, a bad codegen script), out-of-scope working-tree writes, **cross-workspace** reads/writes
  (one install manages many workspaces + the shared `local/` DB and `local/secrets/`), and reads of
  secrets (`memory/*.env`, `~/.ssh`, `~/.aws`). The one concrete real-world trigger is **prompt
  injection** from untrusted repo/dependency/web content driving exfiltration.
- **The honest counterweight:** while runs are **attended** and on **repos the operator controls**,
  most actual risk is already covered by **git recoverability** (committed = reviewable; working-tree
  = `git checkout`-able; `restoreToHead` quarantines) plus the single-writer lock. The value of
  sandboxing scales *only* with three things — **(a) how unattended/autonomous runs become, (b)
  whether agents touch content we don't control, (c) whether the multi-workspace blast radius becomes
  real.** If none of those are active goals, the recommendation should be "no."
- **If the answer is "yes, minimal":** the smallest credible form is a **single macOS `sandbox-exec`
  (SBPL) wrapper around adapter launch** in `packages/adapters` — scoped to the active worktree + run
  dir, network deny-by-default, `memory/` and `local/secrets/` masked — **opt-in per run, off by
  default.** Not a platform, not a policy engine, not the Linux `bwrap`/seccomp machinery. Omnigent's
  seatbelt backend is a working *reference only*, not a thing to port.

**Verified when:** a founder-readable recommendation exists that (a) gives a clear yes/no/defer tied
to whether (a)/(b)/(c) above are real goals, (b) if "yes," specifies the single smallest opt-in slice
and the failure-catalog/observed-failure row that earns it, and (c) confirms every Hard Constraint is
met — and the founder has accepted it. Picking this up before the commit spine is calm is itself a
constraint violation.
