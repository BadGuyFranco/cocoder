---
id: build-priorities-from-plan
title: Build priorities from the plan
---

## Objective
When launched, Oscar reads the rebuild plan (the PLAYBOOK + the ADRs) and the existing priorities,
finds work that has been decided but does not have a priority yet, and drafts new priority Playbooks
for it — presenting each Objective in plain English for the founder to approve before it is written.
**Verified** when a launch produces at least one new, founder-approved priority stub in
`cocoder/priorities/` (or a clear "nothing left to draft" report). Boundary: this priority only drafts
*other priorities* — it writes governance (`cocoder/priorities/`) and never builds product code.

This is how you create priorities today, with no new Oz screens: launch this, and Oscar turns
decided-but-unbuilt work into approved priority stubs. (Implementation note for the run: it writes the
governance zone, not `packages/**`, so the run's write-scope/commit handling differs from a normal
builder run — design homework when this is first run.)
