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

### Build plan for `readGoverned` (Option B) — DONE (run_76, `18c5607`)
Research established the pattern (run_75). One cohesive atom — **landed run_76:**
1. **Scope constant.** `GOVERNED_READ_SCOPE` in `packages/core/src/write-scope/governed-read.ts`
   (`cocoder/decisions/**`, `cocoder/priorities/**`, `cocoder/personas/**`,
   `packages/personas/base/**`, `cocoder/standards/**`); exported from `@cocoder/core`.
2. **Tool surface, end-to-end.** `read-governed` on Oz's bounded surface (`oz-host.ts` validation +
   instructions; `oz-chat.ts` command dispatch).
3. **Handler (read-only).** `readGoverned()` in `launcher.ts`: normalize repo-relative path, reject
   traversal/absolute/NUL before any read, default-deny via `matchesAny(path, GOVERNED_READ_SCOPE)`,
   read live from disk; no write/commit path.
4. **Proof (automated).** Tests pin in-zone reads, out-of-zone rejection, and traversal rejection
   (`governed-read-scope.test.ts`, `read-governed.test.ts`, dispatch coverage in `oz-chat.test.ts` /
   `oz-agent-chat.test.ts`). **Live in-session demo** remains founder-driven (see disposition below).

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

**Disposition: `archive-candidate` (run_76).** Option B is code-complete and automated proof is green.
The Objective's live acceptance gate — Oz answers a governed-file question in the dashboard chat without
an adhoc launch — requires a founder-driven Oz session; Oscar cannot operate the daemon surface. On
successful live confirmation, founder may archive this priority. Optional follow-on (founder choice only):
record the `read-governed` surface in an ADR amendment before archive.
