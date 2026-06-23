---
id: 0032
title: Created priority can be hidden — file exists with no order.json entry (ghost/"draft" priority)
type: bug
status: Open
priority: oz-autonomy
owner: Deb
created: 2026-06-23
---

# 0032 — Created priority can be hidden — file exists with no order.json entry (ghost/"draft" priority)

## Context

A priority file can exist under `cocoder/priorities/*.md` without an entry in `cocoder/priorities/order.json`,
which makes it invisible to the founder-facing surface. There must be **no such thing as a "draft" or hidden
priority** — every created priority is visible by construction.

Confirmed this run (run_194, workspace `cocoder`):
- `cocoder/priorities/oz-file-access.md` exists on disk but is **absent from `order.json`** (pre-existing strand).
- `cocoder/priorities/oz-autonomy.md` was created the same way (committed `23ea916`) and is likewise absent.

`order.json` at the time held only: `founder-stop-control`, `launch-disposition-first`, `new-primary-root`,
`model-layer`, `ripgrep-dependency-research`, `priority-audit`.

Root cause to investigate: the authoring path — the `create-priority` Play, the Oz `author` tool, and direct
Oscar support-writes into `cocoder/priorities/**` — lets a priority file land **without registering the new id
in `order.json`** (or in an explicit `archive/` / `backlog/` home), and nothing fails when a priority file has
no `order.json` entry. Related ghost/strand F-class failures are catalogued in `cocoder/failure-catalog.md`.

## Acceptance

Every created priority is visible by construction. Either (or both):
- **One-owner registration:** the authoring/commit spine that writes a `cocoder/priorities/*.md` file also
  registers the id in `order.json` (single owner of priority registration), so no path can create a file
  without scheduling it; AND/OR
- **Guard/validator:** a test/loader check fails the commit when a `cocoder/priorities/*.md` file exists with
  no `order.json` entry and no explicit `archive/`/`backlog/` placement.

Proven by a test that fails on an orphaned priority file and passes once registration/placement is enforced.
Resolution must also schedule or explicitly archive the two existing orphans (`oz-file-access`, `oz-autonomy`).

## Notes

- Likely needs an ADR or amends existing authoring decisions (ADR-0025 atomic authoring Plays, ADR-0010
  priority/order ownership). Deb to propose: one-owner registration vs. guard, or both, for Oscar evaluation.
- Surfaced by the founder during run_194 as an orchestration failure to address ASAP via the ADR-0036
  Oscar↔Deb repair dialogue. That dialogue itself failed to run — see ticket 0033 (it blocks the fast path
  for fixing this one).
