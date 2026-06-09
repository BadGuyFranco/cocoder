# ADR-0018 — Persona run-mode and sub-agents: what the runner honors

**Status:** Proposed (drafted by Claude in the founder-directed session of 2026-06-09; founder
review owed before any build — this is the "persona `{mode, subAgents}` runner-honoring gap" named
in [`full-oz-dashboard`](../../priorities/full-oz-dashboard.md) owed-surface #4).
**Builds on:** [0005](./0005-personas-and-subtasks.md) (personas + Plays), [0006](./0006-adapter-contract.md)
(adapter contract), [0017](./0017-oz-orchestration-persona.md) (Oz is a persona).

## Context

The Personas screen renders two fields from the V1 design (design-ref dev-notes 13/14) that today go
nowhere: **run-mode** (`visible` | `headless`) and a **sub-agent hierarchy** (per-persona subs, each
with its own CLI + model — "Bob → formatter sub on Haiku"). The UI is honest about it (the banner
says edits are local previews), but the fields have no home in `assignments.json` and the runner
reads only `cli` / `model` / `enabled` / `plays`. The choice is: extend the schema and honor the
fields, or keep them previews forever. Two design tensions must be settled first:

1. **Vocabulary (D4 — one concept, one home).** ADR-0005 already has the delegation concept: **Plays**
   — a shared registry of delegatable procedures, with per-persona play assignments carrying exactly
   `{cli, model}`. The design's "sub-agents" describe the same shape. Building a parallel `subAgents`
   structure beside `plays` would be the F1-style duplicate concept the charter forbids.
2. **Mechanics.** `visible` is today's cmux pane (the founder watches the native TUI). `headless`
   exists as a mechanism — headless Plays run as captured subprocesses (`e8b9848`) — but the
   orchestration loop's monitor, sentinel detection, and nudge delivery all assume a pane
   (`readScreen` / `sendInput`). A headless **Bob** is not honorable until the monitor has a
   captured-subprocess equivalent; flipping the toggle must never silently degrade observation.

## Decision (proposed)

1. **Sub-agents ARE per-persona Play assignments.** The UI's sub-agent hierarchy becomes a surface
   over the existing `plays` map in `assignments.json`: "+ Add sub-agent" = assign a Play (existing,
   or authored via the create flow) to that persona with its own `{cli, model}`. No new `subAgents`
   field anywhere. *Founder question to settle: is any intended sub-agent NOT a Play (a free-form
   standing delegate rather than a procedure)? If yes, this model is too small and the ADR needs a
   second pass.*
2. **Run-mode persists as `mode: 'visible' | 'headless'`** in the persona assignment, and the runner
   honors it the same slice it lands: `visible` → cmux pane (today's behavior, the default);
   `headless` → captured-subprocess session. **Honoring order:** Plays/sub-agents first (they already
   run headless), then Oscar (file-artifact handshakes — directives/verifies — already work without a
   pane), and Bob **last**, only after the monitor's captured-subprocess path exists. Oz's mode is
   governed by ADR-0017 (its window IS the app).
3. **The truthfulness rule.** Until a field is honored end-to-end, it does not persist: no
   "saved-but-inert" configuration, ever. The current preview banner stays until then; schema,
   save-path (`saveAssignments` exists, unwired), daemon response shape, and runner consumption land
   together or not at all.

## Consequences

- Kills the parallel-concept risk before it ships; the UI work becomes adapter/rendering work over
  `plays`, not a schema invention.
- The monitor-for-headless-builders seam is named as the real cost of honoring `mode` for Bob — it is
  build-work under this ADR when accepted, not a surprise mid-slice.
- `enabled: false` (today rendered as "headless" in the UI adapter) is untangled: `enabled` means
  *not staffed*, `mode` means *how the session is hosted*. The UI stops conflating them.
