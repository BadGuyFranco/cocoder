---
id: ADR-0005
title: "Oz improvement target routing"
status: accepted
date: 2026-05-22
supersedes: none
relates-to: ADR-0001
---

# ADR-0005: Oz Improvement Target Routing

## Context

Oz will surface failed gates, recurring workflow friction, stale docs, weak prompts, and proposed automation improvements. Those improvements can point at different ownership zones:

1. The CoCoder product itself: `packages/`, `templates/`, `docs/`, shipped persona prompts, schemas, Oz daemon/dashboard.
2. A user's workspace-shared `cocoder/`: priorities, ADRs, memory, standards, custom personas, and project-specific scripts.
3. Private local state: `<CoCoder>/local/` or `<workspace>/cocoder/local/`.

If Oz treats all improvements as the same class of work, a normal adopter could accidentally edit the CoCoder install product when they only meant to customize their repo, or a CoCoder contributor could put generally useful product fixes into a single dogfood workspace where they never ship.

## Decision

Oz improvement records must carry an explicit target:

| Target | Applies to | Who can write it |
|---|---|---|
| `cocoder-product` | CoCoder's own source repo: `packages/`, `templates/`, public docs, product ADRs, shipped schemas/prompts | CoCoder contributors only, in developer mode |
| `workspace-shared` | The active repo's tracked `cocoder/` folder | That workspace's maintainers and agents |
| `workspace-local` | The active repo's ignored `cocoder/local/` folder | Local user only |
| `install-local` | The ignored `<CoCoder>/local/` install preference zone | Local user only |
| `upstream-candidate` | A workspace finding that appears generalizable to CoCoder product | Oz may draft an upstream issue/patch, but does not mutate CoCoder product unless the active workspace is the CoCoder repo and developer mode is enabled |

Oz must classify improvements on two axes:

- **Target zone:** where the change would land.
- **Generality:** local-only, workspace-specific, or upstream-candidate.

Default behavior for normal adopters:

- Improvements to custom personas, workspace standards, project scripts, memory, priorities, or local preferences target the adopter's repo or local zones.
- Generalizable product ideas become `upstream-candidate` records, not direct edits to the CoCoder install.
- Oz never edits `packages/`, `templates/`, or shipped public docs for a normal adopter.

Default behavior for CoCoder developers:

- When the active workspace is the CoCoder repo's dogfood workspace (`<CoCoder>/cocoder/`), Oz may route generalizable improvements to `cocoder-product`.
- CoCoder contributors still need the normal Playbook/ADR/test gates before product changes are accepted.

## Consequences

- Sub-Playbook C must include this target field in Oz improvement APIs and audit logs.
- Sub-Playbook D docs must explain the difference between customizing a repo's `cocoder/` and contributing upstream to CoCoder.
- The dogfood collapse in ADR-0001 remains valid, but Oz must not infer "product improvement" solely from the presence of a `cocoder/` folder.

## Alternatives

| Alternative | Rejected because |
|---|---|
| Let Oz infer target from file path only | Dogfood collapse makes path-only inference ambiguous |
| Treat every generalizable issue as a product edit | Unsafe for normal adopters and surprising during local customization |
| Treat every improvement as workspace-local | Product-level defects found through dogfood would never reliably flow back into CoCoder |
