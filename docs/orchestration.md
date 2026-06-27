# CoCoder Orchestration

**Status:** Draft, implemented by Sub-Playbook D Solve  
**Last verified:** 2026-06-20 (scrubbed stale v1 session-host prose; aligned launch/attach with cmux + ADR-0002/0029)

CoCoder launches visible, bounded agent lanes around one selected priority. A run is a working record: launch prompt, live panes, directive and verify artifacts, evidence paths, portable history, and pickup state.

## Session model

The terminal host is cmux (ADR-0002). A run gets its own cmux *workspace*, and the run's lanes run as split panes inside it — the founder watches them side by side. Run-state durability lives in Oz's data model, not in the terminal; the panes are a disposable view onto the run. See [`ARCHITECTURE.md`](../ARCHITECTURE.md) for the per-run isolation model.

Common shapes:

- **Lead lane** - usually Oscar. Reconciles priority fit, dispatches bounded packets, and owns closeout status updates.
- **Builder lane** - usually Bob. Edits files only inside its write boundary, verifies the packet, then writes result artifacts.
- **Verifier or QA lanes** - optional members and Plays for test building, browser automation, or
  review. Testing is a Play capability (`write-tests` / `run-tests`); Quinn owns user-simulation QA.

To watch a run, use the **Attach** action in the Oz dashboard's run drawer — it focuses the run's live cmux pane (Oscar by preference). See [`oz-launch.md`](./oz-launch.md) for the dashboard launch path.

## Runs

A run has two durable homes:

```text
<CoCoder>/local/runs/<workspaceId>/<runId>/
<workspace>/cocoder/runs/<display>-<runId>/
```

The machine-local run directory is the private live artifact home; its layout is owned by
[`packages/core/src/runner/run-dir.ts`](../packages/core/src/runner/run-dir.ts). Portable run history
is committed under `cocoder/runs/<display>-<runId>/` in the workspace so future sessions can inspect
events, commits, sessions, and work items without the private `local/` directory.

The ordinary run loop advances through Oscar-authored `directive-<n>.json` files and verify artifacts.
Oscar delegates one atom to Bob; Bob completes the work and prints the atom marker; Oscar verifies the
actual diff and evidence; the runner commits only after a passing verify result. At wrap, the runner
writes `pickup.md` as the resumable brief for the next session.

Configuration resolution, workspace roots, and private `local/` overrides are described in [`configuration.md`](./configuration.md).

## Dispatch rules

The lead dispatch should state:

- the priority and plan slice
- files or directories in scope
- files or directories out of scope
- required verification
- result expectations when they add detail beyond the lane launch prompt

Lane launch prompts remain authoritative for identity fields such as persona, adapter, write capability, and result paths. If a later dispatch conflicts with those fields, the lane should follow the launch prompt and report the conflict.

## Evidence capture

Evidence belongs in the run result, not only in chat. A useful result names the command, file, report path, screenshot, or diff that supports the claim and states its limitation.

Evidence classes:

- **Class A** - founder-pristine, packaged, staging, production, or real user-path proof.
- **Class B** - local, mocked, dry-run, static, or dev-path proof.

Most v0.1 builder checks are Class B unless they exercise a real operator path from a clean or founder-controlled environment.

## Session-wrap flow

When Bob finishes an atom:

1. Run the required checks, or state why they could not run.
2. Summarize the changed files and verification evidence.
3. Print the atom completion marker exactly as requested by the directive.
4. Stop work for that atom until the runner dispatches the next one.

The runner, not Bob, owns verify artifacts, portable run-history files, and the final pickup.

## Extension points

Routes, profiles, personas, prompt fragments, and priority boundaries define who can join a run and what they may write. See [`custom-personas.md`](./custom-personas.md) for the public extension conventions.
