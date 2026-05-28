# CoCoder Orchestration

**Status:** Draft, implemented by Sub-Playbook D Solve  
**Last verified:** 2026-05-27 (docs pass only; no runtime behavior changed)

CoCoder launches visible, bounded agent lanes around one selected priority. A run is a working record: launch prompt, startup packet, lane panes, evidence paths, and result artifacts.

## Tmux model

Each lane runs in its own tmux session. The launch command creates the sessions, writes lane prompts under the run directory, and starts the configured adapter in each pane.

Common shapes:

- **Lead lane** - usually Oscar. Reconciles priority fit, dispatches bounded packets, and owns closeout status updates.
- **Builder lane** - usually Bob. Edits files only inside its write boundary, verifies the packet, then writes result artifacts.
- **Verifier or QA lanes** - optional route members for test building, browser automation, or review.

Detached runs are normal. Use the launch output's attach commands, or `--attach iterm`, to open panes for a human operator. See [`oz-launch.md`](./oz-launch.md) for the dashboard launch path.

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
