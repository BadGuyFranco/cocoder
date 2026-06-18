---
id: tickets-review
title: "Tickets review — browse and fix tickets from the dashboard"
---

## Objective
A founder can **review and fix tickets** from the CoCoder dashboard. Two deliverables: (1) the dashboard
panel that today shows **Priorities** and **Run History** as pseudo-tabs becomes **real tabs** —
**Priorities** (unchanged), a new **Tickets** tab (lists the workspace's tickets from `cocoder/tickets/`
with status/type and a detail view), and a **Runs** tab (the run history, replacing the current
runs *button*) — selecting a tab cycles the panel content in place; and (2) a way to act on a ticket:
from the Tickets tab the founder can launch a **ticket-fix run** that proposes/applies the fix and, on
success, **closes the ticket** (moves it `open/ → closed/`, updates `INDEX.md`) through the ADR-0023
commit spine. **Verified when:** the dashboard renders the three working tabs (Priorities behaves as
before; Tickets lists open tickets incl. real ones (e.g. `0003`/`0005`/`0012`) with a readable detail; Runs shows the
same history the button did); AND one real open ticket is fixed end-to-end via a launched run whose
result is committed and whose ticket is moved to `closed/` with `INDEX.md` updated — traceable to the
actual change. **Boundary:** does not change the ticket *governance model* (ADR-0003 flat files +
`INDEX.md` stay the source of truth) and introduces no new commit lane (the fix run commits via the
existing spine); UI work is confined to the dashboard panel + ticket read/launch surface.

## Design decisions — RATIFIED at the priority-start alignment beat (founder, 2026-06-17)
The founder ratified the Objective and the four deferred design questions. These are now fixed inputs
to decomposition — do not re-open without a new founder decision.

1. **Run shape to fix a ticket — small Oscar↔Bob run for code-touching tickets** (Oscar scopes the
   ticket as an atom or two, verifies, gates the commit, closes the ticket) — keeps the no-human-backstop
   verify gate. **Lighter path (Bob-only, or ad-hoc lane) for trivial doc/task tickets**, selected by
   ticket `type`.
2. **Launch surface — reuse, do not fork.** A ticket target reuses the **generalized run-target
   plumbing** from `new-primary-root`'s Addendum Atom 2 (run-target + daemon launch surface). This
   priority **sequences after** that atom lands (or folds a shared `target = ticket | priority | playbook`
   abstraction into it) — it must **not** add a parallel ticket-launch lane (single source of truth,
   global #7). `RunInput` is hard-typed to `priority: Priority` today; that is the generalization both
   priorities depend on.
3. **Ticket-close mechanics through the spine.** The fix run itself performs the `open/ → closed/` move
   + `INDEX.md` edit + resolution line **inside its write-scope**, committed by the ADR-0023 spine — not
   a separate manual step.
4. **Tabs scope — in-panel content cycling** (not routes/windows). Priorities stays byte-for-byte as-is;
   the Runs tab fully **replaces** the run-history *button* (button removed, not duplicated). The
   panel-header **"+ / add" button is contextual per tab**: Priorities → *add a priority* (existing
   `onAddPriority`); Tickets → *add a ticket* (new); Runs → **no add button**.
   **Refined (founder, 2026-06-17 live review):** the per-tab add uses a **modal dialog for BOTH** tabs
   (founder enters the details), and the item is **actually created by Oz** via a daemon create endpoint —
   **not** a chat-prefill. Priorities already does this (`NewPriorityModal` → `createPriority` POST →
   daemon writes the file, `routes.ts:485`). Tickets must get the parallel: a `NewTicketModal` + a
   create-ticket endpoint that writes `cocoder/tickets/open/NNNN-slug.md` + updates `INDEX.md` via the
   spine. The run_121 chat-prefill stub for add-ticket is **superseded** by this.

## Conflict-scan (light — first pass; re-verify at start)
- **Dashboard is live** (`packages/ui/app/sections/dashboard/Dashboard.tsx` — Run History is currently a
  Modal opened by a button; the Priorities/Run-History pseudo-tabs match the founder's description). No
  ADR forbids the tab refactor; confirm current dashboard state at start (an older note referenced an
  "Oz dashboard archived" event — verify what that referred to before touching UI).
- **No existing tickets/dashboard priority** collides; `tickets-review` is net-new.
- **Run-target coupling:** question 2 above overlaps the `new-primary-root` executor's launch-surface
  work (run currently targets `priorityId`); coordinate so the ticket-launch path reuses rather than
  forks that plumbing.
- Objective **RATIFIED** by the founder 2026-06-17 (ADR-0010 go-ahead given); design questions resolved
  above. Ready to decompose on the next launch.
- **Stale-data found at start (re-verified):** the Objective originally named ticket `0009` as a proof
  example, but `0009` is already **closed** (2026-06-17) — proof ticket will be one of the real open
  tickets (`0003`/`0005`/`0012`). The ticket **index was inconsistent**: `0005` existed in `open/` but was
  missing from `INDEX.md`'s Open table, and the active design-ref ticket conflicted with closed
  `post-wrap-orchestration-commit-gap`. Reconciled by run_121 atom 0 as the **first build atom**.

## Live-review bugs (founder, 2026-06-17 — run_122)

The run_121 tabs passed automated tests but the founder found three defects in the running build. **Bugs
1 and 3 are code-complete (run_122); Bug 2 is infra — the live daemon predates the tickets routes.**

1. ✅ **FIXED (`0266172`, run_122) — Double header above the tabs.** Removed the icon/title/count row;
   promoted the tab strip to be the panel header (larger tabs); kept the contextual per-tab add button.
2. ⚠️ **INFRA — Tickets count shows 0 in the live build** despite real open tickets (`0003/0005/0012`).
   The data layer is unit-test-green; the running daemon predates `GET /workspaces/:id/tickets` (run_121)
   and `POST /workspaces/:id/tickets` (run_122). **`scripts/oz.sh restart`** (founder action — Oscar does
   not restart the daemon) activates both routes; until then the count stays 0 and Add-ticket errors at
   the bridge — expected, not a code defect. **Follow-on:** extend ticket 0010's finalization auto-rebuild
   to `packages/daemon/**` so daemon-touching runs do not require manual restart.
3. ✅ **FIXED (`bdddf29` + `efb9714`, run_122) — Add-ticket modal + create endpoint.** `NewTicketModal`
   (title/type/priority/description) + `handleCreateTicket`; `POST /workspaces/:id/tickets` allocates
   next NNNN, writes `cocoder/tickets/open/NNNN-slug.md`, updates `INDEX.md` via the ADR-0023 spine
   (mirrors `createPriority`). Defaults: type `bug|task|question|spike` (default `task`); priority default
   `none`; owner `founder-session`; created = today. Replaced the run_121 chat-prefill stub.

## Decomposition — status (run_122, 2026-06-17)

**Disposition:** `continue` — Deliverable 1 (three dashboard tabs + live-review fixes) is code-complete;
   founder **`scripts/oz.sh restart`** still needed to prove Bug 2 live. Deliverable 2 (atom 4,
   ticket-fix launch) remains **gated** on `new-primary-root` Addendum Atom 2 (run-target generalization).
   Not archive-ready until one open ticket is fixed end-to-end via a launched run whose close lands on
   trunk.

1. ✅ **DONE (`6aa5f60`) — Ticket-index hygiene** (`cocoder/tickets/**`): `0005` added to `INDEX.md` Open
   table; duplicate ID `0007` resolved by renumbering the active design-ref ticket `0007 → 0012` (closed
   historical `0007` left intact). Open tickets now `0003 / 0005 / 0012`.
2. ✅ **DONE — Tickets data layer** (`5da8926`, `packages/core` + `packages/daemon` + `packages/ui`) and
   the **Tabs refactor** (`70940a1`, `packages/ui/**`): core `readTickets` → daemon
   `GET /workspaces/:id/tickets` → UI adapter/fixture, then the in-panel **Priorities/Tickets/Runs** tabs
   (Runs replaced the history button **and** modal; contextual add per tab; Priorities byte-for-byte
   unchanged). **The original "tabs refactor" was split into a data-layer atom + a UI atom** because
   listing real tickets required new read plumbing (no ticket reader/type/endpoint existed). Deliverable 1
   (three working tabs) complete + verified.
3. ✅ **DONE (run_122) — Live-review fixes (bugs 1 + 3; Bug 2 = founder daemon restart).**
   - **`0266172` — Bug 1:** tab strip promoted to panel header; dashboard test assertions updated.
   - **`bdddf29` — Bug 3 backend:** `POST /workspaces/:id/tickets` + electron IPC + `createTicket` client.
   - **`efb9714` — Bug 3 UI:** `NewTicketModal` + `handleCreateTicket`; chat-prefill stub removed.
   - **Bug 2 (count=0):** not a buildable atom — stale daemon; founder `scripts/oz.sh restart`.
4. ⛔ **GATED — Ticket-fix launch (Deliverable 2, atom 4)** — **on `new-primary-root` Addendum Atom 2**
   (decision 2). Verified run_121/run_122: `RunInput`/`buildRunInput`/`launchRun` are still hard-typed to
   `priorityId`; no `target = ticket | priority | playbook` abstraction exists. From the Tickets tab,
   launches a fix run that closes the ticket via the spine — but must **reuse** the generalized run-target,
   not fork. Relaunch `tickets-review` for this atom only after `new-primary-root` Addendum Atom 2 lands;
   proof ticket = one of `0003 / 0005 / 0012`.

## Decomposition — status (run_132, 2026-06-18) — CONTINUE (core deliverables done; folded-in scope remains)

**Disposition:** `continue` — NOT archive-ready. **Correction (founder challenge, 2026-06-18):** an
earlier run_132 note wrongly marked this `archive-candidate` / "code-complete" by treating the run_131
folded-in items as optional. They are **in-scope requirements of this priority** (the founder folded them
in; single owner per surface, global #7) — the priority cannot archive with them unresolved unless the
founder explicitly de-scopes them. Deliverables 1 + 2 ARE complete (the two original deliverables + the
ticket↔priority card/modal/launch parity + the 0015 loader fix). **Still in-scope and UNBUILT, blocking
archive:** (a) reorderable tickets, and (b) the `create-ticket` authoring Play for all personas. Plus the
live end-to-end proof (founder action). The run-target gate was found already landed (`9f76e98`, run_123),
so atom 4 extended that discriminator rather than forking.

**Built + verified-on-evidence this run (diff read + suites + typecheck per atom, committed):**

- ✅ **Atom 0 — Ticket loader: surface, don't swallow** (`1f15bac`, `packages/core/src/tickets/**`).
  `loadTicket` tolerates frontmatter-less tickets (null metadata, id/title fallbacks) without weakening
  `parseFrontmatter` for persona/play/playbook callers; `readStateDir` warns instead of silently
  dropping. Resolves ticket **0015**. Backfills `0009`/`0011`/`0014` into the loaded set.
- ✅ **Atom 1 — Ticket run-target backend** (`a59610c`, `packages/core/src/store/**` + `daemon`).
  `Run.ticketId` store discriminator mirroring `playbookId` (precedence ticket→playbook→priority);
  `LaunchRunTarget` gains `ticket`; `launchRun` ticket branch validates unknown/closed (400) and runs the
  PRIORITY lifecycle via a shared `assembleRunInput` (no `buildRunInput` fork) using a synthetic in-memory
  Priority whose Objective is seeded from the ticket body (no priorities file written); `POST /runs`
  enforces exactly-one-of-three.
- ✅ **Atom 2 — Tickets-tab UI parity** (`c7bb787`, `packages/ui/**`). Compact id+title cards (type/status
  chips off the card face); click → shared `Modal` (metadata + pre-wrap body); old in-panel detail view
  removed.
- ✅ **Atom 3 — Close-on-success** (`899d8bd`, `packages/core/src/tickets/{close,index-helpers}.ts` +
  `daemon`). Core `closeTicket` writer + shared INDEX helpers (create & close de-duplicated to one source):
  `open/ → closed/` move, `status: Closed`, a `## Resolution` line traceable to runId+sha, INDEX row
  Open→Recently-Closed. Daemon fires it ONLY on a `completed` ticket run via `commitGovernance`/the spine
  (audited `ticket-close`); no-ops/audits on missing-or-already-closed; leaves the ticket open on a
  non-success run.
- ✅ **Atom 4 — 'Launch fix' wired live** (`1c0d160`, `packages/ui/**`). `launchTicketRun` (POST /runs
  {ticketId}) + `handleLaunchTicket` mirror the priority Launch path; `onLaunchTicket` + `launchBlocked`
  threaded to the modal button (`disabled={!live || launchBlocked}`, click → launch + close modal).

**REMAINING IN-SCOPE WORK BLOCKING ARCHIVE** (all from this priority's scope — NOT optional):
1. **Reorderable tickets** (net-new product, needs a build run). Generalize the priority order mechanism
   (`order.json` + `writePriorityOrder` / `priority-order.ts`) to a ticket order applied to the open-tickets
   list — do NOT add a parallel mechanism. Decompose: a core/daemon ticket-order primitive + endpoint, then
   UI drag-reorder on the ticket cards mirroring `PriorityRow`.
2. **`create-ticket` authoring Play for ALL personas** (net-new product, needs a build run). Add a
   `create-ticket` authoring Play (analogous to `create-priority`/`edit-priority` in `AUTHORING_PLAY_IDS`,
   `daemon/launcher.ts`) so any persona (Oz/Oscar/Bob/Deb) can file a ticket mid-run, reusing the SAME
   ticket-write path as the founder modal (`POST /workspaces/:id/tickets`). MUST template proper YAML
   frontmatter (id/title/type/status/priority/owner/created) so created tickets are not silently dropped.
3. **Inline "Launch fix" button on the ticket CARD** (net-new product, needs a build run — founder,
   run_133). Today launch lives only inside the ticket detail modal; the founder wants a card-level
   Launch button mirroring `PriorityRow`'s inline Launch (Priorities.tsx — card keeps an inline Launch
   alongside the in-modal one), so a fix can be launched straight from the Tickets list without opening
   the modal. Reuse the existing `onLaunchTicket` path + `launchBlocked` guard; `e.stopPropagation()` so
   the card Launch does not also open the modal. Surface: `TicketsTab` card in
   `packages/ui/app/sections/dashboard/Dashboard.tsx`.
4. **Live end-to-end proof** (founder action, not a build atom): launch a fix run for ticket **0003** from
   the live dashboard Tickets tab → confirm it executes and closes (`0003` moves `open/ → closed/`,
   `INDEX.md` updated, commit on trunk, traceable to the change). Daemon must serve current code: atom 1's
   launch path self-restarts an *idle* stale daemon; otherwise a founder `scripts/oz.sh restart` is needed.

Items 1–3 are **net-new product code (Surface-B)** and need a build run (relaunch `tickets-review`) — they
were not built this run and were briefly mis-labeled "deferred / not blocking." **Already RESOLVED, not
remaining:** the ticket card + detail modal + in-modal launch-fix (atoms 2+4), the
launch-fix-closes-modal behavior (atom 4), and the 0015 silent-drop loader defect (atom 0 — durable fix,
already landed; do not re-list as a gap). Note: full priority-parity also needs the **card-level inline
Launch button** (item 3 above) and **reorderable cards** (item 1) — those are the still-open parity gaps.

## Folded in (founder, 2026-06-17 run_131) — ticket↔priority UI parity + create-ticket Play
The founder folded the Oz-dashboard **ticket** items here (they belong to the ticket surface this
priority owns; `oz-dashboard-ux` keeps the priority-card / priority-modal / run-modal items and points
here for tickets — single owner per surface, global #7). These are **deliverable extensions**, to
decompose into atoms when this priority next launches.

- **Ticket↔priority interaction parity (same card → modal → launch pattern).** Today tickets render in a
  tab with a detail *view*; bring them to the **same pattern as priorities**: a compact **card (name +
  slug only**, no description), click → **detail modal** showing the ticket body + status + where it
  stands, with a **launch affordance inside the modal**. This reuses whatever card/modal pattern
  `oz-dashboard-ux` establishes for priorities — do not invent a second pattern.
- **"Launch fix" button inside the ticket modal — closes the modal on launch.** This is the founder-facing
  UI for **atom 4** (ticket-fix launch). The button + modal can be built now; the *launch it triggers*
  stays **gated on Addendum Atom 2** (run-target generalization). Wire the button to atom-4's launch path
  once it exists; until then it is disabled/clearly pending, never a fork.
- **Reorderable tickets.** Tickets get a persisted order like priorities — **generalize** the priority
  `order.json` + `writePriorityOrder` (`priority-order.ts`) to a ticket order, rather than a parallel
  mechanism. Order applies to the open-tickets list.
- **Create-ticket Play — runnable by ALL personas.** A `create-ticket` **authoring Play** (analogous to
  the existing `create-priority` / `edit-priority` / `archive-priority` authoring Plays in
  `AUTHORING_PLAY_IDS`, `daemon/launcher.ts`) so **any persona (Oz, Oscar, Bob, Deb)** can file a ticket
  during a run, not only the founder via the dashboard modal. **Reuse the existing ticket-write path**
  (`POST /workspaces/:id/tickets` / the core ticket-write primitive that allocates the next `NNNN`,
  writes `cocoder/tickets/open/NNNN-slug.md`, and updates `INDEX.md` via the ADR-0023 spine — Bug 3,
  run_122) — the Play is the **agent-facing entry**, the modal is the **founder-facing entry**, both land
  through the **same** writer. **MUST template proper YAML frontmatter** (`id/title/type/status/priority/
  owner/created`) so created tickets are not silently dropped by the loader — see ticket
  [0015](../tickets/open/0015-tickets-silently-dropped-without-frontmatter.md).
- **Related defect:** ticket [0015](../tickets/open/0015-tickets-silently-dropped-without-frontmatter.md)
  (no-frontmatter tickets silently dropped) is in this priority's scope; the Tickets surface should
  **surface**, not swallow, an unparseable ticket. Worked around run_131 (gave `0014` frontmatter);
  the loader fix is the durable resolution.
