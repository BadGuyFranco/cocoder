# Documentation Freshness Policy

**Status:** Draft, implemented by Sub-Playbook D Solve  
**Last verified:** 2026-06-20 (scrubbed stale v1 session-host reference from the audit cadence)

CoCoder docs should say when they were last checked against the implementation. Freshness stamps do not prove correctness by themselves, but they make stale claims visible during review.

## Stamp format

Use a short stamp near the top of durable architecture, ADR, and public docs:

```markdown
**Status:** Draft, Active, Accepted, Superseded, or Archived  
**Last verified:** YYYY-MM-DD (short evidence note)
```

The evidence note should name the strongest check available: a command, test suite, audit run, founder review, or targeted manual verification.

## Architecture verification

[`ARCHITECTURE.md`](../ARCHITECTURE.md) is the public system map. Update its verification stamp when a change alters storage zones, launch flow, security boundaries, package layout, or public-facing architecture claims.

An architecture stamp should cite evidence such as:

- a passing focused test or package suite
- a launch or compose dry run
- a doc-reference audit
- a founder-approved architecture review

Do not update the stamp for unrelated wording-only edits unless the reviewer actually re-checked the architectural claims.

## ADR verification

ADRs under [`cocoder/decisions/`](../cocoder/decisions/) record decisions, not task notes. When implementation catches up to an ADR, or when behavior changes away from it, update the ADR status and verification stamp in the same review window.

Recommended ADR states:

- **Proposed** - not ratified yet.
- **Accepted** - ratified and current.
- **Implemented** - ratified and verified in code or docs.
- **Superseded** - replaced by a newer ADR.

If an ADR is superseded, link the replacement decision and avoid editing old rationale except for the status note.

## Public doc audit cadence

Run a lightweight doc audit during each release-candidate pass and after any change that touches:

- launch commands or cmux session behavior
- workspace storage zones
- Oz security or launch behavior
- persona, route, or profile contracts
- public onboarding instructions

Minimum local checks (the same gate CI runs):

```bash
pnpm typecheck                 # src + tests, every package
pnpm test                      # all package suites
node scripts/check-topology.mjs
```

Then grep the docs for stale commands/paths against the real CLI surface in `packages/cli/src/run.ts`
(e.g. confirm every `cocoder …` invocation a doc shows still exists) and run the relevant
`scripts/proof-*.mjs` real-path proof for any behavior a doc describes. For docs that describe an
operator path, pair these static checks with a real or dry-run command and record the limitation in the
`Last verified` note.

## Deferred Oz freshness panel

The Oz freshness panel is deferred to v0.2. In v0.1, freshness remains a documentation and review discipline enforced by stamps, check commands, and release closeout notes.
