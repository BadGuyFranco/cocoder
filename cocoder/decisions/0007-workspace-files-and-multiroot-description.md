---
id: ADR-0007
title: "Workspace files — storage location and the multi-root description convention"
status: accepted
date: 2026-05-26
relates-to: ADR-0006
---

# ADR-0007: Workspace files — storage location and the multi-root `description` convention

## Context

CoCoder orchestrates one or more root folders at once — a multi-root workspace, mirroring a Cursor/VS Code `.code-workspace`. A workspace usually contains the user's product project plus support roots (the CoCoder engine itself, shared context, a secrets root). Oz (the cross-workspace control plane) needs to know, for any workspace, **which root is the primary project to load and which are helpers**. We also need a defined home for these workspace files. [ADR-0006](./0006-no-nested-workspaces-inside-install.md) already forbids nesting a *worked* workspace inside the install repo; this ADR covers where the workspace *definition files* live and how their roots are classified.

## Decision

1. **Format.** Workspace files use the standard VS Code `.code-workspace` JSON shape (`folders: [{ name, path }], settings: {}`) so they open natively in VS Code/Cursor and work with the existing launcher.

2. **Storage location.** Workspace files are stored in `<CoCoder>/cocoder/local/` — the per-machine, gitignored zone (only `README.md` + `.gitignore` are tracked there). Workspace files carry machine-specific relative paths to sibling repos, so they are private/per-install, not committed.

3. **CoCoder is always a root.** Every CoCoder workspace includes the CoCoder repo as a root (the orchestration engine). In a workspace whose primary project *is* CoCoder (the dogfood), CoCoder is both engine and primary.

4. **`description` field on each folder.** Each `folders[]` entry carries an optional `description` string alongside the standard `name`/`path`. VS Code ignores unknown folder keys, so the file stays a valid workspace; Oz reads `description` to classify roots.

5. **Primary/Helper convention.** A folder's `description` begins with a role token:
   - `Primary:` — the single primary project root Oz loads as the active workspace.
   - `Helper:` — a support root (engine, shared context, secrets) loaded for context but not the work target.
   This is the proposed parseable encoding; it may evolve to a dedicated key. The workspace **registry** entry schema (`packages/schemas/src/workspaces-registry.ts`) already uses `.passthrough()`, so adding a structured `description`/`role` to registry entries later is non-breaking.

6. **First instance.** `cocoder/local/CoCoder.code-workspace` (created 2026-05-26) emulates the launcher's `Shared/Workspaces/CoCoder.code-workspace`: roots CoCoder (Primary), CoBuilder, cofounder, memory (Helpers), with recomputed relative paths so it opens correctly from its new location.

## Consequences

- Oz gains a deterministic way to pick the primary root and present helpers; the add/edit-workspace UI and registry plumbing are tracked under the `v0.3-workspace-lifecycle` priority.
- Project/per-workspace **secret** storage is a separate, still-open decision (where and how project API tokens are secured "inside the repo folder"); it is captured as a work item under the same priority, not decided here.
- Because workspace files are gitignored, the canonical example for adopters is documented (this ADR + the workspace template), not shipped as a tracked file in `cocoder/local/`.

## Alternatives considered

- **Dedicated `primary: true` boolean per folder** — rejected for now: the founder asked specifically for a `description` field, and overloading it keeps the surface minimal. Revisit if prefix-parsing proves fragile.
- **Store workspace files in `<CoCoder>/local/` (install zone)** — rejected: the founder specified `cocoder/local/`. The install zone keeps the Oz workspace *registry* (`local/workspaces.json`); the human-authored `.code-workspace` files live in `cocoder/local/`.
