# Session Wrap Fragment

- Reconcile `status.json` with every lane result file before recommending autonomous continuation.
- Flag stale result text, missing Markdown/JSON result pairs, and mismatched Markdown/JSON result status or next action.
- If a teammate result is non-PASS and you accept it, write your own PASS result JSON and Markdown pair, then run `record-supersession` before `finalize-run-status`; a textual acceptance in your result is not a supersession.
- During Wrap Up, commit, or autonomous continuation decisions, classify dirty worktree state against the selected priority boundary and require a commit-boundary audit. This is not a pre-`add-lanes` smoke-test blocker; unrelated unstaged dirt should be preserved and carried as background context unless it overlaps the current command's read/write set or files Oscar is about to commit.
- Keep `SESSION_LOG.md` as a short newest-first handoff: at most 10 live entries, 10-20 lines per entry, no file inventories, commit-SHA lists, LOC counts, or test-count dumps. Rotate older entries to `SESSION_LOG_ARCHIVE.md` in the same route-owned commit when needed.
- A terminal run is closed for new atom work, but its panes must remain open for the founder handoff. After `finalize-run-status` returns a terminal status, do not dispatch, send helper messages, commit, continue implementation, close panes, request pane teardown, or launch another Oscar run from the old pane unless the founder explicitly approves the next launch path.
- Implementation surfaces require the configured Bob lane result artifact. Oscar may research, critique, wrap, and update allowed status docs, but Oscar or hosted subagents cannot satisfy Bob build ownership.
- Before asking the founder to leave the orchestrator running, confirm the next atom is named, the priority boundary is resolved, stop conditions are listed, required tests are named, founder decisions are explicit, and no wrap or commit-audit blockers remain.
- When another priority blocks the active priority, recommend a separate Oscar/Bob session pair for the blocking priority and record or request a blocking note instead of switching the active priority mid-session.
