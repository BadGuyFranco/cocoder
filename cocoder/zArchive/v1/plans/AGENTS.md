# `cocoder/plans/` — Cross-priority workspace plans

Playbooks that genuinely span priorities — i.e., they don't belong inside any single priority's `plans/` folder. **This directory is mostly empty.** The dominant pattern is to nest Playbooks under their priority.

## When to put a Playbook here vs. inside a priority

| Situation | Location |
|---|---|
| Playbook executes one priority's work | `priorities/[slug]/plans/[plan].plan.md` |
| Playbook coordinates two or more independent priorities | `cocoder/plans/[plan].plan.md` (here) |
| Playbook is a recurring template (not tied to any priority) | `cocoder/plans/[plan].plan.md` (here) with `Type: Template` |
| Playbook touches workspace conventions, structure, or governance | `cocoder/plans/[plan].plan.md` (here) |

If you're unsure, default to **inside a priority**. Moving a plan up here later is cheap; moving it down later is also cheap.

## Naming

Same convention as priority-nested plans: `YYYY-MM-DD-slug.plan.md`.

## Archive

Completed plans move to [`./zArchive/`](./zArchive/).

## Active

- [`v0.2-backlog.md`](./v0.2-backlog.md) — capture-only holding pen for items deferred out of v0.1 (not a Playbook; reference file)

## SSOT rule (per `../AGENTS.md`)

Each Playbook file is canonical for its own state. There is no index file at this level — readers list `plans/` directly.
