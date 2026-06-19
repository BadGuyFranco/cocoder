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

Archive exactly one existing priority file from invocation input. This is lower-stakes than creating
or redefining an Objective, but it still changes governance state and must be precise.

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
3. Move the priority file according to the chosen convention. If using the fallback, create
   `cocoder/priorities/archive/` if needed and move the file to
   `cocoder/priorities/archive/<id>.md`.
4. Remove the archived id from `cocoder/priorities/order.json` if that file exists and contains it.
   Preserve the JSON shape and every other priority id.
5. Run the elegance checkpoint before finishing: preserve the live archive convention, avoid creating a
   second archive mechanism, touch only the priority file and order surface required for the move, and do
   not remove evidence a fresh agent needs to understand why the priority was archived.
6. Validate the archived priority still parses with `parseFrontmatter` and `loadPriority` from its new
   directory, and validate `order.json` remains valid JSON if edited.

Do not run git and do not commit. The dispatch harness commits the move and order update through the
one governance spine (`commitGovernance`) after this Play returns. Leave only the intended priority
archive changes so the post-dispatch tree is clean after that commit.
