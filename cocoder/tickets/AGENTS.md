# `cocoder/tickets/` — Ticket tracker

Workspace-global tickets. Distinct from priorities (long-running goals) and Playbook tasks (in-Playbook todos).

## When to file a ticket

| Situation | File a ticket? |
|---|---|
| A bug surfaces that needs tracking but isn't blocking current Playbook execution | Yes |
| A question the founder needs to answer later | Yes |
| A spike or research task to validate an assumption | Yes |
| A task that belongs inside an active Playbook | No — add it to the Playbook |
| A long-running goal | No — file as a priority |

## Structure

```
tickets/
├── AGENTS.md      # this file (routing + conventions)
├── INDEX.md       # slim mirror — one row per ticket (open + recently closed)
├── open/
│   └── NNNN-slug.md
└── closed/
    └── NNNN-slug.md
```

## Ticket file format

```markdown
---
id: NNNN
title: <one-line title>
type: bug | task | question | spike
status: Open | In Progress | Blocked | Closed | Cancelled
priority: <priority-slug or "none">
owner: <persona-or-human>
created: YYYY-MM-DD
closed: YYYY-MM-DD  (optional, when status=Closed)
---

# NNNN — <title>

## Context
[Why this ticket exists]

## Acceptance
[How we know it's done]

## Notes
[Working notes, links, references]
```

## Lifecycle

1. **Open:** create `tickets/open/NNNN-slug.md` (next sequential N); add a row to `INDEX.md` under **Open**
2. **Update:** edit the file; update `INDEX.md` row if title/owner/status changed
3. **Close:** set `status: Closed`, add `closed: YYYY-MM-DD`, move file to `tickets/closed/NNNN-slug.md`; update `INDEX.md` row (move to **Recently Closed**, or remove if older than 30 days)
4. **Cancel:** same as close but with `status: Cancelled` and a brief cancellation reason in Notes

## SSOT rule (per `../AGENTS.md`)

Ticket files are canonical for all metadata. `INDEX.md` is a mirror. Updates to ticket files require same-change-set updates to `INDEX.md`.

## Numbering

Strict sequential — never reuse. To find the next number: look at the highest N in `open/` ∪ `closed/` and add 1.
