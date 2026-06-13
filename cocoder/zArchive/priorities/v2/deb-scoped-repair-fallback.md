---
id: deb-scoped-repair-fallback
title: "Deb — CoCoder repair fallback (ADR-0016)"
---

> **ARCHIVED 2026-06-13 (founder-confirmed, priority audit).** Objective met: ADR-0016 Accepted; all
> six surfaces (`deb-status`, `deb-nudge` Oscar-only, gate-enforced `deb-repair`, `deb-authored`,
> cross-run recurrence escalation, base/delta scope split) built and **live-proven on run_33**
> (`34ecf13`). No buildable work left; was lingering in active `priorities/` after the PLAYBOOK Done
> list already credited the `deb` tier. Kept for history.

## Objective
Rebuild Deb from a passive fault-classification endpoint into CoCoder's **escalation engineer**: a
read-only observer of ordinary target-repo work that can inspect orchestration state and write
CoCoder repairs when the orchestration system itself is failing — implementing
[ADR-0016](../decisions/0016-deb-scoped-repair-fallback.md).

**Verified when:**
1. Deb answers "how's Oscar doing?" with **evidence from runner state** — the runner writes a live
   `deb-status.json` projection (active atom/task, Oscar/Bob/verify state across
   waiting·running·verifying·stalled·blocked, last-directive/builder/verify timestamps, current wait
   condition, outstanding faults, write scopes) that changes as those states change;
2. Deb **recommends a narrow nudge** via `deb-nudge.json` and the runner delivers it to Oscar
   (`oscar-nudge` with `source:"deb-authored"`) — Oscar-only, never directing Bob (authority rule);
3. a `cocoder-bug` triaged `mode:"repair"` **gate-commits only Deb's in-scope edits** (a distinct
   `deb-repair` commit) while target-repo product code is **held back + surfaced**, never committed;
   a repair never rescues the run (a faulted run still fails);
4. Deb's write-scope is **explicit and enforced** — portable governance (`cocoder/priorities|rebuild|
   personas|tickets/**`) in the base persona, broad CoCoder implementation repair authority in the
   CoCoder-repo delta, self-gating to the dogfood case;
5. fault dispatch still returns exactly one of `cocoder-bug | repo-bug | one-off`;
6. **cross-run recurrence escalation** — the runner fingerprints faults and counts prior occurrences; on
   a **2nd** occurrence Deb escalates (fix-if-easy → file a `cocoder/tickets/` ticket tagged to an
   existing priority → recommend a new priority for founder approval), recorded as `fault-recurrence` +
   surfaced in the durable disposition. She never auto-creates a priority.

**Boundary:** implements ADR-0016 — the status feed, nudge-request channel, repair mode + triage-contract
extension, the base/delta write-scope split, and the cross-run recurrence-escalation loop. It widens Deb
inside the CoCoder source repo for diagnosed `cocoder-bug`s; it does **not** widen Deb into target-repo
product code and does **not** auto-land a failed run's repair commit to trunk. Decomposition into atoms
lives in the run, not this file.
