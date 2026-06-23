# ADR-0016 — Deb: the CoCoder repair fallback

> **Reconciliation note ([ADR-0023](./0023-workspace-commit-spine.md), 2026-06-14).** Deb's repair model
> (live status feed, Oscar-only nudge channel, gate-enforced repair/ticket, base/delta scope) stays
> live. What changed: a Deb repair or ticket is gate-committed **through the one commit spine straight
> onto the active branch by default** (ADR-0023) — not onto a separate run branch the founder must land.
> Body references below to "the run's worktree" / "drafted on the run branch for the founder" describe
> the **opt-in isolation lane** only; in the default (direct) mode Deb edits the active checkout and the
> commit lands in place. It still "does not rescue the run" — a faulted run still fails; the repair is a
> distinct, reviewable commit.

**Status:** Accepted (founder + Claude, 2026-06-02) — **amended by [0040](./0040-oz-write-side-autonomy.md)** (2026-06-23): Deb's reactive, fault-triggered repair authority below is unchanged; ADR-0040 adds a *separate*, narrower, **proactive** self-direct write lane owned by Oz (`oz-action`, for reversible edits to existing governance) on the same ADR-0023 spine — not a folding of repair into Oz.
**Seam:** the debugger tier — Deb's authority, visibility, and write scope
**Refines:** [0013](./0013-orchestration-observation.md) (tier-2 Deb: was observe-and-triage; now observe,
diagnose, nudge, **and repair within a fence**) · **Builds on:** [0007](./0007-write-scope-enforcement.md)
(commit-gate enforcement), [0012](./0012-living-base-personas.md) (base/delta split), [0003](./0003-data-model-hybrid.md)
(single writer), [0015](../zArchive/v2/decisions/0015-isolated-working-state-per-run.md) (the run's worktree)

## Context

ADR-0013 named Deb tier 2 ("monitor Oscar, nudge Oscar; may observe Bob to diagnose, never orchestrate
Bob"), but the instantiated role was a **passive fault-classification endpoint**: she stood by until the
runner handed her a `fault-i.json`, returned one disposition (`cocoder-bug | repo-bug | one-off`), and
that was all. She had no live visibility into Oscar/Bob (her prompt forbade probing the run), an empty
`writeScope` (so even a clear machinery fix was only a diff pasted into a markdown doc), no way to detect
a stall before a formal fault dispatch, and no Deb-authored nudge channel (the runner auto-nudged Oscar
with a fixed string merely *attributed* to Deb). Deb was made responsible for orchestration health while
denied the authority to diagnose or repair it.

## Decision

Deb is **CoCoder's escalation engineer** — the fallback that repairs the orchestration system when Oscar
and Bob can't. She gains scoped authority through three runner-owned, file-based surfaces (the same
file-handshake + projection patterns as `directive-n.json` / `verify-n.json` / `triage-i.json` and the
run-record projection), so she never hunts panes or run dirs.

### 1. A live status feed (her eyes)
The runner writes `deb-status.json` (+ a `.md` rendering), a **projection over the store** refreshed at
every transition and while it awaits Oscar. It reports the active atom/task, Oscar/Bob/verify state
(`waiting · running · verifying · stalled · blocked`), the timestamps of the last directive / builder
activity / verify, the current wait condition, outstanding fault dispatches, and write scopes by persona.
Deb answers "how's Oscar doing?" from this — concrete state + timestamps + what the runner is blocked on.
If Deb lacks state, that is a CoCoder bug to fix, not a steady state.

### 2. A nudge-request channel (she advises; the runner delivers)
Deb recommends ONE narrow intervention by writing `deb-nudge.json` (`{target:"oscar", message, rationale,
seq}`); the already-running Oscar watchdog delivers it (rate-limited), recording an `oscar-nudge` event
with `source:"deb-authored"`. The **authority rule holds**: `target` is fixed to `oscar` — Deb may
observe Bob to diagnose but never directs Bob. The generic idle nudge remains the no-recommendation
fallback.

### 3. Repair mode (authority-gated, never a rescue)
For a `cocoder-bug`, Deb chooses `mode:"propose"` (a diff for founder review — the default, and the only
option where she has no in-tree authority) or `mode:"repair"`: she edits files **within her active
CoCoder authority** in the run's worktree and reports diagnosis / why-CoCoder-owned / files-changed /
verification / remaining risk. The runner then runs the **existing commit-gate against Deb's active
scope** (ADR-0007): her in-scope edits land as a distinct `deb-repair` commit; anything outside
(especially target-repo product code) is **held back and surfaced**, never silently committed or hidden.
A repair **does not rescue the run** — a faulted run still fails; the repair commit is surfaced for the
founder to review/land.

### 4. Cross-run recurrence escalation (the learning loop)
A run-scoped triage forgets: the same fault can recur run after run, each logged as a fresh `one-off`.
So the runner now keeps **durable cross-run fault memory** — when it dispatches a fault it computes a
**coarse fingerprint** (fault type + a normalized message: run ids / worktree paths / shas / counts
stripped) and counts prior matches across the workspace's `fault-triaged` records, folding `occurrence`
into the fault context Deb reads (and recording a `fault-recurrence` event at occurrence ≥ 2).

On a **second** occurrence Deb escalates, preferring the **lightest home** (founder-decided order):
**(1)** fix it if easy + clearly in her CoCoder authority (repair mode); else **(2) the default — file a tracked
ticket** under `cocoder/tickets/` tagged to the most relevant **existing** priority (a follow-up, *not*
a new priority, *not* a rewrite of the immutable priority stub); **(3)** only **recommend** a new
priority *inside that ticket* for founder approval — she never creates a `cocoder/priorities/*` file
herself. The ticket is committed via the same commit-gate path as a repair.

**Failed-run seam (decided):** a recurrence is usually detected on a run that then **fails**, and failed
runs never reach trunk — so the escalation is surfaced in the **durable disposition** (the run dir,
always visible — the founder is informed) and the ticket is **drafted on the run branch for the founder
to land**. An auto-land carve-out (a failed run touching trunk with a governance-only commit) is
**deliberately deferred** to its own ADR — it would punch a hole in an integration invariant.

### Write scope — split by the living-base/delta seam (self-gating)
Per ADR-0012, the **base persona** carries the portable governance scope present in every CoCoder
workspace — `cocoder/priorities/**`, `cocoder/decisions/**` + the Playbook/failure-catalog, `cocoder/personas/**`, `cocoder/tickets/**` —
and the **CoCoder-repo delta** adds broad dogfood-only CoCoder implementation authority (`packages/**`
plus the repo's public docs/templates/scripts/root metadata). In a non-CoCoder workspace those machinery
globs match nothing in-tree, so a machinery `cocoder-bug` is **proposed** (a PR to the CoCoder repo)
rather than applied — the same verdict, routed for review. Target-repo product code, secrets,
install-local state without an explicit export contract, and process/window lifecycle remain outside
Deb's authority and are enforced at the gate.

**Founder correction, 2026-06-08:** Deb should not be blocked by a narrow path repair fence when the
CoCoder machinery itself is failing. The boundary is diagnosis and ownership (`cocoder-bug`), not an
old list of implementation folders. ADR-0007 still gates what is committed; this ADR no longer treats
the daemon, UI, adapters, commit gate, tests, or the rest of `packages/core` as off-limits for Deb in
the CoCoder source repo.

## Consequences

- **Deb's authority now matches her responsibility:** she can answer how Oscar/Bob are tracking, detect a
  stall before a formal fault, recommend a narrow nudge without taking over, and repair CoCoder machinery
  where the root cause actually lives — or escalate a recurring failure into a tracked priority /
  persona-or-runner contract change instead of the founder hand-drafting it.
- **Invariants preserved:** the runner stays the single store writer (ADR-0003) and runs every
  commit-gate; write-scope is enforced deterministically at the gate (ADR-0007); the authority rule holds
  (Oscar-only nudges; never directs Bob); Deb never rescues the critical path.
- **Triage contract is back-compatible:** a verdict without `mode` parses as `propose`; `repair` is
  honoured only for a `cocoder-bug`.
- **Status feed is a convenience projection:** a render hiccup never fails the run; it exists only for a
  Deb-backed run.
