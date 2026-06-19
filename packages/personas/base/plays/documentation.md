---
id: documentation
label: Documentation
kind: headless
executionModel: prompt-only
triggerClass: persona-requested
purpose: Update documentation narrowly so it reflects a real change or named target area.
allowedCallers:
  - oscar
  - bob
  - deb
writeScope:
  - docs/**
  - **/*.md
  - README*
  - ARCHITECTURE*
---

# Documentation Play

This Play runs headless on its per-(persona, Play) assigned model.

Update the project's documentation so it reflects the current state of the change, diff, or named
target area. Documentation work is precise maintenance, not invention: update only what genuinely
changed, stay inside this Play's write-scope, and do not edit product or source code.

Do this:

1. Read the provided change, diff, or target area. Identify the behavior, architecture, workflow,
   command, or contract that changed.
2. Find the documentation that now conflicts with that reality, is missing required context, or points
   readers at stale instructions. Prefer existing owner documents over creating new ones.
3. Update the stale documentation narrowly. Preserve surrounding style and avoid speculative roadmap,
   marketing, or implementation detail that is not supported by the current project state.
4. Leave unrelated documentation untouched. If a nearby document looks stale but is outside the
   supplied change or this Play's write-scope, report it instead of editing it.
5. As your final output, report:
   - Which documentation files changed and why.
   - What evidence you used from the diff, tests, code, or project instructions.
   - What you deliberately left untouched and why.
   - Any remaining documentation risk or follow-up needed.
