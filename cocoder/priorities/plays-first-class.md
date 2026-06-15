---
id: plays-first-class
title: Plays as first-class, persona-bound capabilities (catalog + permission surfacing)
---

> **Founder-approved 2026-06-14** — crafted during the Oz dashboard debugging session (Bug 7). The
> dashboard conflates "sub-agents" with per-(persona, Play) overrides; this priority makes the
> underlying model — Plays are first-class, you bind them to personas — visible and inspectable. The
> session shipped only the cheap "now" slice (relabel + validation); this is the deferred remainder.

## Objective

Make **Plays first-class in Oz** and **persona-bound**: a Play is a standalone procedure (catalog);
attaching it to a persona grants that persona run-permission for it. The dashboard should let the
founder see the catalog, attach a Play to any persona, and **surface permission/config issues** at the
point of binding.

Concretely, **when built:**

1. **A `GET /workspaces/:id/plays` daemon endpoint** returns the **effective** Play catalog (base
   `packages/personas/base/plays/` + repo `cocoder/plays/deltas/`, merged) — each with `id`, `label`,
   `kind` (headless/interactive), and `writeScope`. (Renderer can't read the `.md` files directly; this
   is the ENDPOINTS_OWED seam.)
2. **Personas screen: a read-only Plays catalog** (a section/tab within Personas — NOT a 6th nav item;
   the design-ref's "five top-level nav items only" rule holds) showing each Play + its write-scope.
3. **Binding affordance**: attach a Play from the catalog to a persona (writes `persona.plays[id]`),
   replacing today's free-text play-id box with a catalog picker.
4. **Permission surfacing** at each binding: show the Play's **write-scope** (its commit-gate
   allow-list, ADR-0007/0023) and a ⚠️ when a **headless** Play is pinned to an **interactive-only CLI**
   (the live `integration-verify`/`merge-conflict`→claude misconfig found this session would hang).

**Verified when:** the founder can browse the real Play catalog, attach a Play to a persona through the
UI, and see at a glance what each bound Play may write and whether its CLI can actually run it.

**Boundary / deferred to an ADR (do NOT build without it):** adversarial **multi-bindings of the same
Play** on different models, and any **dynamic per-persona sub-delegation** ("a default skill for any
sub-agent task"). Both need schema + engine changes and fight the current one-level-deep,
no-further-delegation dispatch model (`packages/core/src/plays/dispatch.ts`). Decide in the ADR first.
