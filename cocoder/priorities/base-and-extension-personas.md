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

## Status — implemented (run_17, 2026-05-29)

**Done.** The base + delta + repo-only model is built, wired end-to-end, and proven:
- **Base = a shipped package:** `@cocoder/personas` (`packages/personas/`) is the single source;
  `basePersonasDir()` resolves it module-relative. shared-standards lives here too.
- **Delta format = additive append** (design homework resolved; see ADR-0012 "Implemented"): repo deltas
  at `cocoder/personas/deltas/<id>.md`; repo-only personas as full files. Loader: `mergePersona` →
  `loadEffectivePersona` / `resolveEffectivePersona` / `listEffectivePersonas` (in `core`).
- **All consumers cut over:** daemon launcher, standalone CLI, and the Oz personas route.
- **CoCoder split (corrected):** "repo-agnostic" means agnostic to the *target repo*, not to CoCoder's
  own runtime — so base personas carry CoCoder's full machinery (Oz/cmux/atoms/teardown). Base is rich;
  CoCoder's deltas are thin repo-specifics: Bob's TypeScript/tooling + `packages/**` scope, Deb's
  current-slice note. Oscar is all product runtime → no delta. (ADR-0012/0014.)
- **Propagation proven:** `packages/core/tests/personas-propagation.test.ts` shows a base improvement
  reaching an already-extended repo while the delta survives.

Follow-ups (non-blocking): decide whether repo-only personas live at `cocoder/personas/` top-level or
in `custom/`; restart the Oz daemon (`scripts/oz.sh restart`) so the running loop picks up the new
loader; consider archiving this priority once confirmed.
