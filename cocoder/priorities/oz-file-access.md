---
id: oz-file-access
title: Oz flat-file access — answer config/ADR/playbook questions directly
---

## Objective

Give Oz the ability to read governed flat files (Playbooks, ADRs, persona/standards, config) so it can
answer founder questions about governance and configuration without requiring an adhoc session. Today Oz's
context is populated at session start from runtime state; questions like "what does ADR-0017 say about the
refresh verb?" or "what's in the Oscar persona definition?" require a separate adhoc launch to look them up.

**First research gate — choose and validate the delivery mechanism:**

- **Option A — Enrich the loaded digest.** At Oz session start (or Refresh), pull relevant governed-file
  content into the prompt: summarized ADRs, persona definitions, active priority list, workspace config.
  Advantage: no new tool surface, no request round-trip per question. Constraint: context budget grows with
  the corpus; stale between refreshes.
- **Option B — Scoped read-file tool.** Add a `readGoverned(path)` tool to Oz's bounded surface, accepting
  only paths under the repo's governed zones (`cocoder/decisions/`, `cocoder/priorities/`,
  `cocoder/personas/`, `cocoder/playbooks/`, `packages/personas/base/`). Advantage: Oz fetches on demand,
  corpus growth does not inflate every session. Constraint: one more tool call per lookup; path surface must
  be scope-checked.

The first run researches both, picks one (or a hybrid), and ratifies the mechanism with the founder before
any build atom is delegated.

**Verified when:** the founder can ask Oz a question about a governed flat file ("what does ADR-0017 say
about information-source doctrine?" / "show me the Oscar base persona") and Oz answers correctly, in-session,
without launching an adhoc. Verified by a live demo exchange and, where Option B is chosen, a proof that
`readGoverned` rejects paths outside the governed zones.

**Boundary:** read-only access to governed flat files in the CoCoder repo. Oz does not gain write access to
governed files through this surface (repair writes remain the existing repair verb). Scope does not extend to
product code (`packages/core/src/`, `packages/daemon/src/`, etc.) or workspace-local state (run records,
event streams).

## Founder-added follow-up — surface the launch disposition in Oz (run_200, 2026-06-23)

**Status: DONE (run_75).** `DebStatus.wrapDisposition` projects the latest recorded `wrap-disposition`
event into Oz's founder-facing run surface (`renderDebStatus` in `packages/core/src/runner/status.ts`);
no recomputation — `deriveWrapDisposition` remains the single owner. Verified by status tests.

Carried here when `launch-disposition-first` was archived. That priority shipped a recorded
`wrap-disposition` event (`archive-candidate` | `awaiting-founder` | `continue`) — see
`deriveWrapDisposition` in `packages/core/src/runner/runner.ts`, proven by
`node scripts/proof-launch-disposition.mjs`. Run_75 projected the latest event into Oz's
`DebStatus` / run-list surface via `wrapDisposition` (read from the event stream, not recomputed).

**Disposition: `continue`.** Founder follow-up landed run_75. Primary Objective awaits founder
ratification of the delivery mechanism (A/B/C; research recommends hybrid C — thin index plus
`readGoverned(path)`). Relaunch for build atoms once ratified.
