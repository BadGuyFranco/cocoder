---
id: oz-held-back-expand-scope
title: "Oz: a founder-reachable expand-scope → commit path for held-back files"
---

## Objective
When a run holds back out-of-scope changes (ADR-0023 §5), the founder can **allow** them with one action
— commit the held-back files to the active branch through the commit spine — without leaving the CoCoder
flow or committing by hand. **Verified when:** from the Oz run drawer (and/or an Oz-chat verb), a
founder can resolve a `pending-scope-decision` run with `expand` and the held-back files land on the
active branch with a receipt; the run then settles `completed`. Boundary: `packages/daemon`
`resolveRun` gains an `expand` disposition (commit the precise held-back set — derived from the run's
`out-of-scope` events, intersected with the working tree — via `commitFiles`; direct-mode only, refuse
for isolation runs with a clear message) + the founder-facing trigger (run-drawer button; Oz-chat
`expand` verb is the smaller alternative since Oz chat has no resolve verb today). No core/orchestration
changes.

## Context (operational)
**Earned from run_81 (2026-06-14).** The first post-reset run held back `scripts/proof-priorities-queue.mjs`
+ a `package.json` line (out of Bob's `packages/**` scope). Oscar correctly said he couldn't commit them
(outside every persona's scope; loop ended), but there was **no wired way to execute the "expand scope"
he suggested** — `resolveRun` only offers `discard` / `landed`, and Oz chat has no resolve verb at all.
The founder was stuck on the last mile; the harness had to be committed by hand. This is the
founder-friction fix, not a machinery failure (nothing stranded — the held-back files were safe in the
working tree). Small + concrete. Fold in the cosmetic dedup of the `landing-outcome` out-of-scope list
(run_81 showed each file 3×) while here.
