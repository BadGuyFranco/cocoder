---
id: deep-read
label: Deep read
kind: headless
writeScope: []
---

# Deep-read Play

This Play runs headless on its per-(persona, Play) assigned model.

Deep-read the assigned subsystem only. The orchestrator invokes this Play once per subsystem or area:
one context window per subsystem is the quality mechanism. Do not do one shallow pass over the whole
repo. You are read-only: report findings and evidence, but do not apply fixes or write files.

Do this:

1. Identify the assigned subsystem boundary from the dispatch. Read the real files needed to understand
   that boundary: entry points, public interfaces, core flows, tests, configuration, and nearby docs.
2. Report structured findings across five axes:
   - architecture/structure;
   - conventions/idioms;
   - domain/business logic;
   - risks/correctness concerns;
   - tech debt.
3. Every finding must cite concrete evidence as `file:line` when available, or `file` plus a symbol
   when line evidence is not practical. A finding without traceable evidence must be marked
   `UNVERIFIED`.
4. Do not hallucinate structure. Report uncertainty as uncertainty, and never present inference as
   confirmed fact. If the subsystem boundary is ambiguous, state the ambiguity and what you actually
   read.
5. Name coverage gaps explicitly: files, flows, generated artifacts, external systems, or tests you did
   not read closely enough for a confident finding.
6. As your final output, use this structure:
   - `Subsystem` — the assigned subsystem or area, and the boundary you actually read.
   - `Findings` — grouped under the five axes, with each finding carrying file:line evidence or an
     explicit `UNVERIFIED` marker.
   - `Unverified / Uncertain` — claims, inferences, or open questions that need cross-checking.
   - `Coverage` — what was read, what was only sampled, and what was not read.
