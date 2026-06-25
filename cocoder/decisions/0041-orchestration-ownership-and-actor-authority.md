# ADR-0041 — Orchestration ownership & actor authority

**Status:** Proposed (Claude non-orchestrated session, 2026-06-24) — **for founder review.**
This ADR is the decision gate for the deep D1/D4 redesign; only the low-risk D2/D3/D5 guardrails are
implemented in the same session (see §7).
**Seam:** who owns the orchestration spine, and what each actor (Oz, the runner, Oscar, Bob, Deb) may
*decide / write / commit / close* and *when* — and where agentic side-channels race the deterministic spine.
**Builds on:** [0016](./0016-deb-scoped-repair-fallback.md) (Deb advises, the runner delivers) ·
[0023](./0023-workspace-commit-spine.md) (one commit spine; scope is advisory; `commitOnlyScope` withholds) ·
[0036](./0036-oscar-deb-repair-dialogue.md) (the Oscar↔Deb repair dialogue) ·
[0040](./0040-oz-write-side-autonomy.md) (the `oz-action` self-direct write lane).
**Relates to:** F21 / ticket 0018 (gate-bypass guard deliberately *not* enforced — agent self-commits are
**detected, not prevented**); the runner-decoupling refactor (`runner-decoupling-refactor.md`).
**Evidence base:** runs `89-run_233` and `90-run_234` (the two dogfooding self-fix runs that used the live
loop to fix the loop), commits `9a15d1a 32785cf 549ab11 bd5fdf5 76652aa f304c4c`.

## Context

The runner-decoupling refactor made the **runner** (`packages/core/src/runner/runner.ts → runRun`,
line 363) the deterministic orchestrator: directive → dispatch → monitor → verify gate → per-atom commit →
wrap → close → teardown. Oscar, Bob and Deb are agentic roles the runner *consults*; Oz is the control-plane
daemon. The intended doctrine (ADR-0016) is **"Deb advises, the runner delivers."**

Two runs that used the live loop to fix the loop showed the coordination breaks down: **agentic
side-channels act *outside* the deterministic spine and race it.** This ADR maps every actor's real
authority against the code, names the five coordination gaps (D1–D5) with run evidence, and proposes the
fix — separating the parts that are clearly correct and contained (built now) from the parts that reverse
deliberate prior decisions and need founder sign-off (deferred).

## 1. Actor authority map (grounded in code, not intent)

"WRITE" = governed flat files / events; "COMMIT" = git; "CLOSE" = ticket/run closure. Citations are
`path:line` at HEAD `5817af6`.

| Actor | May DECIDE | May WRITE | May COMMIT | May CLOSE / ARCHIVE | WHEN (phase) |
|---|---|---|---|---|---|
| **Oz** (daemon, `packages/daemon/src/launcher.ts`) | run lifecycle (launch/stop/teardown/nudge); reversible governance edits (ADR-0040) | `oz-action` scope: `cocoder/tickets/**`, `priorities/order.json`, narrow docs, non-Objective priority edits (ADR-0040 §1) | `oz-action` commit via the **one spine** with `commitOnlyScope:true` — out-of-lane **held back** (`launcher.ts:1022`); also `oz-repair` | open/close tickets (reversible lane, ADR-0040 §1) | **idle only** — blocked while a run for the workspace is in flight |
| **runner** (`runRun`) | the entire deterministic sequence; the verify **gate decision** consumes Oscar's verdict; loop backstops (max rejects / max atoms) | run records, events, `directive-N`/`verify-N` channels, portable run history | per-atom commit on verify-pass, message `${priorityId}: atom ${n} via CoCoder ${runRef}` (`prompts.ts:627-631`); oscar-support + run-history commits | **returns** `ticketCloseDecision` (`close`/`ask`/`none`); does **not** itself close | every phase — it *is* the spine |
| **Oscar** (orchestrator) | directive content; per-atom **verify verdict** (`pass`/`fail`); wrap disposition incl. ticket close intent | `directive-N.json`, `verify-N.json`, wrap brief; in-scope Surface-A edits | only **through** the runner's gate (`runCommitGate`) — never its own `git commit` | proposes close via wrap; the **daemon** executes it post-run | during the run; bounded post-wrap support |
| **Bob** (builder) | implementation choices inside the delegated atom | working tree during the atom | only **through** the runner's gate; failed atoms quarantined/reverted | nothing | only during a delegated atom |
| **Deb** (watcher / repair) | watch/nudge advice; fault triage (`cocoder-bug`/`repo-bug`/`one-off`); repair proposals | her writeScope (`tickets/**`, `decisions/**`, `priorities/**`, `PLAYBOOK.md`, `failure-catalog.md`, `personas/**`) | the **intended** path is `commitDebRepair(... 'deb-repair')` (`launcher.ts:1114,1174`); persona doctrine forbids hand-close | **must route** ticket close through `closeTicket()` — persona forbids hand-moving files | reactive (fault) or the ADR-0036 dialogue — **never inside a live run that depends on the surface she repairs** |

**The one close spine.** `closeTicket()` (`packages/core/src/tickets/close.ts:79`) only *writes files*
(moves `open/→closed/`, flips `status:`, appends `## Resolution`, prunes `order.json`) and **returns the
file list** — it makes **no git commit**. The commit is made by the caller. The runner-driven path is the
daemon's `closeTicketAfterSuccessfulRun()` (`launcher.ts:442`), gated on `result.ticketCloseDecision`
(`443/447`), committed with message **`governance: close ticket ${id} via run ${runId}`** (`launcher.ts:476`),
called once per run at `launcher.ts:709`. **The `via run <id>` suffix is the spine's fingerprint.**

**Detect-don't-prevent (the root posture).** The commit gate
(`packages/core/src/commit-gate/gate.ts`) computes `selfCommitted = headNow !== headBefore`
(`gate.ts:60-61`) and, when true, records an `agent-self-commit` event — but **does not throw**
(`gate.ts:62-63`). For ordinary callers the committable set is `commitOnlyScope ? inScope : changed`
(`gate.ts:75-76`): the **default is commit-all**, out-of-scope paths are *committed-and-flagged*
(`out-of-scope-committed`, `gate.ts:96`). Only callers that opt into `commitOnlyScope:true`
(`oz-action`, and post-0053 the support-commit lane) **withhold** out-of-lane paths
(`out-of-scope-held-back`). This is the deliberate F21 / ticket-0018 choice — and the enabler of D1–D3.

## 2. The coordination gaps (D1–D5), with run evidence

Timeline of run_234 (ticket-fix-0054, launched 20:32:40), reconstructed from
`cocoder/runs/90-run_234/{events,commits}.jsonl` and git:

```
20:32:49  delegation + builder-dispatch   atom 0 → Bob, task = "fix 0054 failed-run terminal path"
20:37:05  549ab11  author=Anthony Franco   "fix(runner): refresh terminal Deb status after watcher stop"
20:38:00  bd5fdf5  author=Anthony Franco   "governance: close ticket 0054"   ← NO "via run" suffix
20:38:24  verify-dispatch                  atom 0
20:39:54  verify-rejected  atom 0          "No atom diff … 549ab11 and bd5fdf5 already landed on main"
20:40:30  76652aa  oscar-support           (in run_234 commits.jsonl)
20:40:59  f304c4c  atom 1 = SESSION_LOG.md only; 5817af6 run-history (cocoder-governance)
```

`run_234/commits.jsonl` records **only** `76652aa` and `f304c4c`. **Neither `549ab11` (the actual fix) nor
`bd5fdf5` (the close) appears in the run's own commit ledger** — they happened beside the spine. The
runner's "successful" atom 1 (`f304c4c`) committed *only* `cocoder/SESSION_LOG.md`; the substantive code
change to `runner.ts`/`status.ts` was never made or recorded **by the run**.

**D1 — A second, non-deterministic owner commits and closes outside the runner's sequence.**
Deb authored the entire 0054 fix and committed it (`549ab11`) with a hand-written conventional-commits
message — **not** the runner's `ticket-fix-NNNN: atom N` format, and **not** even the `deb-repair` spine
label — then closed the ticket (`bd5fdf5`, message missing the `via run` suffix → outside
`closeTicketAfterSuccessfulRun`). Author identity is **not** a discriminator: a legitimate runner atom
(`f304c4c`) and Deb's self-commit (`549ab11`) *both* show `Anthony Franco`. The discriminators are the
**message format** and **absence from `commits.jsonl`** — both confirm a raw bypass.
*Evidence:* `549ab11`, `bd5fdf5`, `run_234/commits.jsonl`.

**D2 — No mutual exclusion: the same ticket in two lanes at once.** While the runner held 0054 in the
build lane (Oscar→Bob→verify, `delegation` 20:32:49), Deb processed the *same* 0054 in the repair lane and
landed the fix mid-run (20:37). Bob's atom was redundant; nothing collided only because the two happened to
touch disjoint files. The ADR-0036 in-daemon dialogue has an idle guard (it refuses while
`sourceRun.status === 'running'`), but a Deb persona acting in **its own agentic session** bypasses that
guard entirely, and detect-don't-prevent means its raw `git commit` is never blocked.
*Evidence:* run_234 `delegation`@20:32:49 vs `549ab11`@20:37:05; `verify-rejected` reason.

**D3 — Ticket close races the verify gate.** 0054 was closed (`bd5fdf5`, 20:38:00) **~24s before** the
run's own verify gate even dispatched (`verify-dispatch` 20:38:24), and well before the daemon's
`closeTicketAfterSuccessfulRun` would run at wrap. The runner's close then hit an already-closed ticket —
idempotent by luck (`close.ts:84-88` returns `already-closed`), but the ordering is inverted: **close
preceded verify.**
*Evidence:* `bd5fdf5`@20:38:00 vs `verify-dispatch`@20:38:24.

**D4 — Detect-don't-prevent is the root enabler.** Because a self-commit is only *flagged*
(`gate.ts:62-63`) and a raw `git commit` outside any gate isn't intercepted at all, an agent can act
**beside** the spine instead of **through** it. D1–D3 are all downstream of this one posture (F21 /
ticket 0018 chose detection deliberately). *This is the crux — see §4.*
*Evidence:* `gate.ts:60-63`; `549ab11`/`bd5fdf5` never entering any gate event stream for run_234.

**D5 — DX papercut: no CLI over the governed close/create spines.** `closeTicket()` and the
create-priority/authoring spines have **no CLI wrapper**, forcing ad-hoc `tsx` invocations. Deb's
`tsx -e` close failed on top-level await (a `.mts` *file* works). The friction of "to do it right you must
hand-author a script" is precisely what nudges an agent toward a raw `git commit`/hand-close — so D5
materially feeds D1.
*Evidence:* the session-brief account; `bd5fdf5` hand-message vs `launcher.ts:476` spine message.

### run_233 corroboration (background)
`run_233` (ticket-fix-0051) committed `9a15d1a` labelled **"atom 0"** but carrying a `runner.ts`
terminal-status change + a `gate.ts` change + four ticket/INDEX/order files — a large out-of-scope sweep
under one atom label (the commit-all default, `out-of-scope-committed`). It shipped **main red** (581/582);
a supervisor session reconciled it forward in `32785cf`. Same root cause: the spine committed past its lane
because scope is advisory, not enforcing.

## 3. Decision (proposed — challenge, don't rubber-stamp)

**Principle: one deterministic owner per run, and one committer/closer of record.** The runner is the sole
deterministic orchestrator and the sole authority that commits run atoms and triggers ticket closure for a
run's own target. Every other actor's mutation for that target routes **through** the runner, the way
Deb-nudge already does ("Deb proposes; the runner sequences, gates, commits, closes").

Concretely:

- **R1 (D3, build now).** The runner owns ticket-fix-target closure at verified wrap. A mid-run agentic
  close of the *running* target is refused or deferred to `closeTicketAfterSuccessfulRun`. Close must not
  precede verify. *Low-risk, behavior-preserving — implemented this session.*
- **R2 (D2, build now).** One owner per ticket at a time: a ticket dispatched to the build lane cannot
  simultaneously be admitted to the Deb-repair lane (build XOR repair). Pin the run_234 case.
  *Low-risk — implemented this session.*
- **R3 (D5, build now).** Add `cocoder oz close-ticket <id>` and a create-priority CLI over the existing
  governed spines so closing/creating never needs ad-hoc `tsx`. *Low-risk — implemented this session.*
- **R4 (D1, DEFER → founder).** Subordinate Deb-repair to the runner: Deb *proposes* a repair; the runner
  (or the daemon on its behalf) sequences, gates, commits with the run fingerprint, and closes. No direct
  Deb commits/closes for a run's target. This reverses the current "Deb-repair authors+commits+closes" path
  and must be weighed against ADR-0016/0036.
- **R5 (D4, DEFER → founder, the crux).** Decide whether **preventing** (not just detecting) agent
  self-commits is *required* for R1/R2/R4 to actually hold. R1/R2 reduce the *window* and *redundancy*, but
  a determined agent session with shell access can still raw-`git commit` beside the spine; only prevention
  (a pre-commit hook / sandboxed identity / gate-enforced HEAD lock) closes the door fully. F21/0018/0023
  chose detection on purpose — **do not silently reverse it.**

## 4. The D4 crux — prevent vs detect (founder decision)

The honest tension: **R1–R4 are guardrails, not a fence.** They make the *cooperative* path correct and the
*accidental* race impossible, but they assume actors commit *through* a spine. A Deb/agent session with a
real shell and the founder's git identity can still bypass everything with one `git commit` — exactly what
`549ab11`/`bd5fdf5` did. Detection (`gate.ts:62-63`) then notices HEAD moved *after the fact*, if and only
if a later gated commit runs.

- **Keep detection (status quo, F21/0018).** Cheap, no false-positive risk, preserves the
  "spine never withholds, agents are trusted-but-audited" doctrine. Cost: D1-class bypasses remain
  *possible*; we rely on R1/R2 + audit to make them *rare and visible*, not impossible.
- **Add prevention.** A pre-commit hook or gate-held HEAD-lock that rejects any commit not carrying the
  current run/lane fingerprint. Closes D1 fully. Cost: reverses a deliberate decision; risks friction for
  legitimate human/founder commits; needs a clean "who am I right now" identity signal the engine doesn't
  yet have.

**Recommendation:** ship R1–R3 now (they stand on their own and reverse nothing); take R4 as the next
build *behind this ADR's approval*; treat R5 as a **separate founder decision** — my lean is to **keep
detection** and make R1/R2 + the `via run` fingerprint + an audit assertion (run wrap fails if HEAD moved
via a non-run commit during the run) the practical mitigation, escalating to prevention only if a post-R4
dogfood still shows bypasses. This keeps F21/0018/0023 intact unless evidence forces the reversal.

## 5. Alternatives considered

- **Status quo + discipline (prompt-only).** Rejected: run_233 and run_234 are two-for-two failures of
  prompt-only discipline under the live loop. "Deb advises, the runner delivers" is already the documented
  rule; it was violated anyway because nothing in code stops it.
- **Worktree isolation per lane (ADR-0023 opt-in).** Would prevent *file collisions* but not the
  *ownership/ordering* defect — two owners still close/commit the same ticket; merge just moves the race.
  Useful complement, not a fix.
- **Make `commitOnlyScope:true` the global default (kill commit-all).** Tempting (it would have caught
  9a15d1a's sweep) but it reverses ADR-0023's central choice for *all* callers, a much larger blast radius
  than D1–D5 warrant. Out of scope here; flag for a future ADR if R5 trends toward prevention.

## 6. Consequences

- The runner becomes the single source of truth for "what landed for this run," and `commits.jsonl`
  becomes a *complete* ledger again (today it can omit the run's own substantive change — see §2).
- One-owner-per-ticket removes the redundant-build waste and the latent file-collision risk of D2.
- Closing the close/create CLI gap (R3) removes the friction that pushes agents off the governed path.
- The prevent-vs-detect line stays explicitly founder-owned; this ADR does not flip it.

## 7. Built in this session vs deferred

**Built (low-risk, tests-first, one fix per commit, full suite green):** R1/D3 close-ordering,
R2/D2 mutual exclusion, R3/D5 close-ticket + create-priority CLI. See the session handoff for shas.

**Deferred behind founder approval of this ADR:** R4/D1 (subordinate Deb-repair to the runner) and
R5/D4 (prevent-vs-detect self-commits). These change orchestration behavior and reverse
ADR-0016/0023/0036/F21/0018 decisions; they are a redesign, not a guardrail.

## 8. Tickets

D1–D5 are tracked as durable bug tickets, cross-referenced here: **0055** (D1), **0056** (D2),
**0057** (D3), **0058** (D4), **0059** (D5). D2/D3/D5 are closed by the guardrails built this session;
D1/D4 remain open as the founder-gated redesign work.
