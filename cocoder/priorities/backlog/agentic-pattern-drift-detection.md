---
id: agentic-pattern-drift-detection
title: "Agentic pattern-drift detection — catch retired *patterns*, not just gone paths"
---

> **Backlog — founder Objective + ADR pass owed.** Named follow-up from `drift-audit` (archived 2026-06-21).
> drift-audit's shipped detector catches **stale path references** (a governance file names a path that no
> longer exists). It explicitly **deferred** the harder class: **retired patterns** — governance prose that
> describes a *flow/concept* the code no longer has, with no gone path to flag.

## Why (evidence)
Real instances this class would catch that path-detection cannot:
- The dead **ADR-0015 merge/landing machinery** — described as live in comments; no missing path; caught by
  hand and cut via ADR-0034.
- The **`merge-conflict` Play** debris — stale `git.ts` comments + a dangling assignment describing a
  retired flow; fixed by hand.
- **PLAYBOOK history entries** that read as current ("exercised on every run") but describe superseded
  behavior.

## Objective (founder-owned — draft + approve before any code)
Extend the Drift Audit's `read-reality` with **deep-read enrichment** (reuse the existing `recon` /
deep-read fan-out engines — do not fork) so `compare` can flag governance claims whose *described behavior*
contradicts current code, not only whose *paths* are missing. Output stays propose-only (drafts + tickets);
apply remains the founder-ratified `cocoder/**`-bounded step (ADR-0020 Decision 5 / ADR-0023).

**Boundary:** no product-code writes; reuse onboard-existing/drift engines as tooling; precision first — a
correct governance file must yield ~zero findings (the [ticket 0024] bar, extended to pattern claims),
otherwise the noise makes it useless. Likely depends on the agentic deep-read lane being token-budgeted.
