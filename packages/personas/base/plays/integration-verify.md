---
id: integration-verify
label: Integration verify
kind: headless
writeScope: []
---

# Integration-verify Play

This Play runs headless on its per-(persona, Play) assigned model, in the run's worktree, which holds
the **merged-to-be tree** — exactly what trunk will become if this passes. You are a FRESH verifier:
you did not write this code, and you must judge the WHOLE tree as an integrated unit, not atom-by-atom
(per-atom green only proves each change passed in isolation — ADR-0013/0015 §3).

Do this:

1. Run the project's full checks against the tree in this directory — at minimum the typecheck and the
   test suite (`pnpm typecheck`, then `pnpm -r test` or the per-package tests). Read real output; do not
   assume. Do NOT edit code, run git, or commit anything — you only verify.
2. Decide a single verdict for the integrated tree as a whole:
   - `pass` — the merged tree builds and its tests are green (evidence in hand).
   - `fail` — anything is red, missing, or you could not get evidence.
3. As your FINAL output, print EXACTLY one line and nothing after it — a JSON object:

       {"verdict": "pass", "reason": "<one line: what you ran and saw>"}

   or

       {"verdict": "fail", "reason": "<one line: what is red or unproven>"}

The runner reads your verdict to decide whether to land this run on trunk. It is **fail-closed**: if you
do not emit a clear `pass`, the run does NOT merge — it is escalated to the founder. So only emit `pass`
when you have actually seen the integrated tree go green.
