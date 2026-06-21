# Custom personas

**Last verified:** 2026-06-20

CoCoder ships its base personas (Oz, Oscar, Bob, Deb, Quinn) in the install at
`packages/personas/base/` ([ADR-0012](../cocoder/decisions/0012-living-base-personas.md)). A workspace
extends that base for its own roles — without forking the orchestration core. This is a concise adopter
guide; the contract lives in
[ARCHITECTURE.md "Persona Boundaries"](../ARCHITECTURE.md#persona-boundaries-cocoder) and ADR-0012.

Testing is a Play capability (`write-tests` / `run-tests`) that any persona can invoke; see
[ADR-0033](../cocoder/decisions/0033-testing-as-a-play-capability.md).

## The model: base + delta + custom, merged at load

A persona is a **flat markdown file** with YAML frontmatter (`id`, `label`, `role`, `writeScope`) and a
body of rules (`packages/core/src/personas/types.ts`). It is **not** a JSON contract — the v1 `.json`
persona / route / profile / lane model is gone.

A workspace layers extensions under its tracked `cocoder/personas/` directory two ways
([ADR-0012](../cocoder/decisions/0012-living-base-personas.md)):

- **Delta on a base persona** — `cocoder/personas/deltas/<id>.md` carries only this repo's additions
  (extra `writeScope` globs, an appended body). The `core` loader merges base + delta at load, so future
  base improvements still flow through. (See the dogfood's own `cocoder/personas/deltas/bob.md`.)
- **New repo-only persona** — `cocoder/personas/custom/<id>.md`, a wholly new persona with no base
  counterpart (e.g. Ian, Phil).

The **effective set** for a repo = base + that repo's deltas + that repo's custom personas.

## Directory layout

| Location | Use |
|---|---|
| `packages/personas/base/<id>.md` | Base persona set (install/product; single source) |
| `<workspace>/cocoder/personas/deltas/<id>.md` | Delta on a base persona (tracked) |
| `<workspace>/cocoder/personas/custom/<id>.md` | New repo-only persona (tracked) |
| `<workspace>/cocoder/personas/assignments.json` | CLI + model per persona, and which personas are live |

There is no machine-local persona zone — machine state lives only in the install's `local/`
(see [ARCHITECTURE.md storage zones](../ARCHITECTURE.md)). The dogfood's
[`cocoder/personas/AGENTS.md`](../cocoder/personas/AGENTS.md) is the live worked example of this layout.

## assignments.json — who is live, on what CLI/model

`assignments.json` is the **sole source** of which personas are live and what CLI/model each runs
(`packages/core/src/personas/types.ts`, `Assignments`). Per-persona fields: `cli` (adapter id, e.g.
`claude`, `codex`, `cursor-agent`), `model` (empty string = the CLI's default), optional `mode`
(`visible` | `headless`), optional `enabled`, and optional per-(persona, Play) `plays` overrides. Model
choice is kept out of the persona definition so it never duplicates (D4). Edited by hand or by Oz —
never the DB.

```json
{
  "personas": {
    "phil": { "cli": "codex", "model": "" }
  }
}
```

## Write scope

`writeScope` in the persona frontmatter is the allow-list of globs the commit-gate enforces (S7). An
empty `writeScope` means read-only (default-deny). A delta's `writeScope` is **appended** to the base
scope with stable de-duplication (`PersonaDelta` in `packages/core/src/personas/types.ts`).

## Authoring a custom persona

1. Create `<workspace>/cocoder/personas/custom/<id>.md` with frontmatter `id` (must match the filename),
   `label`, `role`, and `writeScope`, followed by the body of rules.
2. Add the persona to `<workspace>/cocoder/personas/assignments.json` with its `cli` and `model`.
3. Keep `reviewStatus: draft` (see Review gate below) until founder/owner approval.

`shared-standards.md` (the cross-persona globals) is prepended to every persona's launch prompt — do not
restate the shared standards inside a custom persona.

## Review gate

A custom persona stays `reviewStatus: draft` until a founder or persona-owner reviews the definition and
its write boundary together. Do not promote it to canonical without that review.

## Worked example

The Phil "primitive builder" example under `examples/personas/phil-primitive-builder/` predates the v2
rebuild and is still written against the v1 `persona.json` / route / profile model. Treat it as
historical until it is ported; the live v2 reference is the dogfood's
[`cocoder/personas/`](../cocoder/personas/AGENTS.md) (deltas + assignments.json) and the base set in
`packages/personas/base/`.
