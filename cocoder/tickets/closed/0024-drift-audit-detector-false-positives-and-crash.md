---
id: 0024
title: drift-audit path detector is false-positive-prone and crashes on a same-line duplicate claim id
type: bug
status: Closed
priority: drift-audit
owner: founder-session
created: 2026-06-21
closed: 2026-06-21
---

> **Closed 2026-06-21.** Both defects fixed in `packages/core/src/drift/read-claims.ts`:
> (1) **no more crash** — path refs come from markdown-link hrefs + standalone backtick spans (link text is
> stripped before the backtick scan, so a self-link no longer double-counts), plus a per-line slug guard;
> (2) **precise detection** — `isPathRef` rejects npm scopes (`@…`), `ADR-NNNN` refs, slash-delimited word
> lists, globs (`*`), bare extensions (`.mjs`), and trailing-slash dir mentions, and resolves relative
> (`../`) refs to repo-relative before the reality check. Result: the corrected dogfood governance now
> yields **0 findings** (was 16 false positives). Pinned by a new case in `drift-read-claims.test.ts`.
> Heuristic by nature (prose path detection can't be exhaustive), but a correct file is now clean — the
> prerequisite for a trustworthy drift-audit ratify→apply.

# 0024 — drift-audit detection needs refinement before it can drive apply

## Context
Running `node scripts/run-drift-audit.mjs` against the dogfood (2026-06-21) to apply the long-standing
"25 stale-path findings" surfaced two real defects in `packages/core/src/drift/read-claims.ts` (+ the
compare path detector). The genuine drift — `cocoder/memory/codebase-map.md` + `tech-stack.md` were
wholesale v1-stale — was fixed by rewriting both to v2 reality. But the tool itself is not yet
trustworthy for an automated apply.

## Defect 1 — crash on same-line duplicate claim id (brittle)
A governance file with two references to the same path on one line throws and aborts the **entire** audit:

    Error: governance claims: duplicate claim id "memory:codebase-map:5:architecture-md"
    at assertUniqueIds (packages/core/src/drift/read-claims.ts:157)

Trigger: an ordinary markdown self-link `[`ARCHITECTURE.md`](../../ARCHITECTURE.md)` — link text + href
both slug to `architecture-md` on the same line. A valid governance file should never crash the audit;
the claim id should include column (or dedupe identical refs), not `throw`.

## Defect 2 — path detector has a high false-positive rate
The extractor treats any slash-containing token as a path. Against the corrected (accurate) memory files
it flagged **16 false positives**, e.g.:

- package names — `@cocoder/core`, `@cocoder/adapters`, … (7)
- ADR references — `ADR-0010/0028`, `ADR-0003/0027`
- slash-delimited lists — `zod/ajv/yup/joi/valibot`, `start/stop/status/restart`
- a glob — `scripts/proof-*.mjs`
- a **negation** — `packages/schemas` (the text says it does *not* exist)
- relative links it doesn't resolve — `../../ARCHITECTURE.md` (real file; `../../` not normalized from the file's dir)

So a *correct* governance file generates noise that masks real drift. Detection must: ignore `@scope/pkg`
specifiers and `ADR-NNNN` tokens, skip slash-lists/globs/inline-code lists, resolve relative paths from the
referencing file's directory, and not flag a path that appears in a negation.

## Ask
Refine `read-claims`/`compare` so (1) it never crashes on duplicate ids, and (2) path detection is precise
enough that a correct governance file yields ~zero findings. This is a **prerequisite for the drift-audit
priority's ratify→apply step** — until then, apply must stay manual (as it was this session). Pin the fixes
with cases in `scripts/proof-drift-audit.mjs` / the drift suite.
