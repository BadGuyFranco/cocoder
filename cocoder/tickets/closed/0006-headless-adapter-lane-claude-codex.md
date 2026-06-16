---
id: 0006
title: Headless adapter lane for claude/codex (Oz-on-claude; fixes headless Plays pinned to interactive CLIs)
type: bug
status: Closed
priority: headless-adapter-lane
owner: founder-session 2026-06-14
created: 2026-06-14
closed: 2026-06-16
---

> **Resolved 2026-06-16 (run_104).** Headless lane built for both adapters: `claude.build()` print mode
> (`claude -p --output-format text …`) and `codex.build()` → `codex exec … --output-last-message`, wired
> through `dispatchPlay` + `oz-host` via `BuildInput.headless`. `headlessCapable = true` for claude+codex
> (single source). Flags verified against the real binaries; `scripts/proof-headless-lane.mjs` re-proves
> both run headless and exit cleanly. Oz-on-claude and the integration-verify/merge-conflict headless pins
> are no longer latent hangs. Commits `dd2f518` (atom 0) + `336fb20` (atom 1). Note: current
> `assignments.json` had `integration-verify`→`codex` (not `claude`) — the flag flip made it valid with no
> assignments edit needed.

> **2026-06-15:** promoted to its own launchable priority — see
> [`headless-adapter-lane`](../../priorities/headless-adapter-lane.md). This ticket is the technical
> detail; the priority carries the Objective + verification for a fresh run.

# 0006 — Headless adapter lane for claude/codex

## Context
Found during the Oz dashboard defect sweep (`oz-dashboard-bugs`, Bug 1). The adapter contract
(`packages/core/src/adapter/types.ts`) advertises "build a **headless** invocation," but only the
`cursor-agent` adapter actually does: `claude` and `codex` `build()` produce **interactive TUI**
commands (claude `--permission-mode acceptEdits -- <prompt>`; codex
`--dangerously-bypass-approvals-and-sandbox <prompt>`) that never exit and don't print a clean answer
to stdout. Anything that runs them via `runHeadlessProcess` (captured subprocess, await exit) hangs to
timeout.

Two live consequences:
1. **Oz chat (Bug 1):** the headless Oz agent turn (`packages/daemon/src/oz-host.ts`) only works on a
   headless CLI. Oz was assigned `cursor-agent` to ship the fix; it cannot currently run on `claude`.
2. **Latent Play hang:** `assignments.json` pins Oscar's `integration-verify` and `merge-conflict`
   (both `kind: headless` Plays) to `claude`. `dispatchPlay` runs `kind: headless` Plays as captured
   subprocesses — so if either dispatches, the interactive claude command would hang until the Play
   timeout. Only `wrap-up`→`cursor-agent` is safe today.

## Ask
Add a real headless lane to the claude/codex adapters:
- Add an optional `headless?: boolean` to `BuildInput` (core).
- `oz-host.ts` always sets it; `dispatchPlay` sets it when `personaMode==='headless' || play.kind==='headless'`.
- `claude.build()` headless → print mode (`claude -p … --output-format text [--model]`, `stdoutPath` set);
  `codex.build()` headless → `codex exec …` (the non-interactive lane). Verify exact flags against the
  installed CLIs before shipping (cursor-agent's `-p --output-format text` is the working reference).
- Tests for the headless branch of each adapter; then Oz-on-claude becomes a valid assignment and the
  integration-verify/merge-conflict pins stop being a latent hang.

## Boundary
Adapter + core-contract + dispatch change. Behind it, the founder's "claude path next" choice (Bug 1)
is satisfied. Until then, keep headless lanes (Oz, headless Plays) on `cursor-agent`.
