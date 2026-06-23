---
id: archive-priority
label: Archive priority
kind: headless
executionModel: prompt-only
triggerClass: persona-requested
purpose: Archive one existing priority while preserving the live priority archive convention.
allowedCallers:
  - oz
  - oscar
  - deb
requiredCheckpoints:
  - shared elegance checkpoint
writeScope:
  - cocoder/priorities/**
---

# Archive Priority Play

This Play runs headless on its per-(persona, Play) assigned model.

Archive exactly one existing priority file from invocation input, or backfill the disposition note for
one already-archived priority. This is lower-stakes than creating or redefining an Objective, but it
still changes governance state and must be precise.

The invocation must identify the priority id and may include founder/Oscar disposition fields such as
`verdict`, `reason`, `findings`, `disposition`, `archiveActor`, or `archivedOn`. Treat those fields as
the archive findings to preserve in the priority file; do not invent findings that were not supplied.
Use the current local date as `YYYY-MM-DD` when `archivedOn` is absent. Use `(founder)` as the actor
unless `archiveActor` is explicitly supplied.

Convention to follow: first investigate the live `cocoder/priorities/` tree for an archive convention
such as an `archive/` directory or an archived status field. If a live convention exists, follow it. If
none exists, use `cocoder/priorities/archive/<id>.md` and remove the id from
`cocoder/priorities/order.json`. Do not use frozen history under `cocoder/zArchive/` as the live
priority archive convention.

Do this:

1. Locate the existing priority file named by the invocation under `cocoder/priorities/**`. Refuse if
   no exact priority id is provided or if multiple files could match.
2. Investigate the current live archive convention and state which convention you found before
   writing. If no live convention exists, use the fallback convention above.
3. Build the disposition blockquote before writing. If the invocation includes a short `verdict`, use
   this shape immediately after the closing frontmatter and before `## Objective`:
   `> **Archived YYYY-MM-DD (founder) — <verdict>.** <findings/reason/disposition text>`.
   If there is no separate verdict, use `> **Archived YYYY-MM-DD (founder).** <findings text>`.
   Wrap continuation lines with `> `. Refuse rather than archiving without a supplied disposition or
   an already-present `Archived` blockquote.
4. Move the priority file according to the chosen convention. If using the fallback, create
   `cocoder/priorities/archive/` if needed and move the file to
   `cocoder/priorities/archive/<id>.md`.
5. If the live priority is already absent but `cocoder/priorities/archive/<id>.md` exists, do not create
   a second archive mechanism and do not move anything. Backfill the disposition blockquote into that
   archived file only when it lacks one, or update only the existing disposition blockquote when the
   invocation explicitly asks for replacement.
6. Remove the archived id from `cocoder/priorities/order.json` if that file exists and contains it.
   Preserve the JSON shape and every other priority id.
7. Run the elegance checkpoint before finishing: preserve the live archive convention, avoid creating a
   second archive mechanism, touch only the priority file and order surface required for the move, and do
   not remove evidence a fresh agent needs to understand why the priority was archived.
8. Validate the archived priority still parses with `parseFrontmatter` and `loadPriority` from its new
   directory, and validate `order.json` remains valid JSON if edited.

Do not run git and do not commit. The dispatch harness commits the move and order update through the
one governance spine (`commitGovernance`) after this Play returns. Leave only the intended priority
archive changes so the post-dispatch tree is clean after that commit.
