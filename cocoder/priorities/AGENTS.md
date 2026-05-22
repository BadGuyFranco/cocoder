# `cocoder/priorities/` — Priority registry

One folder per active or archived priority. The flat slim index lives at [`../PRIORITIES.md`](../PRIORITIES.md); structure and routing live here.

## Pattern

Every priority follows this shape:

```
[slug]/
├── README.md                # ← THE master WISER Playbook for this priority
├── notes/                   # optional working scratch
└── plans/                   # sub-Playbooks (only if priority is complex enough to split)
    ├── 2026-MM-DD-[plan].plan.md
    └── zArchive/            # completed sub-plans
```

### Simple priorities

A simple priority (no sub-Playbooks needed) has only `README.md` and optionally `notes/`. The README contains the full WISER Playbook with all tasks inline.

### Complex priorities

A complex priority (multi-week, multi-risk, decomposable) splits into a Master Playbook (`README.md`) plus sub-Playbooks in `plans/`. The Master owns cross-cutting concerns; each sub-Playbook owns one independent risk area.

Example: [`v0.1-foundation/`](./v0.1-foundation/) — master + four sub-Playbooks for the v0.1 ship.

## Naming and lifecycle

- **Slug** is the folder name. Use kebab-case, descriptive, ≤30 chars. Examples: `v0.1-foundation`, `oz-freshness-panel`, `migrate-cobuilder-to-cocoder`.
- **Status transitions:** Draft → Active → (Paused | Complete | Cancelled).
- **On completion:** move the folder to `zArchive/` and drop the row from `../PRIORITIES.md`. Add an entry to `zArchive/INDEX.md` (created on first archive).
- **One Active priority at a time** by default. Multiple Active is allowed but should be justified in `../PRIORITIES.md`.

## Routing into a priority

1. Start at [`../PRIORITIES.md`](../PRIORITIES.md) — find the slug
2. Open `[slug]/README.md` — this IS the master Playbook (follow its Resume Instructions)
3. If the priority has sub-Playbooks, the README's Progress table identifies which sub-Playbook is currently Active
4. Open the Active sub-Playbook in `[slug]/plans/` and follow its Resume Instructions

## Conventions

- **No status drift:** the priority README header is canonical for status/canon/owner; `../PRIORITIES.md` is a mirror. Update both in the same change set.
- **Notes are optional:** use `notes/` for working scratch (per-session WIP, brainstorms). Move durable conclusions into the Playbook proper (Witness audit, Decision Log, Learnings).
- **Cross-references:** sub-Playbooks reference `../README.md` as Parent; the README references each sub-Playbook by relative path.

## Active priorities

See [`../PRIORITIES.md`](../PRIORITIES.md) for the live index.

## Archive

See [`./zArchive/`](./zArchive/) for completed priorities.
