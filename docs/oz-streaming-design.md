---
doc-type: design-intent
---

# Oz Streaming Design

Design and capability probe for Oz response streaming and show-thinking-if-available. This is a
read-only design artifact for item 1, part B; it does not change runtime behavior.

## Codex Capability Probe

Current local CLI:

```text
$ codex --version
codex-cli 0.142.3
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

- `codex exec` can emit a stdout JSONL event stream (`--json`), but the long-answer timing probe below
  showed it did not emit incremental answer deltas on the probed `codex-cli 0.137.0`.
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
- The in-progress UI cannot stream answer text from this Codex JSONL shape. It can show lifecycle
  progress (`thread.started`, `turn.started`) and then the whole answer when `item.completed` arrives.
- If a future Codex version or alternate runtime emits true answer deltas, the final committed
  transcript source should still remain `--output-last-message`; streaming events should be
  presentation state only.

## Delivery Design

Reuse existing owners if a founder chooses to build message-level progress now or later adopts a
streaming-capable runtime. Do not create a second chat/event transport.

1. Adapter owner: `packages/core/src/adapter/types.ts` and `packages/adapters/src/codex.ts`.
   A future opt-in JSONL mode would keep `--output-last-message <outPath>` and add `--json`, but this is
   not answer streaming on the probed `codex-cli 0.137.0`; it is lifecycle plus whole-message completion.

2. Subprocess owner: `packages/core/src/plays/dispatch.ts`.

   `HeadlessRunInput.onData` already fires per stdout/stderr chunk. If this path is built for
   message-level progress, extend the owner to `onData(chunk, stream: 'stdout' | 'stderr')`; consume
   stdout JSONL only and keep stderr as diagnostics.

3. Daemon Oz chat owner: `packages/daemon/src/oz-host.ts`, `packages/daemon/src/oz-chat.ts`, and
   `packages/daemon/src/context.ts`.

   `tryHandleOzAgentTurn()` already serializes one turn per workspace with `session.inFlight`. Add a
   turn/message id at turn start. Extend `OzEvent` in `context.ts` with optional chat-stream fields:
   `messageId`, `turnId`, `seq`, `channel: 'answer' | 'thinking'`, `delta`, `done`, and `error`.
   Emit through the existing `emitOzEvent(ctx, ...)` and `OzEventBus`; do not add a new bus. New event
   types:

   - `oz-chat-start`: `{ workspaceId, messageId, turnId }`
   - `oz-chat-message`: `{ workspaceId, messageId, turnId, text }`, emitted when the whole
     `agent_message` arrives
   - `oz-chat-delta` / `oz-chat-thinking-delta`: reserved for a runtime that truly supplies separated
     answer/thinking deltas; do not synthesize them from a completed message
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

   Extend renderer `ChatMessage` with optional in-flight state keyed by `messageId`. `App.tsx` handles
   `oz-chat-*` events in its existing `onOzEvent` subscription before the refetch debounce path, updates
   one Oz message when the whole `agent_message` arrives, and marks complete when `oz-chat-complete` or
   the final `OzChatReply` returns. `OzChat.tsx` renders thinking only when a future runtime supplies it.

## Go/No-Go

NO-GO for token-level or line-level answer streaming on the probed `codex-cli 0.137.0`. The long probe produced a
single whole `item.completed`/`agent_message` after generation, not multiple answer delta events over
wall-clock time. NO-GO for show-thinking as well: `turn.completed.usage.reasoning_output_tokens` is a
count, not reasoning text.

Founder decision: either build only message-level progress for Codex (`started` -> waiting -> whole
message -> complete) and defer true streaming, or pursue an alternate streaming-capable runtime before
building parser/runtime/UI streaming. Do not fake streaming by chunking the completed reply.

**RESOLVED (founder, run_157): message-level progress only; true token streaming deferred.** Ship Oz with
lifecycle progress + the existing typing affordance + the whole markdown answer on completion. Do NOT build
the JSONL parser, the daemon `oz-chat-*` delta events, or the SSE/IPC delta plumbing now. The
`--output-last-message` artifact remains the durable answer. Revisit true token streaming and
show-thinking only if/when Oz adopts a streaming-capable runtime that emits real answer/reasoning deltas.

## Scope Note

This design does not touch the archived workspace-segmentation panel-layout seam, `packages/ui/design-ref`,
or dashboard panel layout. Streaming belongs to the existing Oz chat/event/IPC path only.

## Codex JSONL Event Schema

Observed with one bounded long-answer probe in a temp directory:
`codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --disable apps --json -o "$tmp/last.txt" "Count from 1 to 60, printing each number on its own line, then write a 10-sentence paragraph about the ocean. Do not use markdown."`.
The run exited 0, wrote 4 JSONL events, and wrote a 1023-character final artifact. Redacted fixture:
`packages/adapters/tests/fixtures/codex-jsonl-stream.jsonl`.

Timestamped capture:

```text
1781904778.855 {"type":"thread.started","thread_id":"019ee1cd-263d-7d50-9f66-bad0f43e7693"}
1781904778.857 {"type":"turn.started"}
1781904787.344 {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"1\n2\n3\n..."}}
1781904787.390 {"type":"turn.completed","usage":{"input_tokens":10542,"cached_input_tokens":2432,"output_tokens":318,"reasoning_output_tokens":30}}
```

Observed event counts: `thread.started:1`, `turn.started:1`, `item.completed:1`,
`turn.completed:1`. No `item.delta`, `item.updated`, repeated `agent_message`, or other partial-answer
event appeared.

| Event discriminator | Role | Parser fields |
| --- | --- | --- |
| `thread.started` | other | `thread_id` is session metadata; ignore for answer text. |
| `turn.started` | other | Turn boundary; ignore for answer text. |
| `item.completed` with `item.type === "agent_message"` | whole-answer | Read `item.text` as the whole answer. This is not an incremental delta. |
| `turn.completed` | completion | Completion marker. `usage.reasoning_output_tokens` is a token count only, not a reasoning/thinking text stream. |

Reconciliation proof: `answer-event-count=1`, `answer-time=1781904787.344`,
`completion-time=1781904787.390`, `answer-to-completion-seconds=0.046`,
`total-event-span-seconds=8.535`, `answer-char-length=1023`, `artifact-char-length=1023`, and
`reconstructs-artifact=true`. The message-level answer event arrives before process completion, but only
by 0.046 seconds and only as a complete 1023-character message.
