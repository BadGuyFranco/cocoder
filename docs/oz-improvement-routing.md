# Routing Guide

**Status:** Founder-approved all-persona guide
**Last verified:** 2026-06-20

This guide is the single runtime routing layer for Oz, Oscar, Deb, and Bob. It answers two questions, in
order:

1. Is this a CoCoder product change or a workspace change?
2. What kind of change is it, and which single owner may write it?

If a change fits no row, spans owners, or reverses an Accepted ADR, surface the decision to the founder.
Do not improvise a new path.

## First Cut: Product Or Workspace

The first discriminator is the target, not where the agent happens to be sitting.

| Target | Write path | Meaning |
|---|---|---|
| Product | `packages/**`, `templates/**`, public `docs/**`, schemas, shipped prompts, `packages/personas/base/**` | CoCoder behavior that ships to every managed repo |
| Workspace | `<ws.path>/cocoder/**` | Governance and extensions for one managed repo only |

The self-host dogfood workspace (`CoCoder/cocoder/`) and a consumer workspace (`[repo]/cocoder/`) are the
same mechanism: both are `<ws.path>/cocoder/**`. The only discriminator is product-vs-workspace. Do not
treat "am I in the CoCoder repo?" as the routing rule.

Use the ADR-0012 portability test as the discriminator: if the rule still teaches the role correctly
after CoCoder-specific nouns are stripped, it belongs in the product/base surface; otherwise it belongs
in the workspace delta for that repo.

Product work is guarded by ADR-0012 portability plus the relevant verified run, ADR, and tests. Workspace
work changes only that workspace's `cocoder/**` governance.

## Targets

| Target | Meaning |
|---|---|
| `cocoder-product` | A product change to CoCoder itself: `packages/**`, `templates/**`, public `docs/**`, schemas, shipped prompts, or `packages/personas/base/**` |
| `workspace-shared` | A tracked change to the active repo's `<ws.path>/cocoder/**` folder |
| `workspace-local` | A private change to the active repo's `<ws.path>/cocoder/local/**` folder |
| `install-local` | A private change to the install's `<CoCoder>/local/**` folder |
| `upstream-candidate` | A workspace finding that may belong in CoCoder product, but needs contributor review before product files change |

## Kind Of Change

| Kind of change | Owner | Write path | Target |
|---|---|---|---|
| Portable persona behavior, shared runtime standards, base Plays, shipped priorities, runner-facing prompt contracts | CoCoder product governance and accepted ADRs | `packages/personas/base/**` | `cocoder-product` |
| Runner, commit gate, persona loader, Play loader, daemon, UI, schemas, templates, public docs | CoCoder product code/docs owner named by the relevant subsystem or ADR | `packages/**`, `templates/**`, public `docs/**` | `cocoder-product` |
| Repo-specific persona extension, local standards, workspace memory, priorities, tickets, ADRs, run records meant to travel with the repo | That workspace's governed `cocoder/**` tree | `<ws.path>/cocoder/**` | `workspace-shared` |
| Machine-private workspace override, local scratch config, secrets, cache, transient helper output for one repo | That workspace's local-only governance area | `<ws.path>/cocoder/local/**` | `workspace-local` |
| Install-wide machine state, run directories, workspace registry, install config, secrets, caches | The CoCoder install's ignored local state | `<CoCoder>/local/**` | `install-local` |
| A workspace-specific observation that appears portable but has not passed ADR-0012 portability and product review | Contributor review queue, ticket, or founder decision | Workspace record first; no product write until accepted | `upstream-candidate` |

## Routing Rules

- Start with product-vs-workspace. A base persona rule is product even when discovered while dogfooding;
  a dogfood governance delta is workspace even though the workspace lives inside the CoCoder repo.
- Keep one owner per concept. If a Play, ADR, prompt, runner surface, status projection, or guide owns a
  contract, consumers must derive from it instead of copying its table, labels, fields, or section order.
- Map ADR-0012, ADR-0023, and ADR-0026 distinctions; do not reverse them through routing prose. ADR-0012
  owns base-vs-delta portability, ADR-0023 owns the commit spine, and ADR-0026 owns onboard/drift tooling
  as tooling under ordinary Oscar priorities.
- Normal workspace customization stays in `workspace-shared` or `workspace-local`. Generalizable product
  findings start as `upstream-candidate` until contributor review routes them to `cocoder-product`.
