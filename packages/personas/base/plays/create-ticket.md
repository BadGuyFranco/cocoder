---
id: create-ticket
label: Create ticket
kind: headless
writeScope:
  - cocoder/tickets/**
---

# Create Ticket Play

This Play runs headless on its per-(persona, Play) assigned model.

Create exactly one open ticket from invocation input. Tickets are governance records for follow-up
work, faults, questions, or spikes discovered mid-run. Use the same ticket file format as the
dashboard create-ticket route; do not invent a second ticket template.

Do this:

1. Validate the invocation before writing:
   - `title` must be a non-empty string.
   - `type` must be one of `bug`, `task`, `question`, or `spike`; default to `task`.
   - `priority` defaults to `none`.
   - `owner` is the core `TICKET_OWNER` constant.
   - `created` is today's ISO date (`YYYY-MM-DD`).
2. Allocate the next id by the same rule as core `nextTicketId`: inspect existing files under
   `cocoder/tickets/open/` and `cocoder/tickets/closed/`, take the highest four-digit prefix, add one,
   and zero-pad to `NNNN`.
3. Refuse on id collision. The chosen id must not already exist in either ticket state directory or in
   the Open table in `cocoder/tickets/INDEX.md`.
4. Slugify the title with the dashboard route rule: lowercase, replace non-`a-z0-9` runs with `-`,
   trim leading/trailing `-`, collapse repeated `-`; fallback to `ticket` if the slug is empty.
5. Compose the ticket file using core `composeTicketMarkdown(id, input, created)`, the single owner of
   the ticket markdown format. The file must include complete frontmatter: `id`, `title`, `type`,
   `status: Open`, `priority`, `owner`, and `created`. This full frontmatter is required so ticket
   0015's silent-drop failure cannot recur.
6. Write `cocoder/tickets/open/NNNN-slug.md`.
7. Update `cocoder/tickets/INDEX.md` by inserting the Open-table row in the exact dashboard route
   shape, using core `ticketTableCell` and `insertOpenTicketIndexRow`:
   `| [NNNN](./open/NNNN-slug.md) | title | type | priority | owner |`
8. Validate the written ticket round-trips through core `loadTicket` or `readTickets`: id, title, type,
   status, priority, owner, created, and state must all match, and metadata must be non-null. Fail
   loudly and leave a clear error if validation fails.
9. Leave only the intended ticket file and `cocoder/tickets/INDEX.md` changed.

Do not run git and do not commit. The dispatch harness commits the file and INDEX update through the
one governance spine (`commitGovernance`) after this Play returns.
