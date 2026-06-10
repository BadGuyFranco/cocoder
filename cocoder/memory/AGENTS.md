# `cocoder/memory/` — Workspace memory

Durable knowledge about the workspace that should outlive any single session or Playbook. Read at the start of every meaningful work session.

## Contents

| File | Purpose | Update cadence |
|---|---|---|
| [`codebase-map.md`](./codebase-map.md) | Repository layout + key modules | When directory structure or module boundaries change |
| [`tech-stack.md`](./tech-stack.md) | Languages, frameworks, tools, ADR-locked decisions | When ADRs land or stack changes |
| [`onboarding-questions.md`](./tech-stack.md) | Open questions a new contributor would ask | Append-only as questions surface; resolve by moving to ADR or doc |

`onboarding-questions.md` is created on demand by `cocoder audit-workspace` (Sub-Playbook B). It does not exist yet for CoCoder's own dogfood.

## When to update

- **codebase-map.md** — any time a new package lands, an old one is removed, or a major refactor changes the import graph
- **tech-stack.md** — any time an ADR locks a new tooling decision, or when an existing decision is superseded
- **onboarding-questions.md** — when a new contributor (or a fresh-context agent) asks a question that wasn't documented; capture the question even if you also write the answer elsewhere

## What does NOT go here

- Session-by-session activity → use [`../SESSION_LOG.md`](../SESSION_LOG.md)
- Decisions with rationale → use [`../decisions/`](../decisions/)
- Active work tracking → use [`../priorities/`](../priorities/)
- Scratch notes → use the relevant priority's `notes/`

## SSOT rule (per `../AGENTS.md`)

Memory files are the canonical source for their content. There is no index that mirrors memory — each file is read directly. If a Playbook or document quotes from a memory file, the memory file remains canonical and the quote is informational.
