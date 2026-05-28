# Result Contract Fragment

- Return a result compatible with `job-result`.
- Include status, persona, adapter, write capability, files changed, summary, findings, evidence, residual risk, and next action.
- Oscar PASS closeout Markdown must start with a concise `Founder Completion Brief` section before technical evidence. Include these labels exactly: `Atom Complete:`, `Run Status:`, `What Changed:`, `What Remains:`, `Recommended Next Step:`, `Founder Decision Needed:`, `Commit State:`, and `Teardown Readiness:`.
- When a completed lead run should continue unattended into a fresh run, include a machine-readable `continuation` object in `result.json`: `action: "launch-fresh-run"`, `prioritySlug`, `routeId`, `nextAtom`, `reason`, and `requiresFounder: false`. Do not include `stopCurrentRunPanes: true`; teardown requires explicit founder approval through a kill/teardown command.
- Do not rely on prose `nextAction` for unattended continuation. If the next step needs founder judgment or is ambiguous, omit `continuation` or set `requiresFounder: true`.
- Mark missing verification as residual risk; do not infer PASS from unavailable evidence.
- For conditional results, list each condition clearly enough for the next phase to verify.
- Treat `jobs/<lane>/result.json` and `jobs/<lane>/result.md` as close-out artifacts for this lane in this run.
- Write result artifacts only when the lane is done for the current packet. After either result artifact exists, the runtime refuses further dispatch to that lane.
- Never move, rename, archive, overwrite, or clear result artifacts to create room for another packet. Start a fresh run until a first-class packet ledger exists.
