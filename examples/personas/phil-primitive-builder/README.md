# Phil extension builder example — Workshop Toolsmith

This example demonstrates the **custom persona contract end-to-end** in a CoCoder-neutral domain. "Workshop" is a fictional documentation workshop product. Phil builds reusable extension artifacts (checklists, templates, metadata) inside an explicit write boundary while Oscar orchestrates.

Copy this folder into your workspace and adapt the boundary paths, priority slug, and extension taxonomy for your product.

## Contents

| Path | Purpose |
|---|---|
| `persona.json` | Custom persona contract (maps to `phil-workshop-toolsmith`) |
| `prompts/manifest.json` | Prompt fragment list for compose-launch |
| `prompts/personas/phil-workshop-toolsmith.md` | Runtime prompt fragment |
| `routes/phil-workshop-toolsmith.json` | Minimal Oscar + Phil route |
| `profiles/phil-workshop-toolsmith.profile.json` | Lane snapshot for the route |
| `priority-boundaries/workshop-extensions.boundary.json` | Phil writer boundary |
| `checklists/new-extension.md` | Operator checklist Phil follows |

## Quick validation

From a CoCoder install root with this repo checked out:

```bash
pnpm exec cocoder validate-file --contract persona-contract --file examples/personas/phil-primitive-builder/persona.json
pnpm exec cocoder validate-routes --routes-dir examples/personas/phil-primitive-builder/routes
pnpm exec cocoder validate-profiles --profiles-dir examples/personas/phil-primitive-builder/profiles
pnpm exec cocoder check-route-profile \
  --profile examples/personas/phil-primitive-builder/profiles/phil-workshop-toolsmith.profile.json \
  --route examples/personas/phil-primitive-builder/routes/phil-workshop-toolsmith.json
```

Full `compose-launch` / `launch` against a real workspace priority is left to the operator after copying artifacts into `<workspace>/cocoder/`.

## Adoption steps

1. Copy `persona.json` to `<workspace>/cocoder/personas/custom/phil-workshop-toolsmith.json` (or merge fields into your own custom persona).
2. Copy `prompts/` fragments into `<workspace>/cocoder/personas/custom/prompts/` and extend the workspace manifest.
3. Copy `routes/`, `profiles/`, and `priority-boundaries/` into the matching `cocoder/` directories.
4. Add a priority entry in `<workspace>/cocoder/PRIORITIES.md` that names the route and boundary.
5. Run `cocoder compose-launch` with your workspace profile/route paths before the first live launch.

See `docs/custom-personas.md` for the general custom-persona checklist and Oz registration hook (Oz lands in Sub-Playbook C).
