---
id: deep-read
label: Deep read
kind: headless
executionModel: prompt-only
triggerClass: persona-requested
purpose: Deep-read one assigned subsystem and return structured evidence-backed findings.
allowedCallers:
  - bob
  - oscar
writeScope: []
---

# Deep-read Play

This Play runs headless on its per-(persona, Play) assigned model.

Deep-read the assigned subsystem only. The orchestrator invokes this Play once per subsystem or area:
one context window per subsystem is the quality mechanism. Do not do one shallow pass over the whole
repo. You are read-only: report findings and evidence, but do not apply fixes or write files.

Exactly one subsystem is assigned per invocation. Take that boundary from the dispatch text. Refuse
scope creep outside that boundary except for directly adjacent files needed to understand an interface
or call path, and name those adjacency reads in coverage. If the dispatch names multiple subsystems or
the boundary is ambiguous, state the ambiguity, define the narrow boundary you actually read, and do
not guess at the rest.

Do this:

1. Identify the assigned subsystem boundary from the dispatch. Read the real files needed to understand
   that boundary: entry points, public interfaces, core flows, tests, configuration, and nearby docs.
2. Report structured findings across five axes:
   - architecture/structure;
   - conventions/idioms;
   - domain/business logic;
   - risks/correctness concerns;
   - tech debt.
3. Use this fixed shape for every finding so a later cross-check can compare findings without parsing
   prose:

   ```text
   - axis: architecture/structure | conventions/idioms | domain/business logic | risks/correctness concerns | tech debt
     claim: <one-line claim>
     evidence: <file:line> | <file + symbol> | UNVERIFIED
     confidence: high | medium | low
   ```

   The `axis` value must be exactly one of the five axes above. `claim` is one sentence. `evidence`
   must cite concrete evidence as `file:line` when available, or `file` plus a symbol when line
   evidence is not practical. A finding without traceable evidence must set `evidence: UNVERIFIED`.
   `confidence` is your confidence in the claim after reading the evidence, not a substitute for
   evidence.
4. Do not hallucinate structure. Report uncertainty as uncertainty, and never present inference as
   confirmed fact. Label inferred structure with `inference:` in the claim or in `Unverified /
   Uncertain`. If a finding relies on inference rather than traceable evidence, mark it
   `UNVERIFIED`.
5. Name coverage gaps explicitly: files, flows, generated artifacts, external systems, or tests you did
   not read closely enough for a confident finding.
6. As your final output, use this structure:
   - `Subsystem` — the assigned subsystem or area, and the boundary you actually read.
   - `Findings` — grouped under the five axes, with every finding using the fixed `axis` / `claim` /
     `evidence` / `confidence` fields.
   - `Unverified / Uncertain` — claims, inferences, or open questions that need cross-checking.
   - `Coverage` — what was read, what was only sampled, and what was not read.
