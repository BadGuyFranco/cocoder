---
id: create-ticket
label: Create ticket
kind: headless
executionModel: prompt-only
triggerClass: persona-requested
purpose: Create one open ticket from persona-provided follow-up input.
allowedCallers:
  - oz
  - oscar
  - bob
  - deb
requiredCheckpoints:
  - shared elegance checkpoint
writeScope:
  - cocoder/tickets/**
---

# Create Ticket Play

This Play runs headless on its per-(persona, Play) assigned model.

This Play is the model-mediated ticket creation process. The executable lanes are governed:

- Persona-requested or API-triggered dispatch uses this Play body and commits through the authoring
  harness for `POST /workspaces/:id/authoring-plays/create-ticket`.
- From a terminal outside the run loop, use the dedicated governed-spine wrapper:
  `pnpm --dir <install-root> exec cocoder oz create-ticket --title <text> --type <type> --priority <priority> [--description <text> | --details-file <path> | --details-stdin] [--id <id>] [--run <runId>]`.
  That wrapper calls the core `createTicket()` spine directly; it is the fallback/control-plane lane,
  not a reason to hand-edit ticket files, `INDEX.md`, or `order.json`.

Create exactly one open ticket from invocation input. Tickets are governance records for follow-up
work, faults, or questions discovered mid-run. Use the same ticket file format as the
dashboard create-ticket route; do not invent a second ticket template.

Do this:

1. Run the elegance checkpoint from the Elegance Standard in
   `packages/personas/base/shared-standards.md` before composing the ticket.
2. Validate the invocation before writing:
   - `title` must be a non-empty string.
   - `type` must be one of `bug`, `task`, or `question`; default to `task`.
   - `priority` defaults to `none`.
   - `owner` is the core `TICKET_OWNER` constant.
   - `created` is today's ISO date (`YYYY-MM-DD`).
3. Allocate the next id by the same rule as core `nextTicketId`: inspect existing files under
   `cocoder/tickets/open/` and `cocoder/tickets/closed/`, take the highest four-digit prefix, add one,
   and zero-pad to `NNNN`.
4. Refuse on id collision. The chosen id must not already exist in either ticket state directory or in
   the Open table in `cocoder/tickets/INDEX.md`.
5. Slugify the title with the dashboard route rule: lowercase, replace non-`a-z0-9` runs with `-`,
   trim leading/trailing `-`, collapse repeated `-`; fallback to `ticket` if the slug is empty.
6. Compose the ticket file using core `composeTicketMarkdown(id, input, created)`, the single owner of
   the ticket markdown format. The file must include complete frontmatter: `id`, `title`, `type`,
   `status: Open`, `priority`, `owner`, and `created`. This full frontmatter is required so ticket
   0015's silent-drop failure cannot recur.
7. Write `cocoder/tickets/open/NNNN-slug.md`.
8. Update `cocoder/tickets/INDEX.md` by inserting the Open-table row in the exact dashboard route
   shape, using core `ticketTableCell` and `insertOpenTicketIndexRow`:
   `| [NNNN](./open/NNNN-slug.md) | title | type | priority | owner |`
9. Validate the written ticket round-trips through core `loadTicket` or `readTickets`: id, title, type,
   status, priority, owner, created, and state must all match, and metadata must be non-null. Fail
   loudly and leave a clear error if validation fails.
10. Leave only the intended ticket file and `cocoder/tickets/INDEX.md` changed.

Do not run git and do not commit. The dispatch harness commits the file and INDEX update through the
one governance spine (`commitGovernance`) after this Play returns.
