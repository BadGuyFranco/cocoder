---
id: base-and-extension-personas
title: Living base personas + repo extensions
---

## Objective
CoCoder's personas split into a shared **base** set that ships with the install (Oscar, Bob, Deb,
Talia, Quinn, …) and improves for everyone, plus per-repo **extensions** merged on top at load time. A
repo can either layer a **delta** onto a base persona (it carries only its delta, so future base
improvements still reach it) or add brand-new **repo-only personas** (e.g. Ian, Phil). **Done when:**
the base set lives in the install as the single source; a repo can do both kinds of extension; the
persona loader correctly merges base + delta at load; and an improvement made to a base persona
visibly shows up in a repo that has already extended that persona. Boundary: the persona storage
layout + the loader merge + splitting CoCoder's own personas into base-vs-CoCoder-extensions — **not**
a change to what any persona does.

Decided in ADR-0012 (replaces the old "copy the base in once at setup" model). This is what makes Deb
work: her "fix the CoCoder base" path benefits every install; her "fix the repo" path stays local.
Design homework for the run: where the base physically lives (likely the shipped install location,
repurposed from a one-time seed to a referenced base) and the delta format.
