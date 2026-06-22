---
id: 0026
title: Scaffold governance commit omits cocoder/workspace.json and cocoder/counters.json
type: bug
status: Closed
priority: new-primary-root
owner: oscar run_177
created: 2026-06-22
---

# 0026 — Scaffold governance commit is missing files it writes

## Context
On the first live onboarding (Job Hunt, run_178, 2026-06-22) the scaffold governance commit `2ef1de1`
captured 16 files but left **`cocoder/workspace.json`** and **`cocoder/counters.json`** untracked
(`git status`: both `??`). The scaffold writes those files into the target's `cocoder/` zone, but the
commit file-list (`scaffolded` in `packages/daemon/src/routes.ts:752-763`) does not include them, so they
never enter git.

This is distinct from [0025](./0025-git-init-baseline-commit-full-tree.md): 0025 is about importing the
*user's* tree on `git init`; this is about the scaffold's *own* governance files being committed
completely. It applies to **both** the new-primary (git-init) and onboard-existing (already-git) paths,
because both go through the same `scaffolded`-only commit list.

## Why it matters
`workspace.json` is workspace identity (`{schemaVersion, id, name}`) — it should be version-controlled like
the rest of the governance zone. CoCoder's own repo tracks the equivalents (`cocoder/counters.json` is
tracked here; `cocoder/runs/**` is committed as run-history by the runner), so the onboarded zone is
inconsistent with our own convention. Whatever `scaffoldWorkspaceGovernance` writes into `cocoder/**`
should be in the governance commit (or explicitly `.gitignore`d if it is pure runtime churn — decide per
file, don't leave them as silent untracked drift).

## Proposal
Make the scaffold commit list complete: ensure `scaffoldWorkspaceGovernance`'s return value (the
`scaffolded` paths) includes every governance file it writes — at minimum `cocoder/workspace.json` and
`cocoder/counters.json` — so the governance commit tracks them. If any scaffold-written path is genuinely
runtime-only, add it to `cocoder/.gitignore` instead, so the disposition is explicit rather than
accidental-untracked.

## Acceptance
- After a fresh workspace create, `git status` shows no untracked scaffold-written `cocoder/**` files: each
  is either committed in the governance commit or covered by `cocoder/.gitignore`.
- A test asserts the governance commit's tracked set equals the scaffold's written set minus the ignored
  set (no silent omissions).

## Refs
- Owner: `packages/daemon/src/routes.ts:752-763`; `scaffoldWorkspaceGovernance`
  (`packages/core/src/scaffold/scaffold.ts`).
- Sibling: [0025](./0025-git-init-baseline-commit-full-tree.md) (full-tree baseline on git-init).
- Discovered: Job Hunt onboarding (run_178); reassessed run_177.

## Resolution

Resolved by run run_181 (38e368e92c6beb463451de5becefdbbca1128205) on 2026-06-22 (Atom E).

`scaffoldWorkspaceGovernance` now seeds and includes every scaffold-written `cocoder/**` file in the governance commit — at minimum `cocoder/workspace.json` and `cocoder/counters.json` (previously written but left untracked). A daemon real-git test on the already-git path (no baseline backstop) pins the invariant that the tracked `cocoder/**` set equals the written set minus the `.gitignore`-ignored set, and explicitly asserts both files are committed in the governance SHA.
