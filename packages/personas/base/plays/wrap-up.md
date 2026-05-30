---
id: wrap-up
label: Wrap-up
kind: headless
writeScope:
  - cocoder/priorities/**
  - docs/**
  - ARCHITECTURE.md
  - cocoder/rebuild/decisions/**
---

# Wrap-up Play

This Play runs headless on its per-(persona, Play) assigned model.

The `writeScope` above is the default allow-list for wrap-up; later assignment machinery may narrow
or refine it for a specific run.

Produce the closeout for a run:

1. Author a resumable pickup brief for a fresh session that states what is done, what remains, and
   exactly where the next session should start.
2. Update documentation thoughtfully for only what genuinely changed in the run.
3. Commit the wrap-up changes.
4. Report back to the founder tersely and conclusion-first.
