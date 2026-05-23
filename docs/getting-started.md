# Getting started with CoCoder

Minimal path from install to first workspace init. Sub-Playbook D extends this into a full stranger-test doc set.

## 1. Install

Prerequisites: Node.js version from `.nvmrc`, pnpm 10.x.

```bash
git clone <CoCoder-repo-url>
cd CoCoder
pnpm install
pnpm -F cocoder-cli build
```

Verify:

```bash
pnpm exec cocoder validate-contracts
```

## 2. Initialize a workspace

From **your application repository** (not inside the CoCoder install tree):

```bash
cd /path/to/your-app
pnpm exec cocoder init --workspace-root . --cocoder-home /path/to/CoCoder
```

This materializes `cocoder/` from `templates/workspace-cocoder/`. Re-run with `--merge true` after CoCoder updates; user-edited tracked files are preserved.

## 3. Audit stub (optional)

```bash
pnpm exec cocoder audit-workspace --workspace-root .
pnpm exec cocoder refresh-memory --workspace-root .
```

Read `cocoder/memory/onboarding-questions.md` and `cocoder/memory/codebase-map.md`. Full stack detection is v0.2 scope.

## 4. First persona launch (outline)

1. Add a priority to `cocoder/PRIORITIES.md`.
2. Copy or author `profiles/`, `routes/`, and `priority-boundaries/` (see dogfood files in the CoCoder install or `examples/personas/phil-primitive-builder/`).
3. Dry-run composition:

```bash
pnpm exec cocoder compose-launch \
  --profile cocoder/profiles/your.profile.json \
  --route cocoder/routes/your.route.json \
  --priority-slug your-slug
```

4. Inspect the JSON output; fix validation errors before `launch --execute true`.

See `docs/custom-personas.md` for custom persona authoring and `templates/playbooks/new-workspace-setup.md` for a first-week operator playbook.
