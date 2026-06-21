# Spike — headless CLI invocations (claude, codex) for the adapter + runner

**Date:** 2026-05-28 · **Gate:** Phase-1 Step 0.5 (pre-build de-risk) · **Result:** ✅ PASS
**Versions:** claude 2.1.156 · codex-cli 0.134.0 · cmux 0.64.10 · node 25.1.0

## Question
The cmux socket spike ([`2026-05-28-cmux-socket-api.md`](./2026-05-28-cmux-socket-api.md)) only
proved `pwd`. Before writing the adapters (Step 4) and runner (Step 6), pin the **actual agentic
headless invocations** for Oscar (claude) and Bob (codex): do they use tools / write files
non-interactively, without the F10 mid-run permission/Keychain block, and can completion be
detected **structurally** (artifact + exit code) rather than by scraping the TUI?

## Pinned invocations (verified)

**claude (orchestrator, Oscar)** — writes a file, exits 0, emits structured JSON:
```
claude -p '<prompt>' --permission-mode acceptEdits --add-dir '<cwd>' --output-format json < /dev/null
```
- `--output-format json` → one JSON object on stdout with `"subtype":"success"`,
  `"is_error":false`, a `"result"` string, `session_id`, cost/usage. **Completion = exit 0 +
  `is_error:false`.**
- `--permission-mode acceptEdits` lets it edit/write without interactive approval; `--add-dir`
  grants tool access to the working dir. Run with `cwd = <repo>` (or `<runDir>` for Oscar's
  delegation write).

**codex (builder, Bob)** — edits files under trust-the-CLI (no OS sandbox), exits 0:
```
codex exec '<prompt>' -C '<cwd>' --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -o '<lastmsg-file>' < /dev/null
```
- `--dangerously-bypass-approvals-and-sandbox` = the ADR-0006 **trust-the-CLI** posture (normal
  OS perms, no CoCoder-managed sandbox). Verified: Bob edited the file with **no F10
  Keychain/sandbox block**. (`-s workspace-write` would re-impose a sandbox — the F10 cause —
  so we deliberately do not use it; the write boundary is enforced at CoCoder's commit-gate, S7.)
- `-o <file>` writes the agent's last message → a structured completion artifact.
  **Completion = exit 0 + `-o` file written.** `--json` is also available for an event stream.
- `--skip-git-repo-check` avoids a prompt when cwd isn't a fresh repo.

## The load-bearing finding — **stdin must be redirected (`< /dev/null`)**
Both CLIs read stdin when it isn't a TTY (e.g., spawned in a pane / pipe), but they fail
**differently**, and this is exactly the F10-class "cryptic mid-run hang" the spike exists to catch:
- **codex `exec` HANGS INDEFINITELY** waiting for stdin EOF (`stderr: "Reading additional input
  from stdin..."`). Observed: a run sat blocked past 5 minutes until killed. **Without `< /dev/null`
  the builder never starts.**
- **claude `-p`** only warns and waits ~3s (`"no stdin data received in 3s, proceeding without it"`)
  — survivable but adds latency.
→ **Both adapters MUST append `< /dev/null`** (or otherwise close stdin) when launching. This is
non-negotiable for the codex adapter.

## Driving it inside a cmux pane (full path, verified)
The agents run their **headless command inside a visible cmux pane** (reconciles ADR-0002 "watch
in cmux" + ADR-0006 "invoke headlessly"). Verified end-to-end with the claude invocation:
- **Quoting:** write the launch command to a run-scoped `run.sh` and `cmux send` **`bash '<runDir>/run.sh'`** then `send-key Enter`. Sidesteps the quoting hell of sending a long
  command with nested quotes (a raw `send` of the full command via the shell mangled it).
- **cwd:** `run.sh` starts with `cd '<cwd>'` (the cmux `open`-doesn't-set-cwd fix still applies).
- **Completion detection:** append `echo "<TOKEN>:EXIT=$?"` as the last line of `run.sh`; poll
  `cmux read-screen --surface <ref>` until `<TOKEN>` appears, then parse the exit code. Confirmed
  alongside the structured artifact (`out.json` `subtype:success`). The on-screen sentinel and the
  artifact agree — use the **artifact/exit code as source of truth**, the sentinel as the pane
  rendezvous.
- cmux socket confirmed in **`automation` mode** (`cmux ping → PONG`); `close-workspace` clean.

## Implications folded into the build
- **Step 4 (adapters):** `build()` emits the pinned argv above (incl. `< /dev/null`); preflight
  must verify installed/authed/model AND — per ADR-0006 §4 — assert the write capability from the
  outside (the codex no-sandbox write actually lands).
- **Step 2/6 (driver + runner):** launch via a generated `run.sh` (`bash <script>`), detect
  completion from exit code + the CLI's structured artifact, not TUI scraping.

## Verdict
Both headless invocations are viable and pinned; the stdin redirect is the one finding that would
otherwise have hung the first real run. Step 1 (six packages + topology) and the runner are
unblocked.

## ⚠ Superseded (2026-05-29) — agents now launch INTERACTIVELY

Phase-2 dogfooding showed the headless invocations (`claude -p`, `codex exec`, output redirected to
files) defeat the whole point of running in cmux: the panes look idle / spill raw stream-json, and
the founder can't watch the agents work. We pivoted to the **CoBuilder pattern**: launch the real
interactive TUIs in cmux split panes with the prompt injected, and detect completion via an
**artifact the agent writes** (Oscar→`delegation.json`, Bob→`builder-done.json`) rather than process
exit. New invocations:

- claude: `claude --disable-slash-commands --permission-mode acceptEdits -- "<prompt>"`
- codex: `codex --dangerously-bypass-approvals-and-sandbox [-m <model>] "<prompt>"`

The two findings above still matter in spirit (the trust-the-CLI no-sandbox posture for codex is
retained; the stdin-hang is moot because an interactive PTY has a real stdin). See
[`../oz-thin.md`](../zArchive/rebuild-notes/oz-thin.md).
