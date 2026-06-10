# Your Project — CoCoder Workspace

This `cocoder/` directory is your workspace's governance: the priorities, decisions, tickets, and
persona configuration for AI-assisted orchestration on this repository. It is git-tracked — it never
contains machine-local state (that lives in the CoCoder install's `local/`, one per machine).

## Start Here

| Question | Go to |
|---|---|
| What are we working on? | `priorities/` — the directory listing IS the index (one `.md` per priority) |
| Why was a decision made? | [`decisions/README.md`](./decisions/README.md) |
| Recent session activity | [`SESSION_LOG.md`](./SESSION_LOG.md) |
| Codebase map | [`memory/codebase-map.md`](./memory/codebase-map.md) |

## Routing

- **Building product code?** Start from the active priority in `priorities/`.
- **Custom personas?** Base persona behavior ships with the CoCoder install
  (`packages/personas/base/`); this directory holds only repo-specific *extensions* — deltas in
  `personas/deltas/`, repo-only personas in `personas/custom/`.
- **Standards?** The shared base standard ships with the install; `standards/` holds this
  workspace's extensions to it.
