# Oz Streaming Design

Design and capability probe for Oz response streaming and show-thinking-if-available. This is a
read-only design artifact for item 1, part B; it does not change runtime behavior.

## Codex Capability Probe

Installed CLI:

```text
$ codex --version
codex-cli 0.137.0
```

The installed `codex exec` supports a JSONL event mode and the existing clean final-message artifact:

```text
$ codex exec --help | rg -n -- "--json|output-last-message|experimental|reason|thinking|event|stream"
92:      --json
93:          Print events to stdout as JSONL
95:  -o, --output-last-message <FILE>
```

There is no documented `--experimental-json`, event-stream, thinking, or reasoning flag in
`codex exec --help`. A direct probe for the likely reasoning flag fails:

```text
$ codex exec --include-reasoning --help
error: unexpected argument '--include-reasoning' found

  tip: a similar argument exists: '--ignore-user-config'
```

Top-level `codex --help` shows experimental `app-server`, `remote-control`, and `exec-server`
commands, but no `codex exec` reasoning/thinking flag.

Verdict:

- `codex exec` can emit a stdout JSONL event stream (`--json`). That is the viable streaming
  capability to probe deeper and consume.
- The installed CLI does not expose reasoning/thinking tokens as a distinct stream. Thinking must be
  modeled as optional and absent for this Codex version.
- Do not fake streaming by chunking the completed `reply` after `POST /oz/messages` returns. That would
  only animate latency after the wait, not make Oz observable while it is thinking or answering.

## Artifact Completion Tradeoff

ADR-0006 sets the adapter posture: per-CLI drivers invoke headlessly, pass prompt/model, capture
output, and detect completion (`cocoder/decisions/0006-adapter-contract.md:16`). It also keeps the
trust boundary outside the CLI: CoCoder runs trusted local CLIs and enforces write boundaries with its
own checks (`cocoder/decisions/0006-adapter-contract.md:21`).

The current code follows that artifact-completion posture:

- `BuildInput.outPath` is "where the CLI's structured completion artifact should land" and "the runner
  reads it after exit" (`packages/core/src/adapter/types.ts:14`).
- `CodexAdapter` adds `--output-last-message <outPath>` for headless Codex (`packages/adapters/src/codex.ts:31`).
- The adapter comment is explicit: "stdout includes the session transcript and token footer, so the
  clean Play answer must come from Codex's last-message file instead of stdout capture"
  (`packages/adapters/src/codex.ts:34`).
- `dispatchPlay` treats Codex as owning `input.outPath` and writes verbose stdout to a sidecar
  (`packages/core/src/plays/dispatch.ts:183`).
- Oz agent turns do the same: `runTurn()` detects adapter-owned output, captures stdout to
  `${outPath}.stdout`, then reads `outPath` for the final reply (`packages/daemon/src/oz-host.ts:157`).

Reliability tradeoff:

- The final committed transcript source should remain the clean `--output-last-message` artifact.
  It is already the answer source and avoids Codex stdout transcript/footer noise.
- The in-progress UI can stream from JSONL stdout while the process runs. That stream is presentation
  state, not the durable answer. If JSONL parsing drops a malformed event, the final artifact still
  wins on completion.
- Streaming requires a parser and schema fixture for the installed Codex JSONL event shape. Until that
  fixture exists, treating raw stdout text as answer deltas would be brittle because non-answer events,
  transcript entries, stderr, and token/footer data can appear in the captured stream.

## Delivery Design

Reuse existing owners. Do not create a second chat/event transport.

1. Adapter owner: `packages/core/src/adapter/types.ts` and `packages/adapters/src/codex.ts`.
   Add an opt-in `BuiltCommand.stream?: { format: 'codex-jsonl'; finalArtifact: true }`.
   `CodexAdapter.build({ headless: true })` keeps `--output-last-message <outPath>` and adds `--json`
   only when streaming is requested. Normal builder/Play behavior stays unchanged until the JSONL parser
   is proven.

2. Subprocess owner: `packages/core/src/plays/dispatch.ts`.

   `HeadlessRunInput.onData` already fires per stdout/stderr chunk. For JSONL reliability, extend the
   owner to `onData(chunk, stream: 'stdout' | 'stderr')`; existing consumers can ignore the second
   argument. The Codex parser consumes stdout only and keeps stderr as diagnostics.

3. Daemon Oz chat owner: `packages/daemon/src/oz-host.ts`, `packages/daemon/src/oz-chat.ts`, and
   `packages/daemon/src/context.ts`.

   `tryHandleOzAgentTurn()` already serializes one turn per workspace with `session.inFlight`. Add a
   turn/message id at turn start. Extend `OzEvent` in `context.ts` with optional chat-stream fields:
   `messageId`, `turnId`, `seq`, `channel: 'answer' | 'thinking'`, `delta`, `done`, and `error`.
   Emit through the existing `emitOzEvent(ctx, ...)` and `OzEventBus`; do not add a new bus. New event
   types:

   - `oz-chat-start`: `{ workspaceId, messageId, turnId }`
   - `oz-chat-delta`: `{ workspaceId, messageId, turnId, seq, channel: 'answer', delta }`
   - `oz-chat-thinking-delta`: same shape, but `channel: 'thinking'`; emitted only if an adapter truly
     supplies a separated thinking stream
   - `oz-chat-complete`: `{ workspaceId, messageId, turnId, done: true }`
   - `oz-chat-error`: `{ workspaceId, messageId, turnId, error }`

   `OzChatReply` remains the final HTTP result: `reply`, `command`, `ok`, and optional `action`
   (`packages/daemon/src/oz-chat.ts:43`). Add optional `messageId` so the synchronous reply can close
   the same UI message the SSE deltas opened.

4. HTTP/SSE owner: `packages/daemon/src/routes.ts`.
   Keep `GET /oz/events`. It already writes named SSE frames from `OzEventBus` as
   `event: ${event.type}` and `data: ${JSON.stringify(event)}`. Streaming chat deltas use this existing
   authenticated, heartbeated SSE path.

5. Electron main/preload owner: `packages/ui/src/main/events-stream.ts`,
   `packages/ui/src/main/ipc-contract.ts`, and `packages/ui/src/preload/preload.ts`.

   Extend `OzEventHint` and `sanitizeOzEventHint()` with the optional chat-stream fields above.
   Continue sending through `CHANNELS.ozEvent`; `OzApi.onOzEvent(cb)` remains the single renderer
   subscription.

6. Renderer owner: `packages/ui/src/renderer/App.tsx`,
   `packages/ui/src/renderer/model.ts`, and
   `packages/ui/src/renderer/sections/dashboard/OzChat.tsx`.

   Extend renderer `ChatMessage` with optional `stream: { messageId, answer, thinking?, done }`.
   `App.tsx` handles `oz-chat-*` events in its existing `onOzEvent` subscription before the refetch
   debounce path, updates one Oz message keyed by `messageId`, applies deltas by `seq`, and marks
   complete when either `oz-chat-complete` arrives or the final `OzChatReply` returns. `OzChat.tsx`
   renders `stream.thinking` only when present.

## Go/No-Go

GO for answer streaming behind a Codex JSONL parser. NO-GO for show-thinking on current Codex unless a
future CLI exposes a distinct reasoning/thinking event. The founder decision is whether to ship answer
streaming first with thinking absent, or wait for an upstream thinking-capable interface. My
recommendation is to ship answer streaming first and keep thinking optional.

Ordered sub-atoms:

1. Capture Codex JSONL schema fixture.
   Run one bounded `codex exec --json --output-last-message <tmp>` probe in a temp workspace, commit a
   redacted fixture, and document which JSONL fields contain answer deltas. Exit criterion: fixture
   proves answer deltas arrive before completion and the final artifact still matches the last-message
   file.

2. Add adapter and parser capability.
   Extend `BuiltCommand`/`CodexAdapter` for opt-in `--json`, add a parser that emits only answer
   deltas, and keep `--output-last-message` as final source. Exit criterion: adapter/core tests prove
   non-streaming commands are unchanged and streaming commands parse the fixture.

3. Add daemon stream events.
   Thread `messageId`/`turnId` through `tryHandleOzAgentTurn()` and `runTurn()`, emit `oz-chat-*` via
   `OzEventBus`, and keep `OzChatReply` as final HTTP completion. Exit criterion: daemon tests observe
   ordered `/oz/events` SSE frames while final reply still comes from the artifact.

4. Add UI bridge and renderer state.
   Extend `OzEventHint`, `sanitizeOzEventHint()`, preload typing, `App.tsx`, and `OzChat.tsx`.
   Exit criterion: UI tests prove deltas update one Oz message keyed by `messageId`, completion
   reconciles with `OzChatReply`, and thinking is hidden when absent.

5. Run end-to-end smoke.
   Use a bounded live Oz chat turn with `--json` enabled and verify visible incremental answer text,
   final artifact reconciliation, no duplicate final message, and graceful fallback when streaming is
   disabled or malformed. Exit criterion: typecheck, topology, relevant tests, and bounded launch smoke
   pass with artifact/path evidence.

## Scope Note

This design does not touch the archived workspace-segmentation panel-layout seam, `packages/ui/design-ref`,
or dashboard panel layout. Streaming belongs to the existing Oz chat/event/IPC path only.
