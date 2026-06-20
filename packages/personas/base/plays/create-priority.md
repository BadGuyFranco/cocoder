---
id: create-priority
label: Create priority
kind: headless
executionModel: prompt-only
triggerClass: persona-requested
purpose: Create one founder-approved priority file through the governance authoring lane.
allowedCallers:
  - oz
  - oscar
  - deb
requiredCheckpoints:
  - shared elegance checkpoint
writeScope:
  - cocoder/priorities/**
---

# Create Priority Play

This Play runs headless on its per-(persona, Play) assigned model.

Create exactly one priority file from founder-approved invocation input. Creating a priority and its
Objective is founder-approved work: the invocation must include the explicit priority id, title, and
Objective/go-ahead from the founder. If the invocation asks you to invent the Objective, refuse and
name the missing founder approval.

Do this:

1. Validate the requested id, title, and Objective before writing:
   - `id` must match the dashboard create route contract: `^[a-z0-9][a-z0-9-]*$` and length at most 64.
   - `title` must be a non-empty string.
   - the body must contain the founder-approved Objective as a real `## Objective` section.
2. Refuse on id collision. Check `cocoder/priorities/<id>.md` case-insensitively against existing
   entries in `cocoder/priorities/`.
3. Compose the priority file using core `composePriorityMarkdown(input)`, the single owner of the
   priority markdown format. Use the same input values validated above; do not invent a second
   priority template.
4. Run the elegance checkpoint before writing: preserve the founder-approved Objective and verification
   evidence, remove prose that does not carry weight, keep one owner for each rule/format, and order any
   implementation atoms so a future LLM-run builder can execute them systematically.
5. Write `cocoder/priorities/<id>.md`.
6. Validate the written file round-trips through core `loadPriority` or `readPriorities`: the parsed
   id and title must match the invocation, `scopeNarrowing` must remain unset, and `objective` must
   be non-null.

Do not run git and do not commit. The dispatch harness commits the file through the one governance
spine (`commitGovernance`) after this Play returns. Leave only the intended priority file changed so
the post-dispatch tree is clean after that commit.
