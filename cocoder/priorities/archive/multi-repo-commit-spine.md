# Multi-repo commit spine (deferred slice 2 of multi-root workspaces)

> **Archived 2026-06-29 (founder) — archive confirmed.** Cleared per 2026-06-29 audit (founder-directed backlog clearing); worktree-isolation framing predates ADR-0023/0045 and needs a fresh multi-root design before revival.

**Status:** backlog — design intent recorded 2026-06-12 (run_70, migrated from session memory);
not runnable until drafted into an Objective + ADR-conflict pass per the architecture-contract
discipline.

ADR-0019 landed slice 1 of multi-root workspaces (identity: the `.code-workspace` directory-of-
files SSOT, three root roles, daemon CRUD, the Workspaces screen). This is the deferred second
slice: **the commit spine, write-scope, and (opt-in) isolation become PER-REPO**, so one run can
safely produce commits in more than one root (e.g. a host-project change plus an orthogonal engine
fix).

**Reconcile with [ADR-0023](../../decisions/0023-workspace-commit-spine.md) at pickup (2026-06-14).**
The single-root commit model changed under the operating-model reset: direct-to-branch is now the
default and the one commit spine (`commitFiles` / `commitScoped` / `runCommitGate`) writes to the
active workspace branch; isolated worktrees are opt-in. Multi-root is the natural extension —
**one spine instance per managed root**, each committing to its own root's active branch with its own
scope. The "per-root worktree isolation" framing below predates ADR-0023; the live design question is
how the spine + single-writer lock generalize across N roots, not how to give each root a worktree.

**ADR-0019 amendment candidates to ratify with the founder at pickup** (discussed and agreed in
the run_43/44 design conversations but never recorded in the ADR itself):

- **Git is orthogonal to role.** A root may or may not be git-managed; subdirectories may be
  independent repos. "May the agent write here" (the role) is a different question from "what and
  where gets committed" (the git layout on disk).
- **Workspace id derived from the filename** — this is the implemented behavior and was the
  recommendation; the founder reserved the option to veto in favor of an internal field.
- **The engine-edit sharp edge:** CoCoder-as-a-writable-root in ANOTHER workspace means a run
  there can edit the running engine — which ties directly to the stale-daemon guard. Such fixes
  must land as their own `cocoder/`-scoped commit (the `deb-repair` / `oz-repair` precedent),
  never blended into the host project's diff.
