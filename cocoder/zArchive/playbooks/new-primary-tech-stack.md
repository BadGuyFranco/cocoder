# New-Primary Tech-Stack Starter Registry

**Status: Proposed -- pending founder ratification.**

This note extends the frozen [New Primary playbook](./new-primary.md) design that was introduced by
[ADR-0020](../../decisions/0020-primary-root-audit.md). It is a design/spec note only: no registry code,
starter templates, or runtime implementation exists yet.

## Decision Shape

New Primary continues to scaffold only the `cocoder/` governance zone by default. An application starter
is an opt-in step after the founder intake: the founder can select a project type, confirm the matching
starter, or decline application scaffolding entirely.

The starter mechanism is install machinery, not workspace-specific governance. A starter is data plus
template files. Adding a stack should not require changing the New-Primary runner, the Playbook, or any
persona prompt.

## Starter Registry

Starter templates live under:

```text
packages/personas/base/templates/starters/<starter-id>/
```

Each starter directory contains:

```text
starter.manifest.json
template/
README.md
```

`starter.manifest.json` is the registry contract. The runner discovers starters by reading manifests,
validating them, and selecting by `projectType`.

```json
{
  "id": "static-publishing-cloudflare",
  "projectType": "static-publishing",
  "label": "Static content / publishing site",
  "stack": {
    "framework": "Astro",
    "language": "TypeScript",
    "packageManager": "pnpm",
    "database": "none",
    "hosting": "Cloudflare Workers static assets"
  },
  "nonNegotiables": {
    "testing": ["unit", "build", "content/schema validation"],
    "auth": "none in v1 unless the starter declares an admin surface",
    "lintFormat": "strict TypeScript plus starter-declared lint/format commands",
    "ci": "GitHub Actions",
    "boundaries": ["Zod at every external boundary", "AGENTS.md per directory"]
  },
  "writes": [
    "package.json",
    "pnpm-workspace.yaml",
    "apps/<site-slug>/**",
    "packages/**",
    ".github/workflows/**"
  ],
  "postScaffoldNotes": [
    "Set required hosting secrets before the first deploy.",
    "Ratify the generated app Objective before ordinary product work begins."
  ]
}
```

Required manifest fields:

| Field | Meaning |
|---|---|
| `id` | Stable starter identifier. Unique across built-in and user-provided starters. |
| `projectType` | Selection key used by New Primary. Multiple starters may share a type only if the runner can present a clear choice. |
| `label` | Human-readable name for the confirmation step. |
| `stack` | Framework, language, package manager, database, hosting, and other stack metadata the starter owns. |
| `nonNegotiables` | The hard defaults the starter enforces: testing, auth posture, lint/format, CI, security boundaries, and required conventions. |
| `writes` | The file tree the starter may lay down. This is the source of truth for the temporary write-scope expansion after founder confirmation. |
| `postScaffoldNotes` | Operational notes emitted after copy, such as required secrets, first verification commands, or follow-up governance to ratify. |

The registry loader must reject a starter whose manifest omits these fields, whose `writes` set is
ambiguous, or whose template contains files outside `writes`.

## Selection Flow

New Primary selects by project type, not by a universal default stack:

1. P0 scaffolds `cocoder/` exactly as it does today.
2. P1 intake asks what kind of project this root is intended to become.
3. The runner maps the answer to a `projectType` key.
4. If exactly one starter matches, the runner offers it with its label, stack summary,
   non-negotiables, and write tree.
5. If multiple starters match, the runner offers the best recommended match and names the alternative
   only when founder judgment is genuinely needed.
6. If no starter matches, New Primary proceeds with governance only.
7. The founder confirms or declines. Decline is a complete valid path.
8. On confirmation only, the runner copies the starter `template/` into the fresh primary root,
   create-only by default, then emits `postScaffoldNotes`.

This does not import the Onboard (existing repo) audit machinery. A fresh root has nothing to deep-read. The
selection beat is an intake-and-confirmation step, followed by deterministic template copy.

## Bring-Your-Own Starter

The same manifest contract is the bring-your-own seam. A user can point New Primary at a local starter
directory or a checked-out repository subdirectory that contains `starter.manifest.json` and `template/`.

BYO validation rules:

- The manifest uses the same required fields as built-in starters.
- The runner shows the same confirmation summary before any files are written.
- The `writes` list is treated as the requested write-scope expansion.
- The runner copies create-only unless the founder explicitly confirms overwrite behavior.
- BYO starters are not promoted into the built-in registry unless a separate install change adds them.

## Wiring Into New Primary

The additive playbook change is a new beat after intake, without renumbering the existing phases:

| Phase | Det/Agentic | Founder gate | Output |
|---|---|---|---|
| **P1a - Optional stack starter** | deterministic discovery + agentic confirmation -- infer `projectType` from P1, offer the matching starter or BYO manifest, do not deep-audit | founder confirms or declines | declined: no app files; confirmed: selected starter template is laid down and its post-scaffold notes are captured |

P2 then seeds governance from the actual result: governance-only when the starter was declined, or
starter-aware `memory/` and draft Objectives when a starter was laid down.

## Founder-Provided Default Starter Set

These are founder-provided defaults from run 109. They are a starting set, not the only allowed
starters. The worked example for the static-publishing starter is
`/Volumes/NAS LOCAL/CoPublisher/Playbook.md`, which shows the expected depth of stack decisions,
non-negotiables, repository layout, and verification gates. The design should reference that playbook
as a quality bar, not copy it wholesale.

| Project type | Hosting target | Built-in starter intent |
|---|---|---|
| Static content / publishing site | Cloudflare Workers | A CoPublisher v1-style publishing monorepo. |
| Non-static / dynamic web app | Vercel | A dynamic web application starter for request-time app behavior. |
| More complex backend services | Google Cloud | A service starter based on the CoBuilder service pattern. |

### Static Content / Publishing Site

Recommended starter key: `static-publishing`.

Detailed example stack: Node 22.12+, strict TypeScript everywhere, pnpm workspaces, Turborepo, Astro
6.x (6.4+), Content Layer API, MDX, Tailwind CSS with design tokens as CSS custom properties,
Cloudflare Workers static-assets hosting deployed by `wrangler` from GitHub Actions, Pages CMS
(stateless and GitHub-API-backed; not TinaCMS), GitHub as content store (no isomorphic-git in v1),
Pagefind search, GitHub Actions CI/CD with `turbo --affected`, `wrangler-action`, and concurrency
groups, Resend newsletter, Cloudflare Web Analytics, Zod at every external boundary, AGENTS.md per
directory, and an OKF knowledge bundle.

### Non-Static / Dynamic Web App

Recommended starter key: `dynamic-web-app`.

Founder-provided hosting target: Vercel. The starter should cover projects that need runtime routes,
user sessions, server actions/API routes, preview deployments, and app-style UI behavior. The exact
framework, auth, database, and CI non-negotiables remain founder-ratification questions below.

### More Complex Backend Services

Recommended starter key: `backend-service`.

Founder-provided hosting target: Google Cloud. Detailed example: the CoBuilder service pattern from
the CoPublisher playbook's future Phase 8, explicitly not part of the CoPublisher v1 static starter:
Fastify + tRPC + Zod on Cloud Run, Neon Postgres + Drizzle, pg-boss, BetterAuth, Stripe, Resend,
GitHub Actions, and Workload Identity Federation.

## Portability Reasoning

The registry, manifest, selection flow, and BYO seam are generic install machinery. Strip out the
founder-provided starter names and the mechanism still teaches any New-Primary run how to discover,
validate, select, and lay down an optional application starter.

The three starters above are clearly labeled as shipped defaults. They are not special cases in the
runner, and they are not the only possible project types. A different install can add starters by
adding manifests and templates under the registry path, while a single workspace can bring its own
starter through the same manifest contract.

## Founder Gate: Open Questions And Recommendation

Recommendation: ratify the registry mechanism now, ship the three founder-provided starters as the
initial default set, and keep starter selection opt-in. The one judgment call to veto is whether
`static-publishing` should be the "if unsure" suggestion for founders starting with content-first
businesses.

Open questions to ratify:

| Question | Draft recommendation |
|---|---|
| Exact non-negotiables for `static-publishing` | Use the CoPublisher v1 set: Node 22.12+, strict TypeScript, pnpm, Turborepo, Astro 6.4+, Tailwind tokens, Zod boundaries, Pagefind, Pages CMS, GitHub content store, GitHub Actions, Cloudflare Workers via `wrangler`, Resend, Cloudflare Web Analytics, AGENTS.md per directory, OKF bundle, and content/schema validation in CI. |
| Exact non-negotiables for `dynamic-web-app` | Use strict TypeScript, pnpm, a Vercel-native full-stack framework, Vitest for unit tests, Playwright for browser workflows, Zod boundaries, BetterAuth if auth is needed, hosted Postgres plus Drizzle when persistence is needed, GitHub Actions plus Vercel preview/deploy checks, and AGENTS.md per directory. |
| Exact non-negotiables for `backend-service` | Use the CoBuilder service pattern: Fastify, tRPC, Zod, Cloud Run, Neon Postgres, Drizzle, pg-boss, BetterAuth, Stripe, Resend, GitHub Actions, Workload Identity Federation, strict TypeScript, pnpm, unit/integration tests, and AGENTS.md per directory. |
| Whether one starter is the "if unsure" fallback | Recommend no universal fallback. If the founder says the project is content-first, recommend `static-publishing`; otherwise proceed governance-only until the project type is clear. |
| Final starter IDs and projectType keys | Recommend `static-publishing-cloudflare` / `static-publishing`, `dynamic-web-app-vercel` / `dynamic-web-app`, and `backend-service-gcp` / `backend-service`. |
