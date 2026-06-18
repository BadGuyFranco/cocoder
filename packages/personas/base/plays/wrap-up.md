---
id: wrap-up
label: Wrap-up
kind: headless
writeScope:
  - cocoder/priorities/**
  - cocoder/PLAYBOOK.md
  - cocoder/SESSION_LOG.md
  - docs/**
  - ARCHITECTURE.md
  - cocoder/decisions/**
---

# Wrap-up Play

This Play runs headless on its per-(persona, Play) assigned model.

The `writeScope` above is the default allow-list for wrap-up; later assignment machinery may narrow
or refine it for a specific run.

Produce the founder-visible wrap-up for a run. Wrap-up is a content checkpoint, not teardown: no
terminals are closed, and the founder may still ask questions, request a priority update, or explicitly
say "kill" / "tear down" afterward.

1. Update documentation thoughtfully for only what genuinely changed in the run, staying within this
   Play's write-scope.
2. Do NOT run git or commit anything. The CoCoder runner commits your in-scope edits for you, within
   this Play's write-scope. Just make the file edits and stop.
3. Leave the priority with exactly one lifecycle disposition: `continue`, `blocked`, or
   `archive-candidate`. If it is not archive-ready, name the concrete gaps preventing archive across
   product behavior, architecture, tests, documentation, founder decisions, and missing evidence. If it
   appears archive-ready, ask for founder archive confirmation; never self-archive.
4. Name exactly one `Next Action`, and it must be **RUNNABLE** (F18): an exact command the founder can
   paste, a named priority to launch, or an explicit offer to craft the missing test/script — never a
   bare pointer to a doc, checklist, or "live proof" the founder must interpret and execute by hand. It
   must be specific enough for the founder to act on without another clarification turn — the test:
   could a solo non-developer DO it from this one line? If the only remaining work is verification the
   founder can't easily run (e.g. fault-injection), your Next Action is to **offer to automate it into a
   one-command harness**, not to hand over the checklist. Acceptable: `node scripts/<proof>.mjs`,
   "launch `<priority>` for atoms X/Y", "archive after you confirm". Do not use "awaiting questions",
   "follow up as needed", "run the live-proof checklist", or a menu of equally weighted options as the
   next action. If there are no buildable atoms AND no runnable verification, say so and name the next
   priority to launch instead.
5. Emit, as your final output, a founder-readable closeout in the exact section order below. Use
   Markdown bold headings, not HTML. This is a decision brief, not a run ledger. The first screen must
   be enough for a solo non-developer to know what happened, why the run stopped, what remains, and
   which priority or ticket is ready to run next. Keep proof detail, atom-by-atom history, commit lists,
   suite counts, and optional
   operational notes out of the founder brief; those belong in SESSION_LOG, run records, or follow-up
   answers if the founder asks.

   ```
   **What Landed**
   <plain English summary of what changed and was committed this run, 1 sentence max>

   **Disposition**
   <continue | blocked | archive ready>
   <one brief plain-English sentence explaining the disposition, only if useful>

   **What's Left To Close Priority**
   <up to 3 short bullets naming only required remaining gaps; write "Nothing obvious." only if archive ready>

   **Judgement**
   <plain-English call Oscar made to close now instead of continuing, plus any controversial calls if appropriate>

   **Next**
   <exactly one launchable item with its concrete focus: Priority: `slug` — <next run focus> or Ticket: `NNNN` — <next run focus>>

   I'm standing by...
   ```

   - **`What Landed`** states plainly what changed and what CoCoder committed this session. Maximum:
     one short sentence, 180 characters total. Do not add atom history, commit SHAs, test-matrix
     counts, command transcripts, or implementation-file inventories. Do not predict push/remote/PR
     status; CoCoder delivers the authoritative commit outcome right after this wrap.
   - **`Disposition`** is the single lifecycle verdict (§3). Use founder-facing wording:
     `continue`, `blocked`, or `archive ready`. `archive ready` means the existing archive-candidate
     lifecycle judgment: ask for founder archive confirmation; never self-archive.
   - **`What's Left To Close Priority`** is the short version of the required remaining gaps across
     product behavior, architecture, tests, documentation, founder decisions, and missing evidence. Use
     at most three short bullets. Do not include optional nice-to-have work, percentage-complete claims,
     atom labels, implementation labels, or proof-matrix detail here, and do not bury the next move here.
   - **`Judgement`** explains why Oscar stopped now instead of continuing in this same run. If Oscar made
     a debatable call (scope cut, deferral, risk tradeoff, founder-gated decision), state it plainly.
   - **`Next`** is not a task list or confirmation request. It is the founder's confirmation that all
     current work is briefed/committed and one next work item is ready to run. Use exactly one line in
     one of these two forms:

     ```
     Priority: `slug` — <the concrete next atom/proof/founder decision this launch should handle>
     ```

     ```
     Ticket: `NNNN` — <the concrete fix or decision this launch should handle>
     ```

     The priority must be an existing launchable file at `cocoder/priorities/slug.md`; the ticket must
     be an existing open ticket file under `cocoder/tickets/open/`. The focus after the dash is required:
     a bare slug like `Priority: new-primary-root` is not enough because it sends the founder back to the
     priority file to infer the next move. Do not give a menu, do not say "optionally", do not combine
     unrelated actions with "and/or", and do not name archive confirmation as the next item. If the right
     next item does not exist yet, create or update the priority/ticket before wrap-up so `Next` points at
     something ready to run (F1/F20).
   - End with exactly `I'm standing by...` so the founder knows the run remains available for questions,
     priority updates, or explicit `kill` / `tear down`.

The runner persists this output as the run's pickup brief — do NOT write `pickup.md` yourself.
