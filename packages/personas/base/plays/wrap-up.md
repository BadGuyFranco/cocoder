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

Produce the closeout for a run:

1. Update documentation thoughtfully for only what genuinely changed in the run, staying within this
   Play's write-scope.
2. Do NOT run git or commit anything. The CoCoder runner commits your in-scope edits for you, within
   this Play's write-scope. Just make the file edits and stop.
3. Leave the priority with exactly one lifecycle disposition: `continue`, `blocked`, or
   `archive-candidate`. If it is not archive-ready, name the concrete gaps preventing archive across
   product behavior, architecture, tests, documentation, founder decisions, and missing evidence. If it
   appears archive-ready, ask for founder archive confirmation; never self-archive.
4. Emit, as your final output, a resumable closeout brief (conclusion-first, founder-readable): what
   is done, the priority disposition, archive readiness, what remains, and exactly where the next
   session should start. The runner persists this output as the run's pickup brief — do NOT write
   pickup.md yourself.
