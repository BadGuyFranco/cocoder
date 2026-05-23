# Custom personas

CoCoder ships core personas (Bob, Talia, Oscar, and stubs for Quinn, Ian, Verifier) in the install repo. **Custom personas** extend the library for workspace-specific roles without forking orchestration core.

## Contract schema

Persona contracts validate against `persona-contract` (`packages/core/contracts/persona.schema.json`).

Required fields:

| Field | Purpose |
|---|---|
| `id` | Stable slug referenced by routes and profiles |
| `label` | Human-readable name |
| `mode` | `orchestrator`, `writer`, `bounded-writer`, `verifier`, or `script-qa` |
| `role` | One-paragraph responsibility statement |
| `launchModel` | Session shape (`long-lived-visible`, `one-shot`, etc.) |
| `writePolicy` | `read-only`, `task-scoped`, or `bounded-writer` |
| `allowedRoutes` | Route ids this persona may join |
| `resultContract` | Normally `job-result` |
| `evidenceResponsibilities` | Non-empty list of evidence duties |
| `reviewStatus` | `draft` until founder or persona-owner review |

Validate a file:

```bash
pnpm exec cocoder validate-file --contract persona-contract --file path/to/persona.json
```

## Directory convention

| Location | Use |
|---|---|
| `<CoCoder>/cocoder/personas/*.json` | Core library (install repo) |
| `<workspace>/cocoder/personas/custom/*.json` | Workspace custom personas (tracked) |
| `<workspace>/cocoder/personas/custom/prompts/` | Workspace prompt fragments + manifest |
| `<workspace>/cocoder/local/playbooks/` | Private operator depth (gitignored) |

## Prompt manifest

Register persona ↔ fragment pairs in `prompts/manifest.json` (version `1`). Shared fragments live under `prompts/shared/`; persona-specific fragments under `prompts/personas/`.

Run `pnpm exec cocoder validate-personas` after adding contracts. Run `compose-launch` to verify fragments resolve.

## Checklist directory convention

Custom personas that author artifacts should ship operator checklists beside the contract:

```
cocoder/personas/custom/<persona-id>/
  persona.json
  checklists/
    primary-workflow.md
  prompts/
    manifest.json
    personas/<persona-id>.md
```

The Phil example uses `examples/personas/phil-primitive-builder/checklists/new-extension.md` as the reference shape.

## Route eligibility

A persona may join a route only when:

1. `allowedRoutes` includes the route id (or the list is intentionally empty for dormant personas).
2. The route `lead` / `teammates` / `lanes` reference the persona id.
3. The selected profile defines every lane the route requires (including stub lanes for unused slots).
4. A priority boundary exists when the lane `canWrite` is true.

Check compatibility:

```bash
pnpm exec cocoder check-route-profile --profile PATH --route PATH
pnpm exec cocoder check-persona-route-coverage
```

## Oz registration hook (Sub-Playbook C)

Oz dashboards enumerate workspaces from the install-level registry (`<CoCoder>/local/workspaces/`). When Sub-Playbook C lands:

- Register the workspace slug after `cocoder init`
- Surface custom persona ids in the Oz persona roster view
- Link to `cocoder/personas/custom/` manifests for prompt inspection

v0.1 documents the hook only; Oz HTTP integration is not shipped yet.

## Worked example

See [`examples/personas/phil-primitive-builder/`](../examples/personas/phil-primitive-builder/README.md) for the Workshop Toolsmith route (Oscar + Phil, bounded extension writer).

## Review gate

Custom personas remain `reviewStatus: draft` until a founder or persona-owner reviews the contract, prompt fragments, and write boundary together. Do not mark `canonical` without that review.
