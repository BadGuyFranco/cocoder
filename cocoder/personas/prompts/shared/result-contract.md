# Result Contract Fragment

- Return a result compatible with `job-result`.
- Include status, persona, adapter, write capability, files changed, summary, findings, evidence, residual risk, and next action.
- Oscar PASS closeout Markdown must start with a concise `Founder Completion Brief` section before technical evidence. Include these labels exactly: `Atom Complete:`, `Run Status:`, `What Changed:`, `What Remains:`, `Recommended Next Step:`, `Founder Decision Needed:`, `Commit State:`, and `Teardown Readiness:`.
- When a completed lead run should continue unattended into a fresh run, include a machine-readable `continuation` object in `result.json`: `action: "launch-fresh-run"`, `prioritySlug`, `routeId`, `nextAtom`, `reason`, and `requiresFounder: false`. Do not include `stopCurrentRunPanes: true`; teardown is a separate explicit founder request handled by the guarded teardown command.
- Do not rely on prose `nextAction` for unattended continuation. If the next step needs founder judgment or is ambiguous, omit `continuation` or set `requiresFounder: true`.
- Mark missing verification as residual risk; do not infer PASS from unavailable evidence.
- For conditional results, list each condition clearly enough for the next phase to verify.
- Treat `jobs/<lane>/result.json` and `jobs/<lane>/result.md` as close-out artifacts for the current lane packet, not disposable scratch files.
- Write result artifacts only when the lane is done for the current packet. After either result artifact exists, the runtime refuses further dispatch to that lane until the lead explicitly advances the lane packet.
- Never manually move, rename, archive, overwrite, or clear result artifacts to create room for another packet. If the current run should continue with the same lane after a PASS packet, use `advance-lane-packet` so the runtime records the completed packet in `jobs/<lane>/packets/` before reopening the lane.
