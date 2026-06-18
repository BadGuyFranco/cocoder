# ADR-0019 — Multi-root workspaces: `.code-workspace` files, root roles, and where they live

**Status:** Accepted (founder, 2026-06-10 — absorbs the still-live v1 decisions [ADR-0007 as amended
2026-06-08] and [ADR-0006]'s nesting constraint into the live tree; the v1 originals are preserved at
[`zArchive/v1/decisions/`](../zArchive/v1/decisions/) with superseded banners).
**Builds on:** [0008](./0008-repository-topology.md) (storage zones), [0003](./0003-data-model-hybrid.md)
(governance files vs operational DB). **Relates to:** [0017](./0017-oz-orchestration-persona.md) (Oz),
the `full-oz-dashboard` Workspaces slice (#2), and the `new-primary-root` priority (bootstrap/audit).
**Amended by:** [0027](./0027-workspace-storage-contract.md) (founder, 2026-06-18) — workspace **identity**
is split out to a portable, git-tracked `<workspace>/cocoder/workspace.json` (stable id + display name).
The `local/workspace/*.code-workspace` directory below remains the SSOT for **machine-local routing**:
roots, the three role assignments, and per-install paths. Decisions 1–7 stand; only portable identity
moves out of the install-local file so durable history can travel with a repo across machines.

## Context

CoCoder orchestrates one or more root folders at once — a multi-root workspace mirroring a
Cursor/VS Code `.code-workspace`. A workspace is usually the user's product repo (the **primary
root**) plus support roots (the CoCoder engine itself, shared context, secrets). Oz must know, for
any workspace, which root is primary, which are writable, and which are read-only reference.

This was decided in the v1 tree (ADR-0007, revised 2026-05-27, amended by the founder 2026-06-08) and
remained live there even after the v1 tree froze — a standing two-trees trap. This ADR brings the
decision into the one live tree, resolves the amendment's open detail, and records the constraint
from v1 ADR-0006.

## Decision

1. **Format.** Workspace definitions use the standard VS Code `.code-workspace` JSON shape
   (`folders: [{ name, path }], settings: {}`) so they open natively in VS Code/Cursor and work with
   the existing launcher.
2. **Directory-of-files SSOT (founder, 2026-06-08).** Workspace files live in a directory named
   **`workspace`** (not hidden), **one file per workspace, read on load**. That directory is the
   workspace SSOT and supersedes the monolithic `local/workspaces.json` registry (add/remove a
   workspace = add/remove a file; roots and roles live inside each file). The daemon's current
   single-path registry stub is the gap to remove — build-work, not an open decision.
3. **The directory's home is the install zone: `<CoCoder>/local/workspace/`** (founder, 2026-06-10).
   This resolves the 2026-06-08 amendment's open detail — and reverses v1-0007's `cocoder/local/`
   placement, because `cocoder/local/` itself is eliminated ([0008 amendment](./0008-repository-topology.md)):
   a workspace governance dir never contains machine-local state. Workspace files carry
   machine-specific relative paths, so they are per-install and never git-tracked.
4. **Three-role taxonomy.** Each `folders[]` entry carries a structured `role` field (VS Code ignores
   unknown folder keys, so the file stays valid):
   - `primary` — the single main project root; exactly one per workspace; runs resolve here, and its
     `cocoder/` directory is the workspace's governance.
   - `writable` — an additional root the orchestrator may write to only when explicitly in scope.
   - `readonly` — reference material, never written as task output.
5. **`description` is display/context only, never control data.** Oz may show it or pass it as plain
   context, but never parses it for authority, role, scope, ordering, or routing.
6. **CoCoder is always a root.** Every workspace includes the CoCoder repo (the engine). In the
   dogfood, CoCoder is both engine and primary — the one legitimate collapse.
7. **No nested third-party workspaces inside the install** (from v1 ADR-0006). The install repo
   contains exactly one workspace: the dogfood `cocoder/` meta-project at the install root. Any other
   workspace lives outside the install tree; `init`/bootstrap refuses to operate on a nested checkout.

## Consequences

- Oz gains a deterministic way to pick the primary root and enforce writable vs read-only roots; the
  Workspaces CRUD slice builds against this model (the editor rewrites the `.code-workspace` file —
  the file stays the SSOT, no DB copy).
- Per-workspace **secret** storage remains a separate open decision (not decided here).
- Because workspace files are gitignored, the canonical example for adopters is documented (this ADR
  + the workspace template), not shipped as a tracked file.
