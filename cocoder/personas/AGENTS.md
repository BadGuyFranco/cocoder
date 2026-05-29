# `cocoder/personas/` — Personas (v2)

A persona is a flat markdown file (`oscar.md`, `bob.md`, `deb.md`, …) — role, mental model, rules —
plus `shared-standards.md` (the cross-persona globals) and `assignments.json` (CLI + model per persona).
Governed by [ADR-0008](../rebuild/decisions/0008-repository-topology.md) (personas-as-files),
[ADR-0005](../rebuild/decisions/0005-personas-and-subtasks.md) (persona/Play tiers + model assignment),
and [ADR-0012](../rebuild/decisions/0012-living-base-personas.md) (base + extension model).

## Base vs extension (ADR-0012)

- **Base personas** — the product's orchestration set (Oscar, Bob, Deb, Talia, Quinn, …) ship with the
  CoCoder **install**, are the single source, and improve for *every* install (Deb proposes base fixes
  as reviewed PRs; they propagate on update). Referenced, never copied-and-frozen.
- **Repo extensions** — a repo layers a **delta** onto a base persona (carrying only its delta, merged
  at load, so base improvements still reach it) or adds **new repo-only personas** (e.g. Ian, Phil).
- **Today this isn't split yet:** base + CoCoder's-own deltas are merged in this one folder. Splitting
  them (base in the install, this folder = CoCoder's deltas) is tracked as the
  [`base-and-extension-personas`](../priorities/base-and-extension-personas.md) priority. The
  install-side base templates are currently empty — known, not-yet-done.

## How personas compose at launch

- `shared-standards.md` is **prepended to every persona's launch prompt** (one home; not duplicated per
  persona). Note #8 (plain-English founder comms) is **human-facing only** — peer/machine comms stay
  technical.
- `assignments.json` is the sole source of which personas are live + their CLI/model (per-persona, and
  per-(persona, Play) once the Plays mechanism lands). Edited by hand / by Oz, never the DB.

## v1 leftovers (frozen reference)

`_archived-v1/`, `custom/`, `playbooks/`, `prompts/`, and `PORT-NOTES.md` are pre-rebuild v1 artifacts
(the old `.json`-persona / playbook-summary model). Not read by v2; kept as reference pending cleanup.
