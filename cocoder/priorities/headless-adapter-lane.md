---
id: headless-adapter-lane
title: Headless adapter lane for Claude Code + Codex (run headless Plays on any capable CLI)
---

> **Founder-directed 2026-06-15** — follow-on from `oz-dashboard-bugs` #11 and ticket 0006. The Oz
> dashboard correctly warns *"Headless Play on an interactive-only CLI — would hang"* when a headless
> Play (e.g. `code-review`, `wrap-up`) is bound to **Claude Code** or **Codex**, because those adapters
> don't yet emit a non-interactive command. But Claude Code and Codex CAN run headless (claude print
> mode; codex exec) — the adapter plumbing just isn't built. This priority builds it, so the warning
> disappears *correctly* (the capability becomes real) rather than by faking a flag.

## Objective

Teach the `claude` and `codex` adapters to build a real **headless (non-interactive)** invocation, wire
it through the dispatch paths, and make the `headlessCapable` capability flag truthfully `true` for them
— so a headless Play bound to Claude Code or Codex runs to completion instead of hanging, and the
dashboard's "would hang" warning correctly disappears for those CLIs.

Concretely (grounded in ticket 0006):

1. Add an optional `headless?: boolean` to `BuildInput` (`packages/core/src/adapter/types.ts`).
2. `claude.build()` headless branch → print mode: `claude -p "<prompt>" --output-format text [--model …]`,
   with stdout capture set so the runner gets a clean answer and the process exits.
3. `codex.build()` headless branch → the non-interactive `codex exec …` lane.
4. Set `headless` at the call sites that need it: `oz-host.ts` (always headless) and `dispatchPlay`
   (when `personaMode === 'headless'` or `play.kind === 'headless'`).
5. Flip `headlessCapable = true` on the claude + codex adapters **once the headless build path actually
   works** — single source: the dashboard data + warning derive from the adapter value (#11 already
   single-sourced this), so this is the one place to change it.
6. **Verify exact CLI flags against the installed `claude` / `codex` binaries before shipping** —
   cursor-agent's working `-p --output-format text` is the reference. Do not ship a flag set that hasn't
   been run against the real CLI (the cursor-agent auth/flag class, failure-catalog F10).

**Verified when:**

- New adapter unit tests cover the headless branch of `claude` and `codex` (assert the exact argv emitted).
- An end-to-end headless dispatch on each CLI runs a real prompt, **exits cleanly, and prints the answer
  to stdout** (no hang to timeout) — captured by a one-command proof harness
  (e.g. `scripts/proof-headless-lane.mjs`).
- `headlessCapable` is `true` for claude + codex; binding a headless Play (`code-review` / `wrap-up`) to
  Claude Code in the dashboard no longer shows the "would hang" warning.
- Oz-on-`claude` becomes a valid assignment, and the latent `integration-verify` / `merge-conflict`
  headless-Play pins to `claude` (assignments.json) stop being latent hangs (ticket 0006).
- Renderer + daemon + adapter test suites and builds stay green.

## Status — archive-candidate (run_104, 2026-06-16)

All "Verified when" criteria met and evidence-backed:
- Adapter unit tests assert the exact headless argv for `claude` + `codex` (atom 0, `dd2f518`).
- `scripts/proof-headless-lane.mjs` runs a real prompt on each CLI headless → exits 0, answer captured
  (claude via stdout, codex via `--output-last-message`); ran green this run (PASS claude, PASS codex).
- `headlessCapable = true` for both; the dashboard "would hang" warning no longer fires for them
  (regression-guarded by `app.test.tsx`, which still fires it for an interactive-only CLI, `gemini`).
- Oz-on-`claude` and the `integration-verify`/`merge-conflict` headless pins are no longer latent hangs.
- adapters 20 · ui 111 · core 266 · daemon 194 + typecheck green.

No build atoms remain. Awaiting founder `archive` confirmation (no self-archive). Closes ticket 0006.

## Scope / boundary

Adapter + core-contract + dispatch change (`packages/adapters`, `packages/core`, `packages/daemon`),
plus the capability-flag flip surfaced in `packages/ui`. Does **not** change the warning's render logic
(already correct) or Play semantics. Closes **ticket 0006**; delivers the founder's bug #11 intent
("any CLI that can *actually* run headless should run headless").

## Conflict scan (ADR-0010)

- `packages/core/src/adapter/types.ts` already advertises "build a headless invocation" — this makes the
  two interactive adapters honor the existing contract; it's implementation catch-up, not a contract change.
- No ADR reversal: nothing decided that claude/codex must stay interactive-only — the limitation was
  unbuilt plumbing, not a recorded decision.
- Downstream of `oz-dashboard-bugs` #11 (which single-sourced the capability data to the adapters): this
  flips the source value truthfully once the lane works. No collision with the #11 fix.
