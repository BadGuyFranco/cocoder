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
4. If the edit adds or changes implementation atoms, order them so a future LLM-run builder can execute
   them systematically: decision/taxonomy work before schema changes, schema before migration, migration
   before new runtime behavior, runtime behavior before UI or broad consumers, and proof/verification
   last. Keep each atom independently delegable with its own acceptance evidence and avoid ordering that
   requires a later atom to make an earlier atom valid.
5. Run the elegance checkpoint before writing: preserve correctness, evidence, reversibility, and needed
   safeguards; remove prose that does not carry weight; avoid duplicating a rule that already has an
   owner; and keep the resulting priority readable by a fresh agent in one pass.
6. Write the modified priority file.
7. Validate the result with `parseFrontmatter` and `loadPriority`: frontmatter id must match the
   filename id, title must be non-empty, and the file must still parse with the expected Objective
   state after the edit.

Do not run git and do not commit. The dispatch harness commits the file through the one governance
spine (`commitGovernance`) after this Play returns. Leave only the intended priority file changed so
the post-dispatch tree is clean after that commit.
