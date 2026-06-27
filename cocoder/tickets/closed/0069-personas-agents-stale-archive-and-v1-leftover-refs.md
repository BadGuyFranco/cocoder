---
id: 0069
title: cocoder/personas/AGENTS.md has two stale path references (archived-priority + v1-leftovers list)
type: bug
status: Closed
priority: none
owner: oscar-run_269
created: 2026-06-27
---

# 0069 — cocoder/personas/AGENTS.md stale path references

## Context
Doc Truth Analysis (run_269) audited the `cocoder/**` governance docs against live code. Two concrete
stale references were found in `cocoder/personas/AGENTS.md`. The fix is out of run_269's Oscar
support-commit scope (which does not include `cocoder/personas/**`), so it is filed here to be landed by
a run that holds `cocoder/personas/**` write-scope. Both are doc-side staleness — no code is wrong.

## Discrepancies (verified against live tree 2026-06-27)

1. **`cocoder/personas/AGENTS.md:19-20` — wrong archived-priority path.**
   Doc says: *"(Priority archived to `priorities/zArchive/v2/base-and-extension-personas.md`.)"*
   Live: `cocoder/priorities/zArchive/` does not exist (the archive convention is `cocoder/priorities/archive/`),
   and the file actually lives at `cocoder/zArchive/priorities/v2/base-and-extension-personas.md`.
   Fix: repoint to `cocoder/zArchive/priorities/v2/base-and-extension-personas.md` (or drop the parenthetical).

2. **`cocoder/personas/AGENTS.md:32` — "v1 leftovers" list names dirs/files that were already cleaned up.**
   Doc says: *"`_archived-v1/`, `custom/`, `playbooks/`, `prompts/`, and `PORT-NOTES.md` are pre-rebuild v1 artifacts … kept as reference pending cleanup."*
   Live: `ls cocoder/personas/` → only `AGENTS.md, assignments.json, custom/, deltas/`. Of the five named
   leftovers, only `custom/` remains; `_archived-v1/`, `playbooks/`, `prompts/`, `PORT-NOTES.md` are all gone.
   Fix: update the paragraph to reference only `custom/` (the sole surviving v1 artifact), or drop the
   paragraph if `custom/` is also slated for removal.

## Acceptance
- `cocoder/personas/AGENTS.md` both references resolve against the live tree (no `not found` path), verified
  by `ls`/`find`.
- No code change (both are doc-side staleness).

## Resolution

Resolved by run run_270 (def9786d63315fb7b0373e0b4bf466f4d8aeb329) on 2026-06-27.

Fixed cocoder/personas/AGENTS.md stale references: the archived priority path now resolves to cocoder/zArchive/priorities/v2/base-and-extension-personas.md, and the v1 leftovers paragraph now names only the remaining custom/ artifact. Verified with path checks, stale-reference grep, topology check, and the core test suite.
