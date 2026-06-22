---
id: 0025
title: git-init of a non-git primary root must baseline-commit the full existing tree, not only the cocoder zone
type: bug
status: Closed
priority: new-primary-root
owner: oscar run_177
created: 2026-06-22
---

# 0025 — Baseline-commit the existing tree when git-initializing a primary root

## Context
First live onboarding of a non-git primary root (`/Volumes/NAS LOCAL/Anthony/Job Hunt`, run_178,
2026-06-22). When a primary root is not yet a git repo, `createWorkspace` runs `git init` and then commits
**only the scaffolded paths** — the `cocoder/**` zone plus a seeded root `.gitignore`
(`packages/daemon/src/routes.ts:748-763`: the commit file-list is `scaffolded.map(...)`). The user's
entire existing tree (`Resumes/`, `Recruiters/`, `Outreach/`, `Process/`, `README.md`, `AGENTS.md`, …) is
left **untracked**. Confirmed in the live repo: `git show --stat 2ef1de1` committed 16 files, all under
`cocoder/`; `git status` shows every product folder as `??`.

## Why this is wrong (founder, run_177)
The point of `git init` is to track the repo's changes from a clean baseline. Leaving the working tree
untracked defeats that and degrades downstream behavior: the audit synthesizes governance that references
files with no git history/baseline, future commit-spine operations behave unpredictably against a tree of
untracked files, and the founder gets a permanently noisy `git status`. The earlier framing that this was
"correct because the audit never seizes product code" **conflated two different things**: the
`auditWriteBoundary` trust boundary governs what CoCoder *modifies* (only `cocoder/**`), it does **not**
mean git should *track* only `cocoder/**`. Tracking ≠ modifying. Establishing a baseline commit of the
user's own files in the user's own local repo is exactly what they want; CoCoder still never edits those
files.

## Proposal
When (and only when) `createWorkspace` itself initializes the repo (`initializedRepo === true`), make a
**baseline commit of the full existing working tree** (`git add -A` honoring `.gitignore`) **before/around**
the `cocoder/` governance commit, so the very first history entry is "import existing tree". The seeded
root `.gitignore` already excludes the heavy/noisy items — verified against Job Hunt: `node_modules/`
(there is a vendored `Process/scripts/node_modules`), `.DS_Store`, `*.log`, archives — so the baseline is
clean. Do **not** baseline-commit when the root is already a git repo (existing repos own their own
history; only the `cocoder/**` governance commit applies there).

## Safety
- Honor `.gitignore` (already seeded) — that is the mechanism that keeps `node_modules/`, OS cruft, and
  archives out of the baseline. No secret/`.env` files were present in the Job Hunt tree, but the fix must
  rely on `.gitignore` (not assume cleanliness) and must **never add a remote or push** — local baseline
  only.
- The trust boundary is unchanged: CoCoder still writes/modifies only `cocoder/**`; a baseline import is a
  one-time snapshot of files the user already authored, not a CoCoder edit.

## Acceptance
- Onboarding a non-git primary root yields a first commit (or pair) where the user's existing tree is
  tracked (honoring `.gitignore`) and the `cocoder/` zone is committed — `git status` is clean of the
  user's content afterward.
- Onboarding an already-git repo is unchanged: no baseline re-import, only the `cocoder/**` governance
  commit.
- Pinned by a daemon real-git test: create a workspace on a non-git fixture containing product files + a
  `node_modules/`; assert the product files are tracked, `node_modules/` is not, and the cocoder zone is
  committed.

## Refs
- Owner: `packages/daemon/src/routes.ts:748-763` (`createWorkspace` init + commit).
- Sibling gap in the same commit list: [0026](./0026-scaffold-governance-commit-incomplete.md).
- Discovered: first live non-git onboarding (Job Hunt, run_178); reassessed in run_177.

## Resolution

Resolved by run run_181 (ad457ebcd3854d413d4e933c51842416b8e16342) on 2026-06-22 (Atom D).

`createWorkspace` now baseline-commits the user's full existing tree (`git add .`, honoring the seeded `.gitignore`) when — and only when — it git-inits a non-git primary root; already-git repos get no baseline re-import (only the `cocoder/**` governance commit). A daemon real-git test proves product files are tracked, `node_modules/` is excluded, the cocoder zone is committed, and `git status` is clean; an existing-git test proves no re-import.
