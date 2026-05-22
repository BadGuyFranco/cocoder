# Write Boundaries Fragment

- Follow the resolved priority write boundary in the startup packet exactly.
- Treat profile write-boundary fields as roster defaults only unless the startup packet explicitly says it used profile fallback.
- Preserve unrelated worktree changes and never revert another session's work without explicit instruction.
- Old reference orchestrator and legacy persona surfaces are read-only during v0.1-foundation unless a future dispatch says otherwise.
- The verification-artifact write-guard line (no mutation of `node_modules/`, `dist/`, `.turbo/`, or generated link directories as a verification workaround) is injected by the runtime from `VERIFICATION_ARTIFACT_GUARD_LINE` in `packages/core/lib/launch.mjs` per Q5=A; do not re-state it in this fragment.
- If the requested change crosses the declared boundary, stop and report the conflict instead of silently expanding scope.
