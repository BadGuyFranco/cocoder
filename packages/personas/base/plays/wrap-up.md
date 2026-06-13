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
5. Emit, as your final output, a resumable closeout brief (conclusion-first, founder-readable) with
   these exact sections:
   - `Summary` — plain English summary of what was accomplished.
   - `Priority Ran` — the priority id/title this session ran.
   - `Priority Status` — `continue`, `blocked`, or `archive-candidate`, plus the concrete reason.
   - `Next Action` — one **runnable** next step (a pasteable command, a named priority to launch, or
     an offer to craft the missing test/script — never a bare doc/checklist pointer; F18), including
     who does it and the evidence or decision it should produce.
   - `Next Priority To Run` — the recommended next priority, or this same priority if it should
     continue.
   - `Committed` — acknowledge whether everything this session did is committed; if anything is held
     back, name it plainly.
   - `Archive Estimate` — how close this priority is to archive and the remaining proof/gap.
   - `Founder Options` — state that the founder can ask questions, request a priority update, or say
     `kill` / `tear down`; teardown performs one final safety pass and then closes the run's Oscar,
     Bob, and Deb windows through the runner-provided teardown mechanism.

The runner persists this output as the run's pickup brief — do NOT write `pickup.md` yourself.
