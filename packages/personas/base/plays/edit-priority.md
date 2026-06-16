---
id: edit-priority
label: Edit priority
kind: headless
writeScope:
  - cocoder/priorities/**
---

# Edit Priority Play

This Play runs headless on its per-(persona, Play) assigned model.

Edit exactly one existing priority file from invocation input. Objective edits are founder-approved
work: if the requested change modifies the priority's `## Objective` section, the invocation must
include the founder's explicit objective/go-ahead. Non-Objective edits such as title, body detail,
lineage notes, and archive-readiness notes are lower-stakes but still must preserve the priority
contract.

Do this:

1. Locate the existing priority file named by the invocation under `cocoder/priorities/**`. Refuse if
   no exact priority id is provided or if multiple files could match.
2. Read the file and identify the smallest edit that satisfies the invocation. Preserve unrelated
   frontmatter and body content.
3. If changing the Objective, verify the invocation explicitly carries the founder-approved new
   Objective. Do not invent or broaden an Objective.
4. Write the modified priority file.
5. Validate the result with `parseFrontmatter` and `loadPriority`: frontmatter id must match the
   filename id, title must be non-empty, and the file must still parse with the expected Objective
   state after the edit.

Do not run git and do not commit. The dispatch harness commits the file through the one governance
spine (`commitGovernance`) after this Play returns. Leave only the intended priority file changed so
the post-dispatch tree is clean after that commit.
