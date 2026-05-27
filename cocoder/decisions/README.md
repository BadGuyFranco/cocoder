# Architecture Decision Records (ADRs)

Numbered, dated, single-purpose decisions. Each ADR captures **context → decision → consequences → alternatives**. ADRs are append-only; superseding decisions reference the prior ADR by number and update its status to `superseded`.

## Conventions

- Filename: `NNNN-kebab-case-slug.md`
- Front matter: `id`, `title`, `status` (`proposed | accepted | superseded`), `date`, optional `supersedes`, `relates-to`
- ADRs live next to code, not in a wiki — context windows must reach them in one read
- Linked from `ARCHITECTURE.md` and the relevant Playbooks

## Index

| ID | Title | Status | Date |
|---|---|---|---|
| [ADR-0001](./0001-storage-and-license.md) | Storage zones, license, and CoBuilder relationship | accepted | 2026-05-21 |
| [ADR-0002](./0002-talia-quinn-boundary.md) | Talia and Quinn — automated test layer vs automated user-simulation layer | accepted (revised 2026-05-26) | 2026-05-21 |
| [ADR-0003](./0003-binary-name-and-env-prefix.md) | CLI binary name and environment variable prefix | accepted | 2026-05-21 |
| [ADR-0004](./0004-typescript-validation-toolchain.md) | TypeScript, validation toolchain, and monorepo policy | accepted | 2026-05-21 |
| [ADR-0005](./0005-oz-improvement-target-routing.md) | Oz improvement target routing | accepted | 2026-05-22 |
| [ADR-0006](./0006-no-nested-workspaces-inside-install.md) | No workspaces nested inside the CoCoder install repository | accepted | 2026-05-22 |
| [ADR-0007](./0007-workspace-files-and-multiroot-description.md) | Workspace files — storage location and the multi-root description convention | accepted (revised 2026-05-27) | 2026-05-26 |
| [ADR-0008](./0008-oz-control-plane-architecture.md) | Oz control-plane architecture | accepted | 2026-05-27 |
| [ADR-0009](./0009-orchestration-services.md) | Non-persona orchestration services (cheap-model admin delegation) | accepted | 2026-05-27 |

## Pending / proposed

(None — next ADR number is 0010.)

## Authoring guide

A new ADR is justified when **any of**:

- A decision affects ≥2 packages or ≥2 personas
- The decision will be re-litigated in a future review if not written down
- An alternative was seriously considered and rejected
- A risk in a Playbook is mitigated by the decision

A new ADR is **not** justified for:

- Implementation details of a single function
- Style preferences covered by linters/formatters
- Reversals that fit in a single commit message
