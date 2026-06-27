# Oscar-Deb Repair Dialogue Design

Status: shipped (run_43/run_186). ADR-0036 is the source of truth for the contract; this document
records the build mechanism ADR-0036 deliberately deferred
(`cocoder/decisions/0036-oscar-deb-repair-dialogue.md:53-56`). The owner-map row is
`docs/orchestration-contract-ownership.md:59`.

## Existing Anchors

- ADR-0036 defines the standing Oscar-initiated repair dialogue, the propose->evaluate->direct handoff,
  the founder tier, and the invariants (`cocoder/decisions/0036-oscar-deb-repair-dialogue.md:23-51`).
- ADR-0016 gives Deb the status/nudge/repair posture, the propose-vs-repair choice, and the
  lightest-home recurrence escalation rule (`cocoder/decisions/0016-deb-scoped-repair-fallback.md:45-74`).
- ADR-0023 says all actors use one commit spine and no actor reimplements `git commit`
  (`cocoder/decisions/0023-workspace-commit-spine.md:87-103`). Its current amendment says out-of-lane
  paths are committed and flagged, never withheld (`cocoder/decisions/0023-workspace-commit-spine.md:138-148`).
- The idle Oz repair precedent is `requestOzRepair`: it refuses while any run is in flight, validates the
  message, resolves the workspace and Oz assignment, writes a local turn log, then calls
  `runHeadlessThenGateCommit` (`packages/daemon/src/launcher.ts:1006-1048`). That helper runs one
  headless turn and commits through `gateCommitRepair`/`commitScoped` plumbing
  (`packages/daemon/src/launcher.ts:1117-1169`).
- The post-wrap Oscar precedent is `requestSupportCommitRun`: it is a daemon operation invoked after
  wrap, refuses live competing work, resolves Oscar's scope, and calls `runCommitGate`
  (`packages/daemon/src/launcher.ts:798-853`). It is exposed through HTTP
  (`packages/daemon/src/routes.ts:885-887`), Oz chat (`packages/daemon/src/oz-chat.ts:167-173`), and the
  CLI command `cocoder oz commit-support <runId>` (`packages/cli/src/run.ts:77-83`).
- The in-run Deb repair path writes fault/triage artifacts, dispatches Deb, awaits a verdict, and uses
  `runCommitGate` for `deb-repair`/ticket work (`packages/core/src/runner/runner.ts:957-1002`). Its prompt
  names the existing triage verdict shape (`packages/core/src/runner/prompts.ts:596-601`), and Deb's base
  persona states her repair posture and Bob boundary (`packages/personas/base/deb.md:31-48`,
  `packages/personas/base/deb.md:58-75`).
- At design time, `packages/core/src/runner/directive.ts` allowed `delegate`, `deb-investigate`, and
  `wrapup`; shipped code now rejects `deb-investigate` and allows only the build-loop directive kinds
  (`packages/core/src/runner/directive.ts:13-114`; pinned by
  `packages/core/tests/directive.test.ts:50-53`). This design adds no new within-`runRun` directive kind.

## Entry / Trigger

Add a daemon-resident operation:

```ts
requestOscarDebRepair(ctx, input)
```

Input:

```json
{
  "workspaceId": "cocoder",
  "sourceRunId": "run_186",
  "problem": "Oscar cannot safely continue because the runner prompt still advertises deb-investigate.",
  "evidence": [
    {
      "kind": "file",
      "ref": "packages/core/src/runner/prompts.ts:589",
      "summary": "NEXT dispatch still tells Oscar to write deb-investigate."
    }
  ],
  "requestedBy": "oscar"
}
```

Concrete surfaces:

- HTTP: `POST /workspaces/:workspaceId/oscar-deb-repairs`.
- Oz chat command: `deb-repair <problem>` with optional `--run <runId>` and rationale/evidence text.
- CLI: `cocoder oz request-deb-repair <workspaceId> --problem <text> [--run <runId>] [--evidence <json>]`.

The operation is workspace-scoped, with optional `sourceRunId` for evidence. It is not tied to the
multi-atom runner and remains valid after Oscar has wrapped. Oscar can run the CLI command from a live or
post-wrap pane; the daemon owns the operation.

Guards modeled on `requestOzRepair`:

- The request surface is callable any time: the daemon can always validate the request and write
  `request.json`.
- The Deb/Oscar headless turns and any commit phase reuse the Oz repair idle guard: if a workspace run is
  actively mutating, the dialogue enters `waiting-for-idle` and no headless turn starts until the run is
  wrapped/terminal. If the only active run is `sourceRunId` and it is already wrapped/terminal, proceed
  immediately. This preserves the idle write guard while allowing the ADR-0036 post-wrap case.
- Require `problem.trim()` and cap `problem` at 4000 chars, matching the Oz repair message guard.
- Require at least one evidence item with a non-empty `summary`.
- Require an assigned Deb CLI/model for the workspace; return `409` if Deb is not assigned.
- Allow only one active repair dialogue per workspace. A second request returns `409` with the active
  dialogue id. This is the rate-limit guard: one standing repair turn at a time, no queue that can
  surprise Oscar after context has moved.

## Artifact Home

All handshake artifacts live outside the build directive loop:

```text
local/oz/<workspaceId>/repair-dialogues/<dialogueId>/
  request.json
  deb-response.json
  oscar-evaluation.json
  founder-escalation.json
  evidence.jsonl
  deb-turn.log
  oscar-turn.log
```

`dialogueId` is `repair-<unixMs>-<shortToken>`. These files are durable local operation artifacts, not
tracked governance and not `directive-n.json`.

## Handshake Artifacts

### 1. Oscar Request

Path: `local/oz/<workspaceId>/repair-dialogues/<dialogueId>/request.json`.

Shape:

```json
{
  "schemaVersion": 1,
  "dialogueId": "repair-1860000000000-a1b2",
  "workspaceId": "cocoder",
  "sourceRunId": "run_186",
  "requestedBy": "oscar",
  "createdAt": "2026-06-22T19:45:00.000Z",
  "problem": "The runner still tells Oscar to use the within-run deb-investigate lane.",
  "evidence": [
    {
      "kind": "file",
      "ref": "packages/core/src/runner/prompts.ts:589",
      "summary": "NEXT dispatch advertises deb-investigate."
    }
  ],
  "desiredOutcome": "Remove the stale within-run lane and route proactive repair through ADR-0036."
}
```

The daemon writes this before spawning Deb. It also appends an `oscar-deb-repair-requested` audit/event
with `dialogueId`, `workspaceId`, `sourceRunId`, and the evidence refs.

### 2. Deb Response

Path: `local/oz/<workspaceId>/repair-dialogues/<dialogueId>/deb-response.json`.

Applied fix shape:

```json
{
  "schemaVersion": 1,
  "dialogueId": "repair-1860000000000-a1b2",
  "kind": "applied",
  "disposition": "cocoder-bug",
  "mode": "repair",
  "summary": "Removed the obsolete deb-investigate directive path.",
  "diagnosis": "The proactive Oscar->Deb path was still modeled as a run failure.",
  "whyCocoderOwned": "The defect is in CoCoder runner prompt/directive machinery.",
  "filesChanged": ["packages/core/src/runner/directive.ts", "packages/core/src/runner/prompts.ts"],
  "verification": "pnpm exec vitest run packages/core/tests/directive.test.ts packages/core/tests/runner.test.ts",
  "remainingRisk": "Daemon entry tests still pending.",
  "commit": {
    "sha": "abc1234",
    "committedPaths": ["packages/core/src/runner/directive.ts", "packages/core/src/runner/prompts.ts"],
    "outOfLanePaths": []
  }
}
```

Proposal shape:

```json
{
  "schemaVersion": 1,
  "dialogueId": "repair-1860000000000-a1b2",
  "kind": "proposal",
  "disposition": "cocoder-bug",
  "summary": "Move proactive repair to a daemon operation and remove deb-investigate.",
  "diagnosis": "The current path conflates asking Deb for help with formal run failure.",
  "recommendedChanges": [
    {
      "file": "packages/core/src/runner/directive.ts",
      "change": "Remove the deb-investigate Directive variant and parser branch."
    }
  ],
  "verificationPlan": [
    "pnpm exec vitest run packages/core/tests/directive.test.ts",
    "pnpm exec vitest run packages/core/tests/runner.test.ts"
  ],
  "risk": "medium",
  "needsFounder": false
}
```

The daemon drives this transition by spawning one Deb headless turn using the request path and response
path in the prompt. If Deb applies a fix, the daemon commits via the commit path below before writing the
final `commit` object into `deb-response.json`.

### 3. Oscar Evaluation And Direction

Path: `local/oz/<workspaceId>/repair-dialogues/<dialogueId>/oscar-evaluation.json`.

Shape:

```json
{
  "schemaVersion": 1,
  "dialogueId": "repair-1860000000000-a1b2",
  "evaluatedBy": "oscar",
  "createdAt": "2026-06-22T20:00:00.000Z",
  "verdict": "direct-deb-to-apply",
  "reason": "The proposal is in-scope CoCoder machinery and matches ADR-0036.",
  "direction": {
    "action": "apply",
    "scope": ["packages/core/src/runner/directive.ts", "packages/core/src/runner/prompts.ts"],
    "verificationRequired": [
      "pnpm exec vitest run packages/core/tests/directive.test.ts packages/core/tests/runner.test.ts"
    ]
  }
}
```

Allowed `verdict` values:

- `accept-applied`: Deb already applied an easy fix; Oscar records evaluation of the evidence.
- `direct-deb-to-apply`: Deb proposed; Oscar directs Deb to apply it.
- `revise`: Deb proposed; Oscar asks for a narrower proposal with named concerns.
- `escalate-founder`: Oscar decides the change is risky or hard to reverse.

The daemon drives this by spawning one Oscar headless evaluation turn only when Deb returns
`kind:"proposal"`. The daemon records the evaluation and, for `direct-deb-to-apply`, spawns a second Deb
headless turn with the original request, Deb proposal, and Oscar direction.

### 4. Founder Escalation

Path: `local/oz/<workspaceId>/repair-dialogues/<dialogueId>/founder-escalation.json`.

Shape:

```json
{
  "schemaVersion": 1,
  "dialogueId": "repair-1860000000000-a1b2",
  "kind": "founder-escalation",
  "createdAt": "2026-06-22T20:05:00.000Z",
  "reason": "The proposed change rewires commit-spine behavior and would be hard to unwind.",
  "lightestHome": "founder-decision",
  "options": [
    {
      "label": "Approve daemon operation build",
      "effect": "Deb applies the proposed repair through the existing commit spine."
    }
  ],
  "recommendedOption": "Approve daemon operation build",
  "evidenceRefs": [
    "local/oz/cocoder/repair-dialogues/repair-1860000000000-a1b2/deb-response.json",
    "local/oz/cocoder/repair-dialogues/repair-1860000000000-a1b2/oscar-evaluation.json"
  ]
}
```

This is the ADR-0016 lightest-home escalation extended by ADR-0036. It is the artifact Oz/dashboard
surfaces to the founder; no repair commit happens after this state until the founder directs it.

## State Machine

States:

1. `requested`: daemon validates input and writes `request.json`.
2. `waiting-for-idle`: request accepted, but a workspace run is still actively mutating; no headless
   turn or commit is allowed yet.
3. `deb-running`: daemon spawns Deb headless with request path, response path, and ADR-0036 constraints.
4. `deb-applied`: Deb made an easy in-scope fix; daemon committed it and wrote `deb-response.json`.
5. `deb-proposed`: Deb wrote `kind:"proposal"` to `deb-response.json`.
6. `oscar-evaluating`: daemon spawns Oscar headless with request and proposal.
7. `oscar-directed`: daemon writes `oscar-evaluation.json` with `direct-deb-to-apply` or `revise`.
8. `deb-directed-running`: daemon spawns Deb with Oscar's direction.
9. `founder-escalated`: daemon writes `founder-escalation.json` and returns a founder-facing result.
10. `complete`: applied fix committed, no-op recorded, or founder escalation recorded.
11. `failed`: headless turn failed, malformed artifact, missing assignment, timeout, or commit failure.

Transitions:

- `requested -> waiting-for-idle`: daemon operation when the workspace is actively mutating.
- `requested -> deb-running`: daemon operation when the workspace is already idle/wrapped.
- `waiting-for-idle -> deb-running`: daemon operation when the source run becomes wrapped/terminal or the
  workspace has no active run.
- `deb-running -> deb-applied`: Deb headless turn edits files; daemon calls the commit path and records
  evidence.
- `deb-running -> deb-proposed`: Deb headless turn writes a proposal only.
- `deb-proposed -> oscar-evaluating`: daemon operation.
- `oscar-evaluating -> oscar-directed`: Oscar headless turn records evaluation and direction.
- `oscar-directed -> deb-directed-running`: daemon operation when direction is `direct-deb-to-apply`.
- `oscar-directed -> founder-escalated`: daemon operation when direction is `escalate-founder`.
- `deb-directed-running -> complete`: Deb applies under Oscar direction; daemon commits and records
  evidence.
- Any active state -> `failed`: daemon records the failing command, exit code, timeout, parse error, or
  commit error in `evidence.jsonl`.

Evidence is recorded in `evidence.jsonl` after each transition:

```json
{"ts":"2026-06-22T20:01:00.000Z","state":"deb-proposed","artifact":"deb-response.json","summary":"Deb proposed directive removal."}
```

## Commit Path

Deb-applied fixes use the existing repair/commit spine; atom 2 must not create a new commit caller that
bypasses it.

- For run-bound in-run faults, the precedent is `runCommitGate` in `triageFault`
  (`packages/core/src/runner/runner.ts:989-1000`).
- For daemon-resident headless repairs, the closest implementation pattern is `runHeadlessThenGateCommit`
  calling `gateCommitRepair` (`packages/daemon/src/launcher.ts:1117-1169`).
- Atom 2 should extend the daemon pattern with Deb as the persona and Deb's active write scope. If the
  build needs store-integrated run receipts, it should call `runCommitGate` with `runId:null` or an
  optional `sourceRunId` rather than inventing a second commit lane.

Scope handling must follow the current spine. ADR-0016 and older prompt text say out-of-scope repair
edits are held back (`cocoder/decisions/0016-deb-scoped-repair-fallback.md:52-60`;
`packages/core/src/runner/prompts.ts:596-601`), but ADR-0023 later amends the default spine so out-of-lane
paths commit and are flagged, not withheld (`cocoder/decisions/0023-workspace-commit-spine.md:138-148`);
the current runner disposition says the same (`packages/core/src/runner/runner.ts:949-953`). Atom 2
should not fork this policy. It should surface `outOfLanePaths`/`outOfScope` in `deb-response.json`,
events, audit, and the daemon reply.

No second commit lane is created.

## Founder Tier

The founder tier is reached only for changes Deb or Oscar judge genuinely risky, broad, hard to reverse,
or outside Deb's responsible authority. The daemon writes `founder-escalation.json`, records an event with
the same `dialogueId`, and returns a response that points to the artifact. The founder-facing surface is
the dashboard/Oz reply, not Bob and not the build directive loop.

This is ADR-0016's lightest-home instinct extended by ADR-0036: fix easy in-scope issues first, otherwise
choose the smallest durable home for the decision (`cocoder/decisions/0016-deb-scoped-repair-fallback.md:69-74`;
`cocoder/decisions/0036-oscar-deb-repair-dialogue.md:35-36`).

## Non-Goals / Invariants

These are owned by ADR-0036 and summarized here for implementation alignment
(`cocoder/decisions/0036-oscar-deb-repair-dialogue.md:38-51`):

- Oscar-Deb only. Deb never directs Bob.
- Never enters or touches the build directive loop.
- No new within-`runRun` directive kind.
- No second repair lane, no second orchestration lane, and no second commit lane.
- Never rescues a formally failed run.
- Does not replace Oscar's per-atom verify gate over Bob's product work.

## Atom 2 Build Map

Extend existing files:

- `packages/daemon/src/launcher.ts`: add `requestOscarDebRepair`, artifact writers, dialogue state
  transitions, Deb/Oscar headless prompts, and commit integration modeled on `requestOzRepair` and
  `runHeadlessThenGateCommit`.
- `packages/daemon/src/oz-chat.ts`: parse and dispatch `deb-repair` / `request-deb-repair`, analogous to
  `repair` and `support-commit`.
- `packages/daemon/src/routes.ts`: add `POST /workspaces/:workspaceId/oscar-deb-repairs`.
- `packages/cli/src/run.ts` and `packages/cli/src/client.ts`: add
  `cocoder oz request-deb-repair <workspaceId> --problem <text> [--run <runId>] [--evidence <json>]`.
- `packages/core/src/runner/directive.ts`: remove the obsolete `deb-investigate` directive variant and
  parser branch; leave only build-loop directive kinds.
- `packages/core/src/runner/runner.ts`: remove the `oscar-requested-deb-investigation` fail path.
- `packages/core/src/runner/prompts.ts`: remove launch/next-turn language that tells Oscar to write
  `deb-investigate`.

Net-new files:

- Prefer no new core package if the artifact JSON is local to daemon. If atom 2 needs shared validation,
  add one small daemon-local module, `packages/daemon/src/oscar-deb-repair.ts`, for schemas/artifact
  helpers. Do not add a second runtime package or prompt-only contract.

Atom 4 pinning suites:

- `packages/core/tests/directive.test.ts`: `deb-investigate` is rejected and no replacement run-loop
  repair directive exists.
- `packages/core/tests/runner.test.ts`: Oscar no longer receives `deb-investigate` prompt language and
  the old `oscar-requested-deb-investigation` fail route is gone.
- Daemon tests under `packages/daemon/tests/`: request validation, idle/active-run guard, artifact writes,
  Deb-applied commit path, Deb-proposal -> Oscar-evaluation -> directed apply, founder escalation, Oz chat,
  HTTP route, and CLI surface.
