# ADR-0041 — Orchestration ownership & actor authority

**Status:** Accepted (Claude non-orchestrated session, 2026-06-24; **§3–§8 revised 2026-06-25** per founder
design input; **§3.1 gray-zone + §4 severity decisions pinned and the overseer build A–E landed 2026-06-25**
in a loop-down operator session — see §7). This ADR was the decision gate for the deep D1/D4 work; the
low-risk D2/D3/D5 guardrails landed alongside the revision (see §7).
**Revision note (2026-06-25):** §3's original direction — "subordinate Deb-repair to the runner" (R4) and a
prevent-vs-detect crux (R5) — was **retired** after founder input. Deb is an **always-on run overseer**, not
a ticket owner or repair worker; she must stay runner-independent (she's who diagnoses the runner). The
fix is an **interference check** that bounds what Deb may change live, not a subordination of Deb to the
runner. §1's Deb row and §3–§8 reflect the overseer model. §1's actor citations and §2's evidence are
unchanged.
**Seam:** who owns the orchestration spine, and what each actor (Oz, the runner, Oscar, Bob, Deb) may
*decide / write / commit / close* and *when* — and where agentic side-channels race the deterministic spine.
**Builds on:** [0016](./0016-deb-scoped-repair-fallback.md) (Deb advises, the runner delivers) ·
[0023](./0023-workspace-commit-spine.md) (one commit spine; scope is advisory; out-of-lane paths commit and are flagged) ·
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
| **Oz** (daemon, `packages/daemon/src/launcher.ts`) | run lifecycle (launch/stop/teardown/nudge); reversible governance edits (ADR-0040) | `oz-action` scope: `cocoder/tickets/**`, `priorities/order.json`, narrow docs, non-Objective priority edits (ADR-0040 §1) | `oz-action` commit via the **one spine** — the whole changed set lands and out-of-lane paths are flagged; also `oz-repair` | open/close tickets (reversible lane, ADR-0040 §1) | **idle only** — blocked while a run for the workspace is in flight |
| **runner** (`runRun`) | the entire deterministic sequence; the verify **gate decision** consumes Oscar's verdict; loop backstops (max rejects / max atoms) | run records, events, `directive-N`/`verify-N` channels, portable run history | per-atom commit on verify-pass, message `${priorityId}: atom ${n} via CoCoder ${runRef}` (`prompts.ts:627-631`); oscar-support + run-history commits | **returns** `ticketCloseDecision` (`close`/`ask`/`none`); does **not** itself close | every phase — it *is* the spine |
| **Oscar** (orchestrator) | directive content; per-atom **verify verdict** (`pass`/`fail`); wrap disposition incl. ticket close intent | `directive-N.json`, `verify-N.json`, wrap brief; in-scope Surface-A edits | only **through** the runner's gate (`runCommitGate`) — never its own `git commit` | proposes close via wrap; the **daemon** executes it post-run | during the run; bounded post-wrap support |
| **Bob** (builder) | implementation choices inside the delegated atom | working tree during the atom | only **through** the runner's gate; failed atoms quarantined/reverted | nothing | only during a delegated atom |
| **Deb** (run **overseer**) | observe the live run; nudge a stuck session; judge "minor & **non-interfering**" self-fix vs run-end founder suggestion; spot a stale-open ticket | **non-interfering** edits only — `.md`/instruction surfaces (orchestration prompts, `personas/**`, `decisions/**`, `PLAYBOOK.md`, `failure-catalog.md`, docs). **Never** the runner or the active run's target code (→ founder, §3) | only **through the normal governed spine** — her non-interfering `.md` self-fix, and any founder-approved fix, ride `commitFiles`/the gate; **no raw `git commit`** | a **reconciliation** close (a ticket that should already be closed) via the governed `closeTicket` spine, or reconciliation repoint (release/rehome) via the governed `repointTicket` spine — never a ticket an active run owns | **always-on** during a run (observe/nudge); self-fix only when non-interfering; interfering items surface at **run-end** for the founder |

**The one close spine.** `closeTicket()` (`packages/core/src/tickets/close.ts:79`) only *writes files*
(moves `open/→closed/`, flips `status:`, appends `## Resolution`, prunes `order.json`) and **returns the
file list** — it makes **no git commit**. The commit is made by the caller. The runner-driven path is the
daemon's `closeTicketAfterSuccessfulRun()` (`launcher.ts:442`), gated on `result.ticketCloseDecision`
(`443/447`), committed with message **`governance: close ticket ${id} via run ${runId}`** (`launcher.ts:476`),
called once per run at `launcher.ts:709`. **The `via run <id>` suffix is the spine's fingerprint.**

**Post-wrap reconciliation guard (2026-06-25 amendment).** When a ticket run or priority run
wraps into a founder-confirmation state, the recovery owner is the daemon/Oz control plane, not a fresh
throwaway run and not a loop-down raw file edit. A ticket close-confirmation action calls
`closeTicket()` through the same governed reconciliation spine; a priority archive-confirmation action
calls the existing `archive-priority` Play lane. Both are refused while the owning run is still in
`ctx.inFlight` and allowed after that run is terminal, even while the daemon remains live. The race guard
therefore keys on **owning run still active**, not on **daemon process live**.

**Detect-don't-prevent (the root posture).** The commit gate
(`packages/core/src/commit-gate/gate.ts`) computes `selfCommitted = headNow !== headBefore`
(`gate.ts:60-61`) and, when true, records an `agent-self-commit` event — but **does not throw**.
For ordinary callers the committable set is the whole changed set: out-of-scope paths are
*committed-and-flagged* (`out-of-scope-committed`). `oz-action`, support-commit, authoring Plays, and
repair now share that same rule. This carries forward the deliberate F21 / ticket-0018 choice to detect
side-channel commits instead of preventing them, while ADR-0023 later removed the path-scope parking branch.

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

## 3. Decision — Deb is a run overseer, bounded by an interference check

**Principle: Deb never owns the work; she oversees the run.** Ticket/priority ownership is always
Oscar/Bob; the runner is the sole committer/closer of a run's own target. Deb is an **always-on overseer**
(mirroring the CoBuilder "Debugger"): she watches a live run, nudges it when stuck, and decides — per a
**mechanical interference check** — whether a process improvement she spots is hers to land or the founder's
to dispose. She must stay **runner-independent** (she is who diagnoses the runner; subordinating her to the
runner would deadlock exactly when the runner is broken). This **retires** the original R4 (subordinate
Deb-repair) and R5 (prevent-vs-detect crux): the fix is bounding *what* Deb may change live, not fencing
*how* she commits.

### 3.1 The interference check (the mechanical rail)

A change Deb wants to make **interferes** iff it touches **the runner** or **the active run's target code
files**. An **`.md`/instruction edit** (orchestration prompts, `personas/**`, `decisions/**`, docs) does
**not** interfere. *Default when unsure → interfering.* This is a file-domain test, enforceable in code,
independent of Deb's judgment about whether the change is "minor."

> **Founder decision (2026-06-25, the one residual judgment call — RESOLVED):** the **conservative**
> default is adopted. **Any non-`.md` code change interferes** — the runner, the active target, or a small
> isolated guard in an unrelated file alike (→ run-end suggestion). The runner-tree and target-overlap
> branches of the widened variant therefore collapse: the predicate is a pure file-domain test over the
> change set, independent of the active run. Implemented as `interferes(changeSet)` in core
> (`packages/core/src/write-scope/interference.ts`): true iff the set contains any non-`.md` surface;
> `isInstructionSurface` is the single `.md` classifier the rail is built on; default-when-unsure →
> interfering falls out of the shape (a blank/extensionless path reads as code).

### 3.2 Deb's authority (the overseer model)

1. **Observe** the live run (read-only, always-on).
2. **Nudge** a stuck session along (the runner-owned nudge channel — unchanged).
3. **Direct minor self-fix** — *non-interfering only* (per 3.1): an `.md`/instruction improvement (an
   elegance-principle prompt line, a small guard in instruction text). Committed **through the normal
   governed spine** (`commitFiles`/gate) — never a raw `git commit`.
4. **Reconciliation close** — Deb **may** close a ticket she notices *should already have been closed and
   wasn't* (a bookkeeping gap), through the governed `closeTicket` spine. **Never** a ticket an active run
   owns, and never off a fix she herself just made live.
5. **Reconciliation repoint** — Deb **may** repoint a handled open ticket's `priority:` through the
   governed `repointTicket` spine via `reconcile-repoint`: release to standalone, or rehome to a named
   live priority. **Never** a ticket an active run owns; rehome requires `cocoder/priorities/<id>.md` to
   exist as a live priority; it rides `commitFiles`, never raw git, and does **not** auto-close or touch
   `order.json`.
6. **Run-end founder suggestion** — anything **interfering** (touches the runner or the target code): Deb
   does **not** act on it. She holds it and surfaces a suggested fix at **run-end**. The founder decides:
   **file a ticket**, or **approve**.

   > **Founder decision (2026-06-25, the "approve" semantics — RESOLVED):** option **(B)** — *approve
   > routes to the ticket/run path*. On either choice the change is landed by a **normal run or operator
   > session through the runner spine**; **Deb never commits interfering code herself** (preserving §3.3's
   > "who fixes the runner? a filed ticket, never Deb-as-owner" invariant). So "commits through the normal
   > commit process" means *the runner* commits it, not Deb. No new Deb commit op exists. The held diff is
   > **captured and reverted to HEAD** at hold-time (untracked adds quarantined under the gitignored dialogue
   > dir, tracked mods described in the deb-response), so it never dangles in the working tree to be swept
   > into a later run's pre-run snapshot — closing option-A's fragility. Implemented as the dedicated
   > run-end **founder-suggestion artifact** (`FounderEscalation`-shaped, with the explicit
   > *file-a-ticket | approve* options) written on the interfering-held path; `deb-applied`/
   > `deb-directed-running → founder-escalated → complete` in the ADR-0036 state machine.

For now the **founder is the disposition authority** for every interfering item; as the system seasons
(≈ a week of live running), Deb's run-end suggestions taper to genuine edge cases.

### 3.3 Why this is the right shape

- **It fixes run_234 at the root.** Deb's 0054 fix touched `runner.ts`/`status.ts` — the runner — so it
  **interferes**: never hers to land live; it was a run-end suggestion for the founder. Her commit + close
  rode raw `git` outside the ledger; under §3.2 both go through the governed spine. Three violations, all
  closed by the model — without removing Deb's independence.
- **It's repo-agnostic, and self-hosting falls out for free.** In a normal target repo, orchestration
  tweaks rarely touch product code, so Deb self-fixes freely. In CoCoder the product *is* the orchestration,
  so fixes touch the runner constantly → the *same* interference check routes them to the founder. One rule,
  correct in both worlds; nothing special-cases CoCoder, so nothing here can break other repos.
- **It keeps Deb runner-independent.** "Who fixes the runner?" — a **filed ticket**, done by a normal run or
  a human/operator session (this very session), never Deb-as-owner. No bootstrap deadlock.

## 4. Detect-don't-prevent stays (the old D4 crux dissolves)

The original §4 framed a prevent-vs-detect decision as the crux. Under the overseer model it **mostly
dissolves**: Deb's interfering changes aren't in her autonomous toolset (they route to the founder), and
every commit she *does* make goes through the governed spine. There is no class of legitimate Deb self-commit
that a prevention fence must allow, and a blanket fence would wrongly block her independent `.md` self-fix
and her founder-approved commits. So **keep detection** (F21/0018/0023 intact). The one worthwhile backstop
for the raw-shell edge case (a persona issuing `git commit` directly in its own session): a **run-wrap audit
assertion** — the run flags/faults if HEAD advanced via a commit absent from its `commits.jsonl` during the
run window. Detection made *load-bearing*, not replaced by prevention.

**Founder decision (2026-06-25): FLAG, not fault.** The assertion records a `run-wrap-bypass-detected`
event (`{auditBaseSha, bypassShas}`) and surfaces it, leaving the run's disposition unchanged — a
legitimate founder commit inside the window must not falsely fail the run. The surfaced shas are the
evidence a future revisit of prevention would need. Implemented in the runner
(`packages/core/src/runner/runner.ts` wrap path) atop the pure `unledgeredWindowCommits` keystone
(`packages/core/src/runner/wrap-audit.ts`); the window base is HEAD after the pre-run snapshots (which ride
`commitFiles` directly and are intentionally out of the ledger), enumerated via `Git.commitsSince`.

## 5. Alternatives considered

- **Subordinate Deb-repair to the runner (the original R4).** *Rejected* — it assumes the runner is
  available, but Deb is needed exactly when it isn't; routing her repairs through it deadlocks. Deb must be
  runner-independent.
- **Prevent (not detect) self-commits (the original R5).** *Rejected as the primary fix* — overbroad: it
  blocks Deb's legitimate independent `.md` self-fixes and founder-approved commits. The narrow run-wrap
  audit assertion (§4) covers the residual raw-shell case without a fence.
- **Status quo + discipline (prompt-only).** Rejected: run_233/run_234 are two-for-two failures of
  prompt-only discipline; the interference rail must be in code, not the prompt.
- **Worktree isolation per lane (ADR-0023 opt-in).** Prevents *file collisions* but not the ownership
  question — useful complement, not the fix.

## 6. Consequences

- Deb's role is sharp and enforceable: observe + nudge + non-interfering `.md` self-fix + reconciliation
  close + run-end founder suggestion. No second owner of a run's work can arise.
- `commits.jsonl` becomes a complete ledger again: every Deb commit rides the governed spine, so the run's
  substantive change can no longer land invisibly beside it (the run_234 §2 gap).
- The self-hosting overlap is handled by one mechanical check, not a CoCoder special case — other repos are
  unaffected.
- The prevent-vs-detect line stays at detection; this ADR does not flip ADR-0023/F21/0018.

## 7. Built in this session vs deferred

**Built (low-risk, tests-first, one fix per commit, full suite green):** the D5 CLI
(`cocoder oz close-ticket` + `create-priority`, the governed-spine surface Deb's reconciliation close and
founder-approved commits use); plus run_234 regression pins on the existing in-daemon lane-exclusion /
close-during-run guards (D2/D3). See the session handoff for shas. *Note:* the D2/D3 in-daemon guards
**pre-existed**; the run_234 mechanism was the raw-agent bypass, addressed by the overseer model, not those
guards.

**Deferred behind founder approval of this ADR (the overseer build):** (a) the **interference check**
(file-domain rail per §3.1) gating Deb's self-fix lane; (b) reshape the ADR-0036 Deb-repair path into
**observe / nudge / non-interfering `.md` self-fix / run-end founder suggestion**, removing autonomous
authoring+commit+close of interfering changes; (c) route every Deb commit (self-fix and founder-approved)
through the governed spine; (d) the run-wrap **audit assertion** (§4); (e) Deb's **reconciliation-close**
authority, guarded against active-run targets; (f) Deb's guarded **reconcile-repoint** release/rehome
authority. Each is tests-first and behavior-preserving for healthy runs.

**Built in the overseer-build session (2026-06-25, loop-down operator session; founder decisions §3.1/§4
pinned above):** **(a)** the pure `interferes(changeSet)` rail (`a2cab84`); **(d)** the run-wrap audit
assertion, FLAG-mode (`51d2689`); **(b)+(c)** the ADR-0036 path gated on the rail — interfering changes
held for the founder (`held-for-founder`, surfaced via the `interfering-held` event + `outOfLanePaths`),
non-interfering `.md` self-fixes committed through the governed spine under the shared governance author,
no bespoke `deb-repair` author (`75a9cb5`), with `deb.md` aligned to the overseer model (`4a5b52a`);
**(e)** the guarded `reconcile-close` authority (`538eed4`); **(f)** the guarded `reconcile-repoint`
release/rehome authority. The run_234 shape is pinned at both the predicate and the daemon-path levels.

**Residual — DELIVERED (2026-06-25, loop-down operator session):** the dedicated run-end
**founder-suggestion artifact** (`FounderEscalation`-shaped, explicit *file-a-ticket | approve* options,
recommendedOption + evidenceRefs at the deb-response and the captured held change) now lands on the
interfering-held path for both the applied and directed-applied flows, routing
`deb-applied`/`deb-directed-running → founder-escalated → complete`. Per the **§3.2 "approve" decision
(option B)** pinned above, "approve" routes to the existing ticket/run path — Deb never commits interfering
code herself, so no new commit op; the held diff is captured (quarantined) and the working tree reverted to
HEAD so it cannot dangle. With this, **0055's reframed acceptance is fully met and 0055 is closed**; 0058
was already met and closed.

## 8. Tickets

D1–D5 are tracked as durable bug tickets: **0055** (D1), **0056** (D2), **0057** (D3), **0058** (D4),
**0059** (D5). D2/D3/D5 are closed by this session's work. **0055** (D1) was **reframed** from "subordinate
Deb-repair" to "implement the overseer model + interference check (§3)"; **0058** (D4) was **reframed** from
"prevent-vs-detect crux" to "keep detection + add the run-wrap audit assertion (§4)." Both are now **closed**:
the overseer build A–E plus the run-end founder-suggestion residual (§7) complete 0055; 0058 was met by the
FLAG-mode audit assertion (§4).
