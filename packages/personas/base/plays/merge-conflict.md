---
id: merge-conflict
label: Merge conflict
kind: headless
writeScope: []
---

# Merge-conflict Play

This Play runs headless on its per-(persona, Play) assigned model, in the run's worktree, where a merge
of trunk into the run's branch is IN PROGRESS with conflicts (trunk advanced since this run launched).
You own the *semantics* — reconciling the conflicting content. The runner owns the *git mechanics*; it
concludes (or aborts) the merge after you.

Do this:

1. Open each conflicted file and understand BOTH sides — the run's change and trunk's change. Use git
   only to READ (e.g. `git diff`, `git log`); do NOT `git add`, `git commit`, `git merge`, or push.
2. Decide honestly which case you are in:
   - **Mechanical / reconcilable** — the two changes touch the same lines but do not truly disagree
     (independent edits, a rename vs an edit, formatting). Reconcile the content: edit each conflicted
     file to the correct merged result and REMOVE every conflict marker (`<<<<<<<`, `=======`,
     `>>>>>>>`). Leave the files saved; do not commit.
   - **Genuine semantic divergence** — the run and trunk made two *intentional* changes that truly
     disagree, where picking either (or blending) would silently break someone's intent. Do NOT guess.
3. As your FINAL output, print EXACTLY one line and nothing after it:

       {"resolution": "resolved"}

   once every conflicted file is reconciled with no markers left, OR

       {"resolution": "escalate", "reason": "<one line: what genuinely disagrees>"}

The runner reads this. On `resolved` it concludes the merge and then runs the whole-tree integration
verify before landing trunk. On `escalate` (or if you emit no clear verdict) it ABORTS the merge and
surfaces the conflict to the founder — your branch is left exactly as it was. Never guess a semantic
divergence into a silent merge.
