---
id: 0015
title: Ticket files without YAML frontmatter are silently dropped by the loader
type: bug
status: Closed
priority: tickets-review
owner: oscar run_131
created: 2026-06-17
closed: 2026-06-19
---

# 0015 — Ticket files without YAML frontmatter are silently dropped by the loader

## Symptom
A committed ticket can be completely **absent** from the dashboard / `GET /workspaces/:id/tickets`
with no error anywhere. Found run_131: ticket `0014` was committed correctly but never appeared in Oz.
Running the loader directly:

```
CORE IDS: 0003:open, 0005:open, 0012:open, 0013:open, 0001:closed, 0002:closed, 0004:closed,
          0006:closed, 0007:closed, 0008:closed, 0010:closed
CORE 0014: MISSING
```

`0014` is missing — and so are `0009` and `0011`. The common factor: those three are authored in the
**inline `**Status:** … | **Type:** …`** style with **no `---` YAML frontmatter block**; every ticket
that *does* load has YAML frontmatter.

## Root Cause
`parseFrontmatter` (`packages/core/src/personas/frontmatter.ts:17`) **throws** on any file lacking a
`---`-delimited block ("Throws on a missing/!malformed frontmatter block" — by design). `loadTicket`
(`packages/core/src/tickets/loader.ts:44`) calls it eagerly, so it throws for a no-frontmatter ticket.
`readStateDir` (`loader.ts:74-78`) wraps `loadTicket` in `try { … } catch { /* not a ticket file */ }`
— a **silent swallow**. Result: any ticket the parser can't read just disappears, with no log, no
warning, and no entry in the returned list. The dashboard then looks complete when it isn't.

This is two defects compounding: (a) the loader hard-requires frontmatter that some authored tickets
don't have; (b) the failure is silent, so a dropped ticket is indistinguishable from "no such ticket."

## Fix options (pick at build)
1. **Surface, don't swallow:** `readStateDir` should not silently discard a `NNNN-*.md` file that fails
   to parse — emit a warning / include a malformed-ticket marker so the drop is visible. Silence is the
   trap, per shared-standards (no silent caps).
2. **Tolerate the inline format** (or normalize on read): treat a ticket with no frontmatter by falling
   back to the H1 title + filename id (the loader already has `titleFromBody`/`idFromFile` fallbacks —
   the only blocker is `parseFrontmatter` throwing before they run). A no-frontmatter ticket should load
   with null metadata rather than vanish.
3. **Enforce frontmatter at authoring** (a lint / the create-ticket Play templates it) so new tickets
   can't be born unreadable — complements, not replaces, (1).

## Acceptance criteria
- A `NNNN-*.md` ticket that fails to parse is **never silently dropped** — it is surfaced (warning
  and/or a visible malformed entry), proven by a loader test over a fixture with one good + one
  unparseable ticket.
- Backfill: `0009` and `0011` (currently invisible) load again — either by the loader tolerating their
  format or by adding frontmatter to them.
- `readTickets('cocoder/tickets')` returns `0014` (and `0009`/`0011`) after the fix.

## Workaround applied run_131
`0014` was given proper YAML frontmatter so it loads now; this ticket tracks the underlying
silent-drop defect so the next inline-format ticket doesn't vanish the same way.

## Resolution — 2026-06-19

Closed by existing loader repair plus this durability pass:

- `packages/core/src/tickets/loader.ts` loads no-frontmatter ticket files via filename/H1 fallbacks and
  warns instead of silently swallowing malformed `NNNN-*.md` tickets.
- `packages/core/tests/tickets.test.ts` proves a mixed good/no-frontmatter/malformed fixture loads the
  good and fallback tickets, warns on the malformed one, and includes real fallback tickets `0009`,
  `0011`, and `0014`.
- `packages/core/tests/orchestration-contracts.test.ts` pins ticket authoring to core
  `composeTicketMarkdown` so a second markdown template is not introduced in the create-ticket Play.
