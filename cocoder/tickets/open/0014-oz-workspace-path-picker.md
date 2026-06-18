# 0014 — Add-workspace path field has no OS-native directory picker

**Status:** Open | **Type:** bug | **Priority:** new-primary-root | **Owner:** founder-session (filed run_131)
**Filed:** 2026-06-17

## Symptom
In the Oz add-workspace surface, the folder icon next to the repo-path field does **not** open an
OS-style directory picker. Clicking it does nothing actionable — the founder has to hand-type (or
hand-POST) the absolute primary-root path instead of browsing to it.

Observed by the founder while preparing the first non-dogfood workspace (the CoBuilder Takeover copy).

## Impact
This is the **founder-facing entry point** to onboarding any primary root. Without a working picker:
- Adding a workspace requires hand-crafting the absolute path (and getting the `POST /workspaces`
  body exactly right — `id`, the `primary` folder, the required `${COCODER_HOME}` install-root folder,
  the "primary not inside install root" rule). That is error-prone and not a real product flow.
- It blocks the smooth new-workspace → scaffold → launch-Takeover path that the
  [new-primary-root](../../priorities/new-primary-root.md) priority depends on for its live proof.

Not a data-loss or correctness bug; it is a missing UX affordance on the path that makes onboarding
usable. The underlying `POST /workspaces` API already works (it scaffolds + commits the `cocoder/`
skeleton into the chosen primary root); this ticket is only the picker that feeds it a path.

## Expected behavior
- The folder icon opens the **native OS directory picker** (Electron `dialog.showOpenDialog` with
  `properties: ['openDirectory']`), scoped to choosing a single folder.
- The chosen absolute path populates the primary-root field, which then feeds the `POST /workspaces`
  `folders[].path` (role `primary`).
- The chosen path is validated against the same rules the API enforces (exists + is a directory;
  primary must be **outside** the CoCoder install root) with a clear inline error, so a bad pick is
  caught before submit rather than as a 400.

## Likely home (confirm before editing)
- Picker invocation: `packages/ui/electron/main.ts` (native dialog via IPC) + the add-workspace
  component in `packages/ui/app/**` that renders the folder icon/field. The dashboard UI was archived
  earlier (run_103), so confirm which UI surface currently renders this field before implementing.
- No API change expected — `POST /workspaces` (`packages/daemon/src/routes.ts` `createWorkspace`)
  already accepts the path and does the scaffold + commit.

## Acceptance criteria
- Clicking the folder icon opens a native directory picker; selecting a folder fills the path field.
- Submitting creates the workspace via `POST /workspaces` and scaffolds `cocoder/` into the picked
  repo (existing behavior, now reachable without hand-typing).
- A picked path that doesn't exist, isn't a directory, or sits inside the install root is rejected
  with a clear inline message (mirrors the API's `validateWorkspaceRootRules`).
- Verified on evidence: a screenshot or run-through of picking a folder and the workspace appearing in
  `GET /workspaces`, plus the scaffolded `cocoder/` committed on the picked repo's branch.
