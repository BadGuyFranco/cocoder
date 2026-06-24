# Oz Flat-File Access Research

## Scope

This memo evaluates how Oz should get read access to governed flat files: Playbooks, ADRs,
persona/standards, and workspace config. It covers two delivery mechanisms:

- Option A: add governed-file summaries to Oz's session-start/Refresh digest.
- Option B: add a bounded read-only Oz tool, `readGoverned(path)`.

The current code does not have a separate static digest artifact. Oz receives a freshly assembled
prompt on each headless Oz turn; Refresh restarts the daemon and therefore creates a fresh daemon-local
session on the next turn.

## 1. Session-Start Digest Path

Founder chat enters the daemon through `POST /oz/messages`, where `dispatchMutations()` reads JSON and
calls `handleOzMessage()` (`packages/daemon/src/routes.ts:872-880`). The UI live path is
`App.onSend()` -> `sendOzMessage()` -> `oz.chatSend()` -> main-process `ozChat()` posting to
`/oz/messages` (`packages/ui/src/renderer/App.tsx:343-366`,
`packages/ui/src/renderer/live.ts:92-95`, `packages/ui/src/main/daemon-client.ts:101-119`).

`handleOzMessage()` parses direct typed commands first; unknown text with a `workspaceId` is routed to
the natural-language Oz agent via `tryHandleOzAgentTurn()` (`packages/daemon/src/oz-chat.ts:115-128`).
`tryHandleOzAgentTurn()` resolves the target workspace/persona, obtains the daemon-local Oz session,
enforces one in-flight turn per workspace session, and calls `runToolLoop()` (`packages/daemon/src/oz-host.ts:69-87`).

The session is created lazily, not at daemon boot. `getSession()` keys by `cocoderHome` and
`workspaceId`, initializes an empty transcript and turn counter, and stores it in the module-level
`sessions` map (`packages/daemon/src/oz-host.ts:449-455`). The file comments state this is
daemon-local and Refresh drops transcript by restarting the daemon (`packages/daemon/src/oz-host.ts:66`).

The exact prompt assembly owner is `buildPrompt()` in `packages/daemon/src/oz-host.ts`. It reads:

- priorities from `<workspace>/cocoder/priorities` with `PRIORITIES_CAP = 1_000`
  (`packages/daemon/src/oz-host.ts:24`, `packages/daemon/src/oz-host.ts:193-195`);
- runs from `ctx.store.listRuns({ workspaceId })`, with portable display numbers
  (`packages/daemon/src/oz-host.ts:195`);
- tickets from `<workspace>/cocoder/tickets` (`packages/daemon/src/oz-host.ts:196-200`);
- dragged context pointers through `parsePromptInput()` (`packages/daemon/src/oz-host.ts:201-205`).

It then emits the sections in this order: `## Oz persona`, `## Facts digest`, optional
`## Requested context`, `## Recent transcript`, the current input section, and `## Turn instructions`
(`packages/daemon/src/oz-host.ts:206-218`). Governed-file summaries for Option A would fit either by
extending `factsDigest(awareness)` at `packages/daemon/src/oz-host.ts:209-210`, or by inserting a new
section between `## Facts digest` and `## Requested context` at `packages/daemon/src/oz-host.ts:209-211`.
The latter is cleaner because governed file summaries are not part of `OzAwarenessSnapshot`, whose
current fields are priorities, recent runs, active runs, and open tickets
(`packages/daemon/src/oz-awareness.ts:8-13`).

The current facts digest is deliberately small. `factsDigest()` shows only the first 10 priorities,
first 10 recent runs, and first 10 open tickets (`packages/daemon/src/oz-host.ts:389-404`). It prints
priority id/title only, run status/priority/timestamps, and ticket id/title/type/priority/owner/created
(`packages/daemon/src/oz-host.ts:392-413`). Although priority goals are loaded and truncated to 1,000
characters in `readPriorityFiles()` (`packages/daemon/src/priority-order.ts:54-73`), the current
`factsDigest()` does not print priority goals.

The transcript budget is also bounded by code: `TRANSCRIPT_LIMIT = 20`, and `appendTranscript()` drops
older entries past that limit (`packages/daemon/src/oz-host.ts:22`, `packages/daemon/src/oz-host.ts:427-430`).
Tool loops are bounded by `TOOL_ROUND_LIMIT = 10` (`packages/daemon/src/oz-host.ts:25`,
`packages/daemon/src/oz-host.ts:115-133`). There is no explicit token budget constant for the final
prompt; the practical budget is the adapter/model context window plus these local caps.

Approximate current size evidence from this tree (run_75 recount): **113 governed files, ~904 KB**
total across `cocoder/decisions/` (39), `cocoder/priorities/` (50), `cocoder/personas/` (5),
`cocoder/standards/` (1), and `packages/personas/base/` (18). Full load ≈ **~226K tokens** — exceeds
per-turn context budget. Even a selective digest adds ~18K tokens/turn (~2× the current ~8–10 KB
facts digest). The Objective's `cocoder/playbooks/` zone is absent (Plays live under
`packages/personas/base/plays/`). Therefore full-body Option A is ruled out; summary-only Option A
still cannot answer detail questions without another access path.

Refresh is tool-driven or UI-driven. The model-facing prompt lists `refresh {}` as an available tool
and says it restarts the daemon to refresh Oz (`packages/daemon/src/oz-host.ts:221-233`). Tool
validation maps `refresh` to `{ kind: 'refresh' }` (`packages/daemon/src/oz-host.ts:297-314`), and a
successful refresh short-circuits the tool loop without a follow-up model turn (`packages/daemon/src/oz-host.ts:126-132`).
`executeOzCommand()` dispatches refresh to `ops.restartDaemon(ctx)` (`packages/daemon/src/oz-chat.ts:131-138`),
and the default op is `requestDaemonRestart` (`packages/daemon/src/oz-chat.ts:73-85`).
`requestDaemonRestart()` refuses while any run is in flight, appends an audit record, calls
`ctx.restartDaemon()`, and returns `202` (`packages/daemon/src/launcher.ts:1303-1316`). The UI Restart
Oz button follows the same daemon restart path (`packages/ui/src/renderer/App.tsx:665-681`,
`packages/ui/src/renderer/live.ts:122-126`, `packages/daemon/src/routes.ts:943-945`).

Tests pin the current prompt shape. The agent-chat test asserts free text builds a prompt containing the
Oz persona, facts, transcript, founder text, and turn log (`packages/daemon/tests/oz-agent-chat.test.ts:24-43`);
it asserts tickets newly present on disk appear in the facts digest
(`packages/daemon/tests/oz-agent-chat.test.ts:45-57`); and it asserts dragged priority context injects a
file path reference without embedding the file body (`packages/daemon/tests/oz-agent-chat.test.ts:59-72`).
Refresh behavior is pinned as a tool that restarts through ops and returns a fresh-session/transcript
reset reply (`packages/daemon/tests/oz-agent-chat.test.ts:624-648`).

## 2. Bounded Tool Surface

Oz's callable model-facing tool surface is currently a fixed string union plus prompt text. The tool
names are defined in `ToolName`: `launch`, `adhoc`, `show`, `stop`, `nudge`, `repair`, `oz-action`,
`author`, `teardown`, `status`, and `refresh` (`packages/daemon/src/oz-host.ts:63-64`). The prompt text
that advertises them to Oz lives in `toolInstructions()` (`packages/daemon/src/oz-host.ts:221-233`).

Model output is parsed as a final `OZ_TOOL ...` line by `parseToolLine()` (`packages/daemon/src/oz-host.ts:278-293`).
`validateToolCall()` converts that parsed tool call into an `OzExecutableCommand`
(`packages/daemon/src/oz-host.ts:295-319`), with helpers for structured validation such as
`validateRepairTool()` (`packages/daemon/src/oz-host.ts:345-359`). `isToolName()` is the final allow-list
check (`packages/daemon/src/oz-host.ts:374-376`). `executeTool()` then calls the injected
`OzCommandExecutor` and converts the result into a model-visible summary
(`packages/daemon/src/oz-host.ts:378-387`). The tests prove a launch tool dispatches through injected
ops and a plain answer executes no tools (`packages/daemon/tests/oz-agent-chat.test.ts:178-221`).

The daemon command contract lives in `oz-chat.ts`. `OzCommand` and `OzExecutableCommand` are the typed
command union (`packages/daemon/src/oz-chat.ts:14-31`), `OzChatAction` is the UI action contract
(`packages/daemon/src/oz-chat.ts:33-48`), and `OzChatOps`/`defaultOps` register the operation functions
behind executable commands (`packages/daemon/src/oz-chat.ts:59-85`). `executeOzCommand()` is the
dispatcher from command kind to op (`packages/daemon/src/oz-chat.ts:131-271`).

A new read-only `readGoverned(path)` tool would be registered in four places:

1. add `'readGoverned'` or `'read-governed'` to `ToolName` and `isToolName()`
   (`packages/daemon/src/oz-host.ts:63-64`, `packages/daemon/src/oz-host.ts:374-376`);
2. add it to `toolInstructions()` (`packages/daemon/src/oz-host.ts:221-233`);
3. add a validation branch in `validateToolCall()` that requires a string `path`
   (`packages/daemon/src/oz-host.ts:297-319`);
4. add `{ kind: 'read-governed'; path: string }` to `OzCommand`, include a handler branch in
   `executeOzCommand()`, and either add an `OzChatOps.readGoverned` op or keep the read handler local to
   `oz-chat.ts` if it only needs `ctx` and `workspaceId` (`packages/daemon/src/oz-chat.ts:14-31`,
   `packages/daemon/src/oz-chat.ts:59-85`, `packages/daemon/src/oz-chat.ts:131-271`).

The existing path-safety patterns to reuse are:

- `matchesAny()` normalizes relative paths and default-denies an empty allow-list
  (`packages/core/src/write-scope/glob.ts:26-29`);
- `partitionByScope()` separates paths by an allow-list through `matchesAny()`
  (`packages/core/src/write-scope/partition.ts:18-24`);
- `OZ_ACTION_SCOPE` is an existing single-owner allow-list for a bounded Oz operation
  (`packages/core/src/write-scope/oz-action.ts:1-17`);
- the daemon static-file server refuses traversal by resolving a joined path and checking it remains
  under the allowed root (`packages/daemon/src/static.ts:21-28`).

For `readGoverned(path)`, the allow-list should be a new single-owner constant, not copied into prompt
text and tests. The allowed zones from the atom are:

- `cocoder/decisions/`
- `cocoder/priorities/`
- `cocoder/personas/`
- `cocoder/playbooks/`
- `packages/personas/base/`

The read handler should resolve the requested path relative to the selected workspace root for
`cocoder/**` zones and relative to `ctx.cocoderHome` for `packages/personas/base/**`, reject absolute
paths, normalize to POSIX-style repo-relative paths, reject traversal, require `matchesAny(rel,
GOVERNED_READ_SCOPE)`, then `readFile()` the resolved target. The current static-file traversal check is
the closest direct read-path precedent (`packages/daemon/src/static.ts:21-28`); the write-scope matcher is
the closest allow-list precedent (`packages/core/src/write-scope/glob.ts:26-29`).

## 3. Option A vs Option B

| Dimension | Option A: session/Refresh digest summaries | Option B: bounded `readGoverned(path)` tool |
| --- | --- | --- |
| Files changed / rough size | Small implementation if summary-only: `packages/daemon/src/oz-host.ts` plus a helper or shared owner for enumerating governed summaries, and tests in `packages/daemon/tests/oz-agent-chat.test.ts`. Expect roughly 100-200 lines if it only emits filenames/headings/mtimes. Full-body injection would be larger and should be rejected because current code only embeds compact facts (`packages/daemon/src/oz-host.ts:389-404`). | Moderate but still local: `packages/daemon/src/oz-host.ts` for tool name/instructions/validation, `packages/daemon/src/oz-chat.ts` for command/action/dispatch, likely one helper module for path normalization/reading, and daemon tests. Expect roughly 150-300 lines with tests, depending on whether the allow-list lives in core beside `OZ_ACTION_SCOPE` (`packages/core/src/write-scope/oz-action.ts:1-17`). |
| Context-budget impact | Always paid on every Oz turn because `buildPrompt()` emits the digest into the prompt every time (`packages/daemon/src/oz-host.ts:193-218`). Current digest caps displayed items at 10 per category and transcript at 20 entries (`packages/daemon/src/oz-host.ts:389-404`, `packages/daemon/src/oz-host.ts:427-430`). Summary-only can stay cheap; full governed bodies would add about 689 KB in this tree. | Paid only when Oz asks for a file. The prompt cost is a one-line tool instruction plus tool-result text after a call (`packages/daemon/src/oz-host.ts:221-233`, `packages/daemon/src/oz-host.ts:378-387`). A per-call byte cap should be added so one large ADR cannot dominate a follow-up turn. |
| Staleness behavior | Rebuilt each model turn from disk, not only at daemon boot (`packages/daemon/src/oz-host.ts:193-218`), so it reflects changes visible to the daemon process. Refresh creates a new daemon-local session and resets transcript (`packages/daemon/src/oz-host.ts:66`, `packages/daemon/src/oz-chat.ts:491-498`). If summaries are cached, cache invalidation becomes a new risk. | Reads the file at call time, so it is as fresh as the workspace checkout and does not require Refresh for governance content. Refresh is still needed for daemon/runtime code changes because restart is the existing reload mechanism (`packages/daemon/src/launcher.ts:1303-1316`). |
| Scope/security surface | Low if it only emits preselected summaries from known directories; higher if it starts embedding arbitrary file bodies. It expands passive exposure because every Oz turn receives the summaries whether needed or not. | Explicit new read surface, so it needs a hard path guard. The guard can reuse the repo's default-deny matcher (`packages/core/src/write-scope/glob.ts:26-29`) and traversal-safe resolve pattern (`packages/daemon/src/static.ts:21-28`). Tests must prove out-of-zone paths are refused. |
| Per-question cost / round-trips | Zero extra tool round-trips for questions answerable from the summary. One normal model turn can answer. Detail questions still fail or require launching/repairing unless summaries include too much body text. | One extra tool round-trip for a detail read: Oz calls `readGoverned`, receives the result, then answers in the follow-up turn. The loop already supports this pattern up to 10 tool rounds (`packages/daemon/src/oz-host.ts:115-133`). |

Hybrid viability: yes. Add a tiny governed-file index to the digest, not file bodies: zone, relative path,
title/frontmatter/first heading, and maybe byte size or mtime. Pair it with `readGoverned(path)` for
body reads. This gives Oz enough discovery context to choose the right file while keeping the default
prompt close to the existing compact digest model.

## 4. Recommendation

**Recommend Option C (hybrid), weighted toward Option B's read tool as the core.** The corpus sizing
above rules out full-body Option A; a selective digest alone still ~2× the current facts budget and
stays stale between refreshes. Option B alone is the cheapest build (`matchesAny` + four-place tool
registration already proven in `oz-host.ts` / `oz-action-scope.test.ts`). Option C adds a thin index
(ADR titles + active priority list, ~2–5K tokens) to `buildPrompt()` so Oz knows *what* exists, plus
`readGoverned(path)` for full bodies on demand — best founder UX without budget blowup.

Smallest provable build for Option C (Option B steps 1–5, plus thin-index injection in `buildPrompt()`):

1. Add `GOVERNED_READ_SCOPE` as the single owner of allowed zones:
   `cocoder/decisions/**`, `cocoder/priorities/**`, `cocoder/personas/**`,
   `cocoder/playbooks/**`, and `packages/personas/base/**`.
2. Add a pure helper, for example `readGovernedFile({ workspacePath, installRoot, path })`, that rejects
   absolute paths and traversal, normalizes the resolved repo-relative path, checks `matchesAny()`, and
   returns a capped UTF-8 body plus metadata.
3. Register `readGoverned` in `oz-host.ts` validation/instructions and `oz-chat.ts` command dispatch.
4. Add tests for accepted reads, missing files, absolute paths, `../` traversal, `local/**`, `.env`, and
   `packages/daemon/**` rejection.
5. For Option C: inject a thin governed-file index (zone, path, title/frontmatter) into `buildPrompt()`
   between `## Facts digest` and `## Requested context` (~2–5K tokens cap).
6. Add a proof script such as `scripts/proof-oz-governed-read.mjs` that creates a temp workspace,
   invokes the pure helper or daemon command with allowed and refused paths, and exits nonzero unless
   all outside-zone paths are refused. The script should specifically prove `local/settings.json`,
   `../CoCoder/local/settings.json`, `.env`, and `packages/daemon/src/oz-host.ts` are rejected while an
   allowed ADR or priority path is returned. Live demo exchange: e.g. "what does ADR-0017 say about the
   refresh verb?"

Minimum verification for that build: the focused daemon Oz agent tests, the new path-helper tests, the
new proof script, `pnpm typecheck`, and `node scripts/check-topology.mjs`.

**Founder gate:** ratify A, B, or C before any build atom (Objective research gate). Oscar recommends C.
