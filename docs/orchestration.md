# CoCoder Orchestration

**Status:** Draft, implemented by Sub-Playbook D Solve  
**Last verified:** 2026-06-20 (scrubbed stale v1 session-host prose; aligned launch/attach with cmux + ADR-0002/0029)

CoCoder launches visible, bounded agent lanes around one selected priority. A run is a working record: launch prompt, startup packet, lane panes, evidence paths, and result artifacts.

## Session model

The terminal host is cmux (ADR-0002). A run gets its own cmux *workspace*, and the run's lanes run as split panes inside it — the founder watches them side by side. Run-state durability lives in Oz's data model, not in the terminal; the panes are a disposable view onto the run. See [`ARCHITECTURE.md`](../ARCHITECTURE.md) for the per-run isolation model.

Common shapes:

- **Lead lane** - usually Oscar. Reconciles priority fit, dispatches bounded packets, and owns closeout status updates.
- **Builder lane** - usually Bob. Edits files only inside its write boundary, verifies the packet, then writes result artifacts.
- **Verifier or QA lanes** - optional members (e.g. Talia, Quinn) for test building, browser automation, or review.

To watch a run, use the **Attach** action in the Oz dashboard's run drawer — it focuses the run's live cmux pane (Oscar by preference). See [`oz-launch.md`](./oz-launch.md) for the dashboard launch path.

## Runs

A run directory lives under the install-local workspace registry:

```text
<CoCoder>/local/workspaces/<workspace-slug>/runs/<run-id>/
  startup-packet.json
  events.jsonl
  jobs/<lane>/prompt.md
  jobs/<lane>/result.json
  jobs/<lane>/result.md
  send-to-<lane>.sh
  watch-<lane>-completion.sh
```

The startup packet is orientation, not a work order. In `wait-for-lead-dispatch` mode, teammate lanes load the prompt and packet, then stay idle until the lead sends a concrete dispatch.

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

When a lane finishes its packet:

1. Run the required checks, or state why they could not run.
2. Write `jobs/<lane>/result.json` using the launch prompt's result contract.
3. Write `jobs/<lane>/result.md` with the same closeout in human-readable form.
4. Stop work for that packet.

Result artifacts close the lane for the current run. Do not delete, rename, or overwrite them to accept another packet; start a fresh run until packet ledgers are first-class.

## Extension points

Routes, profiles, personas, prompt fragments, and priority boundaries define who can join a run and what they may write. See [`custom-personas.md`](./custom-personas.md) for the public extension conventions.
