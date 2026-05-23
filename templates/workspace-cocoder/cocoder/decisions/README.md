# Architecture Decision Records (workspace zone)

This directory holds **workspace-level ADRs** for your application repository. They capture context, decision, consequences, and alternatives for choices that affect how CoCoder personas operate on *this* repo.

CoCoder install ADRs live in the CoCoder clone (`<CoCoder>/cocoder/decisions/`). Workspace ADRs live here and travel with your product.

## Conventions

- Filename: `NNNN-kebab-case-slug.md`
- Status: `proposed`, `accepted`, or `superseded`
- Append-only: supersede prior ADRs by reference; do not silently rewrite history
- Link from `cocoder/AGENTS.md` or priority READMEs when a decision gates persona behavior

## Index

| ID | Title | Status |
|---|---|---|
| *(none yet)* | | |

## When to author a workspace ADR

- A persona write boundary or route policy changes for this repo
- Tooling or test commands become canonical for all personas
- Storage or privacy boundaries differ from the CoCoder install defaults

Product-wide architecture that is not persona-specific may also live in a root `ARCHITECTURE.md`; reference it from ADRs instead of duplicating rationale.
