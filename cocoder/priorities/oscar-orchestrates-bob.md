---
id: oscar-orchestrates-bob
title: Oscar orchestrates and monitors Bob through a plan
scopeNarrowing: packages/**
---

## Objective
Replace the one-shot run with **Oscar driving Bob through multiple work atoms**: delegate an atom →
continuously watch Bob's live progress (nudge if he stalls or drifts) → verify → next atom — and
**Oscar decides when Bob has had "enough"** (context filling, a natural breakpoint) and ends the run
with a wrap-up + a pickup brief a fresh session can resume from. **Done when**, on a real run: Oscar
takes Bob through more than one atom; catches a stuck or thin Bob from his **live progress** (not a
done-file); and ends the run by his **own** wrap-up decision with a resumable pickup. Built as a
**reusable monitor primitive** so Deb (watch + nudge Oscar; observe-only on Bob) and Oz (watch Oscars
across sessions; observe-only below) are the same pattern one tier up — with the rule **direct your
primary, observe deeper only** enforced. Boundary: the Oscar→Bob tier + the reusable structure; Deb's
and Oz's tiers are their own priorities.

Decided in ADR-0013. This is a run-lifecycle redesign (one-shot → orchestrated multi-atom loop with
continuous observation), and the comprehensive fix for the live failures: Bob can no longer end the run
by finishing something small, Oscar is always engaged, and the wrap-up text falls out of Oscar's
"enough" decision. The hooks already exist (`readScreen` for live progress, `sendInput` to nudge — both
plumbed through cmux); what's missing is the loop that uses them. The verify-gate (ADR-0011) composes in
per atom; commit cadence is design homework. **Large build on the core loop — produce a plan and run an
adversarial review against the ADRs + failure catalog before writing code.**
