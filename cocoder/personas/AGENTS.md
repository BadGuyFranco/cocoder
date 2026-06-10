# `cocoder/personas/` — Personas (v2)

A persona is a flat markdown file (`oscar.md`, `bob.md`, `deb.md`, …) — role, mental model, rules —
plus `shared-standards.md` (the cross-persona globals) and `assignments.json` (CLI + model per persona).
Governed by [ADR-0008](../decisions/0008-repository-topology.md) (personas-as-files),
[ADR-0005](../decisions/0005-personas-and-subtasks.md) (persona/Play tiers + model assignment),
and [ADR-0012](../decisions/0012-living-base-personas.md) (base + extension model).

## Base vs extension (ADR-0012)

- **Base personas** — the product's orchestration set (Oscar, Bob, Deb, Talia, Quinn, …) ship with the
  CoCoder **install**, are the single source, and improve for *every* install (Deb proposes base fixes
  as reviewed PRs; they propagate on update). Referenced, never copied-and-frozen.
- **Repo extensions** — a repo layers a **delta** onto a base persona (carrying only its delta, merged
  at load, so base improvements still reach it) or adds **new repo-only personas** (e.g. Ian, Phil).
- **The split is done (run_17, ADR-0012):** the base set ships as `@cocoder/personas`
  (`packages/personas/`) as the single source; this folder holds CoCoder's own deltas
  (`deltas/<id>.md`) + repo-only personas. The `core` loader merges base + delta at load, and a base
  improvement provably reaches an already-extended repo. (Priority archived to
  `priorities/zArchive/v2/base-and-extension-personas.md`.)

## How personas compose at launch

- `shared-standards.md` is **prepended to every persona's launch prompt** (one home; not duplicated per
  persona). Note #8 (plain-English founder comms) is **human-facing only** — peer/machine comms stay
  technical.
- `assignments.json` is the sole source of which personas are live + their CLI/model (per-persona, and
  per-(persona, Play) once the Plays mechanism lands). Edited by hand / by Oz, never the DB.

## v1 leftovers (frozen reference)

`_archived-v1/`, `custom/`, `playbooks/`, `prompts/`, and `PORT-NOTES.md` are pre-rebuild v1 artifacts
(the old `.json`-persona / playbook-summary model). Not read by v2; kept as reference pending cleanup.
