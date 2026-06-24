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

**MECHANISM RATIFIED — Option B (founder, 2026-06-24, run_75).** The founder chose the scoped
`readGoverned(path)` tool and explicitly **rejected a table-of-contents / index / digest-enrichment**
(the hybrid "C" that research had floated): a TOC is a second copy that drifts, and **the repo is the
single source of truth**. Implication for the build: **every lookup reads live from disk** — no cached
index, no generated manifest, no digest enrichment. The research gate is CLOSED; the next session
goes straight to the build atom below.

### Build plan for `readGoverned` (Option B) — ready to delegate
Research established the pattern (run_75). One cohesive atom:
1. **Scope constant.** Define `GOVERNED_READ_SCOPE` (single source of truth for this surface) alongside
   `OZ_ACTION_SCOPE` in `packages/core/src/write-scope/`, covering the governed zones that actually
   exist: `cocoder/decisions/**`, `cocoder/priorities/**`, `cocoder/personas/**`,
   `packages/personas/base/**`, plus `cocoder/standards/**` (and `cocoder/playbooks/**` only if present).
2. **Tool surface, end-to-end.** Add `read-governed` to Oz's bounded surface in
   `packages/daemon/src/oz-host.ts`: the `ToolName` union (~L64), a `validateToolCall()` case requiring a
   string `path` (~L297-319), a `toolInstructions()` entry for the JSON signature (~L226), and the
   `executeTool()` dispatch (~L378). Wire the dispatch through `executeOzCommand()` in
   `packages/daemon/src/oz-chat.ts`, following the existing read-only verbs (`show`/`status`/`refresh`).
3. **Handler (read-only).** In `packages/daemon/src/launcher.ts`, resolve the path relative to the repo
   root, reject `..` traversal/absolute escapes, then **default-deny** with
   `matchesAny(path, GOVERNED_READ_SCOPE)` (reuse the exported, tested helper from `@cocoder/core`
   — write no new glob code). Allowed → read the file live and return content; denied → clear error,
   file NOT read. No write/commit path.
4. **Proof.** Tests pin both directions: an in-zone read returns real content (e.g. an ADR under
   `cocoder/decisions/`); out-of-zone (`packages/core/src/...`, `packages/daemon/src/...`, run/event
   state) **and** traversal (`cocoder/decisions/../../packages/daemon/src/oz-host.ts`) are rejected.
   Plus a live demo exchange (Oz answers an ADR/persona question in-session). See `oz-action-scope.test.ts`
   for the scope-check test pattern.

A fully-scoped delegate directive for this atom was drafted this run at
`local/runs/run_219/directive-1.json` (kind: delegate); a fresh build session can reuse it verbatim.

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

**Disposition: `continue`.** Founder follow-up landed run_75. Primary Objective is **unblocked**:
the founder ratified **Option B** (scoped `readGoverned(path)`, read live from disk; no TOC/index/cache
— repo is SSOT) on 2026-06-24. Next session relaunches this priority as a **build run** and delegates
the single `readGoverned` atom in the Build plan above (directive scaffold at
`local/runs/run_219/directive-1.json`). No remaining founder decision.
