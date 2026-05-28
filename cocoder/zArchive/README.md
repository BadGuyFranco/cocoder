# zArchive — Frozen v1 reference

**Status: FROZEN — read-only. Do not edit anything under this directory.**

This is a reference snapshot of CoCoder **v1**, captured at the start of the ground-up
rebuild. It exists so the rebuild can mine v1 for proven primitives and observed failures
without keeping the old engine live in the working tree.

| | |
|---|---|
| Frozen at commit | `bb57713` |
| Frozen on | 2026-05-28 |
| Git tag (complete repo) | `archive/pre-rebuild` |

## What's here

- `source/` — a source-only snapshot of the v1 product surface (`packages/`, `docs/`,
  `templates/`, `examples/`, root config + docs). No `node_modules`, no `.git`, no build
  output.

## What's NOT here

- The `cocoder/` meta-project (governance, priorities, ADRs) — it stays **live** in the
  working tree and is preserved in git history anyway.
- `local/` — install-private secrets/state (never archived, never tracked).

## Want the *complete* repo as it was?

The snapshot above is the browsable product source. For the byte-exact full repository
(including the `cocoder/` meta-project and full history) check out the tag:

```sh
git checkout archive/pre-rebuild
```

## Rules

1. **Never edit** files here — it defeats the purpose of a frozen reference.
2. **Never import** from here into the v2 build. To reuse a v1 primitive, *port* it
   deliberately into the new structure (a conscious copy + adapt), and record why in a
   rebuild ADR.
3. This directory is deleted once the v2 MVP is stable and nothing remains to mine.
