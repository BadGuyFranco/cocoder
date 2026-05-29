# ADR-0012 — Living base personas + repo extensions (persona distribution model)

**Status:** Accepted (founder + Claude, 2026-05-29)
**Seam:** persona distribution & extension
**Amends:** [0008](./0008-repository-topology.md) (personas-as-files; default set in `templates/`) and [0009](./0009-extensibility.md) (extend-by-files) — replaces their **copy-on-init** model with a **living base + additive extension** model.
**Relates to:** [0005](./0005-personas-and-subtasks.md) (personas + per-persona model), the `deb` priority (base-vs-extension triage).

## Context

ADRs 0008/0009 said the default persona set ships in `templates/` and is **copied** into a workspace
on `cocoder init`; the adopter then owns and may override its copy. That is a copy-once seed: after a
repo is initialized, improvements to the base **never reach it**.

That breaks the model the founder wants — and that Deb requires. CoCoder's personas are a **product**:
a base orchestration brain (Oscar, Bob, Deb, Talia, Quinn, …) that improves over time, and whose
improvements must reach **every** install. Deb's whole purpose is to improve that base so all installs
benefit; under copy-on-init her base fixes would die in the one repo they happened in.

## Decision

### Base is a living, referenced layer (not a copied seed)
A **base persona set** ships with the CoCoder install and is the **single source**. It improves
centrally — changes land in the CoCoder product via review (Deb proposes base fixes as PRs) and
propagate to every install on update. The base is **referenced**, never copied-and-frozen.

### Repos extend two ways — merged at load
- **Delta on a base persona:** a repo carries only its *delta* (repo-specific additions/overrides).
  The loader **merges base + delta** at load, so future base improvements still flow through to a repo
  that customized that persona. *(Additive layering — the founder's explicit choice over full-file
  override, which would fork the persona off the base.)*
- **New repo-only persona:** a repo adds a wholly new persona file (e.g. Ian, Phil) with no base
  counterpart.
- **Effective set** for a repo = base + that repo's deltas + that repo's new personas.

### CoCoder is both product and consumer
Even CoCoder's own repo follows the model: base personas live in the install/product; CoCoder's
`cocoder/personas/` carries only CoCoder's own deltas + new personas. Today base and CoCoder's-own are
merged in one folder — splitting them is the rework, tracked as the `base-and-extension-personas`
priority.

### Propagation is review-gated
Base changes ship to all installs, so they land through review (Deb proposes; founder approves) — a
bad base change would otherwise break everyone, so the gate is explicit, not implicit.

## Consequences

- **Deb works as designed:** "CoCoder issue → fix the base" benefits every install; "repo-specific →
  fix the extension" stays local. The base-vs-extension split her triage assumes is now real.
- **The loader gains a merge step** (base + delta) — `core` work, unit-testable with fakes. Where the
  base physically lives (likely the shipped `templates/`-style location, repurposed from copy-seed to
  referenced base) and the delta format are the design homework of the `base-and-extension-personas`
  priority.
- **Amends 0008/0009:** their "copied on `cocoder init`" wording is replaced by this living-base model.
  Extend-by-files (0009) stays — it is just *additive layering against a live base*, not editing a
  frozen copy.
- **One-home preserved:** the base is the single source; a repo restates nothing, carrying only deltas
  (consistent with the project's reference-not-restate rule).
