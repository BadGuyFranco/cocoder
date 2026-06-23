---
id: 0033
title: Deb repair dialogue fails with "stdin is not a terminal" (non-TTY/headless invocation)
type: bug
status: Closed
priority: none
owner: Deb
created: 2026-06-23
closed: 2026-06-23
---

# 0033 — Deb repair dialogue fails with "stdin is not a terminal" (non-TTY/headless invocation)

## Resolution

Resolved by the daemon repair-dialogue turn using the existing headless adapter lane (`headless: true`) and
preserving adapter-owned response artifacts such as Codex `exec --output-last-message` output. Regression
coverage in `packages/daemon/tests/oscar-deb-repair-op.test.ts` proves a codex-like non-TTY turn produces a
real `deb-response.json` while verbose stdout is kept in `deb-turn.log.stdout`.

Verification:
- `pnpm --filter @cocoder/daemon exec vitest run tests/oscar-deb-repair-op.test.ts tests/oscar-deb-repair.test.ts`
- `pnpm --filter @cocoder/daemon exec tsc --noEmit -p tsconfig.json`

## Context

The ADR-0036 Oscar↔Deb repair-dialogue capability cannot run from the daemon-resident command path. Invoking

```
cocoder oz request-deb-repair cocoder --run run_194 --problem "..."
```

returned HTTP 500 with `"deb repair dialogue turn failed with exit code 1"` and `"state":"failed"`. The Deb
turn log
(`local/oz/cocoder/repair-dialogues/repair-1782213894756-923aba/deb-turn.log`) contains exactly:

```
Error: stdin is not a terminal
```

Deb is assigned the `codex` CLI (`cocoder/personas/assignments.json`). The repair-dialogue path appears to
spawn Deb's CLI expecting an interactive TTY, but the daemon-resident invocation provides none, so the turn
dies immediately and the dialogue is recorded as `failed` with no Deb response, no Oscar evaluation, and no
commit.

This blocks the entire propose→evaluate→direct repair lane (ADR-0036): when Oscar identifies a real machinery
issue and tries to task Deb, the dialogue cannot even start.

## Acceptance

`cocoder oz request-deb-repair <workspaceId> --problem <text>` runs Deb's turn headlessly (no TTY required)
and produces a real `deb-response.json`, exactly as the headless adapter lane already does for runs. Proven by
a successful repair-dialogue invocation that returns a Deb proposal/response artifact, and a regression test
that exercises the repair-dialogue spawn in a non-TTY environment.

## Notes

- Strongly resembles ticket 0006 (headless adapter lane for claude/codex — "latent pins no longer hang"). The
  repair-dialogue path (newer, ADR-0036) likely does **not** route Deb's codex invocation through that
  headless lane and instead spawns it interactively. Fix probably = route the repair-dialogue Deb turn through
  the same headless adapter lane (codex exec / print mode) as run dispatches.
- Filed because this is the machinery that was supposed to fix ticket 0032 quickly; with the lane down, 0032
  needs a verified run or a daemon-side fix to the repair lane first.
