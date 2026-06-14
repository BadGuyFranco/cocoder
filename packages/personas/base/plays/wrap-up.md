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
5. Emit, as your final output, a founder-readable closeout. It **must lead with the `Run Handoff`
   block below** — a scannable answer to "what do I do next?" that a solo non-developer reads in five
   seconds. The detail sections follow it, for reference. A run that ends without leaving the founder
   one obvious move is a failed wrap (the F18/F20 class) — the handoff exists to make that impossible.

   ```
   ── Run Handoff ──────────────────────────────
   Priority worked:   <priority id>
   Disposition:       continue | blocked | archive-candidate — <one clause why>
   This run:          <one line: what changed + what you committed this session>
   Held back:         <out-of-scope files + "reply `expand scope` to commit them, or `discard`">  | none
   Next priority:     <a LAUNCHABLE priority id, or "this one (continue)">
   ► Your move:       <exactly ONE runnable action — see the rules below>
   ```

   - **`Disposition`** is the single lifecycle verdict (§3). If `archive-candidate`, the `► Your move`
     is to confirm archive — never self-archive.
   - **`This run`** states plainly **what you committed this session**. Do NOT assert whether it *landed*
     on trunk (F19) — CoCoder delivers the **authoritative landing outcome** right after this wrap; that
     line, not your prediction, is the source of truth.
   - **`Held back`** — name any out-of-scope files the gate surfaced this run and the exact reply that
     resolves them; write `none` if there were none. Never imply held-back work was lost — it is safe in
     the working tree awaiting the founder's call.
   - **`Next priority`** must be **launchable** (an existing `cocoder/priorities/*.md`) or "this one". If
     the best next step is new work with no priority yet, run the create-priority flow (draft a limited
     Objective → founder approval) so a launchable priority **exists before this run ends** (F1/F20).
   - **`► Your move`** is exactly ONE **runnable** action (F18): a pasteable command, "launch `<id>` in
     Oz", "reply `archive <id>`", or "reply `expand scope`" — never a bare doc/checklist pointer, never a
     menu of equally-weighted options, never "awaiting questions". The test: could a solo non-developer
     DO it from this one line? If the only remaining work is verification the founder can't run, the move
     is your offer to automate it into a one-command harness.

   Then the detail sections (for the founder who wants more — keep each tight):
   - `Summary` — plain English, what was accomplished + the concrete reason for the disposition.
   - `Archive Estimate` — how close to archive and the remaining proof/gap.
   - `Founder Options` — the founder may ask questions, request a priority update, or say `kill` /
     `tear down` (teardown runs one final safety pass, then closes this run's Oscar/Bob/Deb windows
     through the runner-provided mechanism — never the Oz daemon).

The runner persists this output as the run's pickup brief — do NOT write `pickup.md` yourself.
