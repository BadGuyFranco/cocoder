---
doc-type: current-truth
---

# Documentation Freshness Policy

**Status:** Draft, implemented by Sub-Playbook D Solve  
**Last verified:** 2026-06-28 (defined doc-type taxonomy; pointed the governed set at `governedDocGlobs`; resolver proof covered by `packages/core/tests/drift-resolve-doc-references.test.ts`)

CoCoder docs should say when they were last checked against the implementation. Freshness stamps do not prove correctness by themselves, but they make stale claims visible during review.

## Stamp format

Use a short stamp near the top of durable architecture, ADR, and public docs:

```markdown
---
doc-type: current-truth
---

**Status:** Draft, Active, Accepted, Superseded, or Archived  
**Last verified:** YYYY-MM-DD (short evidence note)
```

The evidence note should name the strongest check available: a command, test suite, audit run, founder review, or targeted manual verification.

## Doc-type taxonomy

The documentation-truth process has one type declaration: a governed doc may declare
`doc-type: <type>` in front matter, alongside the existing `Status` and `Last verified` stamps.
Allowed values are `current-truth`, `design-intent`, `owner-map`, and `historical`.

When `doc-type` is absent, treat the doc as `current-truth`. The default is strict so a new or
unclassified governed doc is checked rather than silently skipped.

| Type | Definition | Reference and freshness rule |
|---|---|---|
| `current-truth` | The doc states how CoCoder works now or how a founder/operator should use it now. | **Strict resolve.** Concrete references must resolve against the live tree because readers use these docs as current operating truth. This covers internal Markdown links, file and directory paths, ADR IDs, CLI commands and flags, package names, and named code symbols. Keep the `Last verified` stamp current when those claims change or are re-checked. |
| `design-intent` | The doc describes a planned, proposed, or aspirational design that is not claiming implementation parity. | **Exempt from strict resolve.** Concrete references may point to intended future surfaces because the doc is a design target, not a live-tree guarantee. The status or body must make the non-current nature clear, and the `Last verified` stamp should record the design review or source, not pretend the implementation exists. |
| `owner-map` | The doc maps ownership, consumers, and verification surfaces for a subsystem or contract. | **Strict resolve.** Owner maps are used to route changes safely, so concrete references must resolve unless a row explicitly labels an item historical or future intent. Keep freshness evidence tied to the map's owning subsystem or contract. |
| `historical` | The doc preserves a dated record, audit, retired design, or superseded implementation context. | **Exempt from strict resolve.** Historical records may contain stale paths or commands because changing them can rewrite evidence. The status or opening note must identify the record as historical, archived, superseded, or one-shot; new current-truth claims should move to the live owner doc instead of being added here. |

## Governed doc set

The executable governed-doc-set boundary is the exported `governedDocGlobs` constant in
[`packages/core/src/drift/resolve-doc-references.ts`](../packages/core/src/drift/resolve-doc-references.ts).
Update that constant when the governed set changes; this policy owns the taxonomy, declaration
convention, and freshness rules, while the drift module owns the one executable glob list that CI and
local checks read.

`README.md` and `CONTRIBUTING.md` are governed docs in that executable set but are outside this atom's
committable `docs/**` write lane; resolving that lane mismatch is a known follow-up for the CI-check
atom or its supporting scope change.

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
