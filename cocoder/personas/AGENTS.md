# Personas — Workspace-Custom

Workspace-specific persona overrides and additions. Distinct from the OSS persona contracts shipped in the CoCoder install (`<CoCoder>/cocoder/personas/*.json`) and the public playbook summaries in [`playbooks/`](./playbooks/).

## Structure

| Folder | Purpose |
|---|---|
| `custom/` | Custom personas defined for this workspace only (e.g., a domain-specific extension via the Phil pattern) |
| `playbooks/` (install repo) | Public persona summaries shipped with CoCoder |
| `local/playbooks/` (workspace private) | Operator-authored private depth; see [`playbooks/README-private-operator-pattern.md`](./playbooks/README-private-operator-pattern.md) |

## CoCoder's own dogfood

For CoCoder itself, `custom/` remains empty in v0.1. Core personas (Oscar, Bob, Talia, Phil contract + Quinn/Ian/Verifier stubs) ship in the install repo. The directory exists as documentation of the pattern.

## Routing

- **Public playbook summaries?** → `playbooks/{bob,talia,oscar,phil}.md`
- **Private operator playbooks?** → `<workspace>/cocoder/local/playbooks/` (gitignored)
- **Custom persona example?** → `<CoCoder>/examples/personas/phil-primitive-builder/`
- **Authoring guide?** → `<CoCoder>/docs/custom-personas.md`
