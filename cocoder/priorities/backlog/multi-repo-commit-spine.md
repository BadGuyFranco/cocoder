# Multi-repo commit spine (deferred slice 2 of multi-root workspaces)

**Status:** backlog — design intent recorded 2026-06-12 (run_70, migrated from session memory);
not runnable until drafted into an Objective + ADR-conflict pass per the architecture-contract
discipline.

ADR-0019 landed slice 1 of multi-root workspaces (identity: the `.code-workspace` directory-of-
files SSOT, three root roles, daemon CRUD, the Workspaces screen). This is the deferred second
slice: **per-root worktree isolation, commit-gate, write-scope, and teardown become PER-REPO**, so
one run can safely produce commits in more than one root (e.g. a host-project change plus an
orthogonal engine fix).

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
