# First week with CoCoder on a new repository

Operator onboarding playbook for the first seven days after `cocoder init`. Sub-Playbook D extends public docs; this playbook is for the person running the workspace.

## Day 0 — Install and init

1. Clone or install CoCoder on your machine (see `docs/getting-started.md`).
2. `cd` into your application repository (empty or existing).
3. Run `cocoder init --workspace-root .` from the app repo root.
4. Diff `cocoder/` against `templates/workspace-cocoder/cocoder/` in the CoCoder install; they should match on first init.
5. Confirm `cocoder/local/` is gitignored and only `README.md` + `.gitignore` are tracked inside `local/`.

## Day 1 — Workspace audit stub

1. Run `cocoder audit-workspace --workspace-root .`
2. Read `cocoder/memory/onboarding-questions.md` and fill in open questions as you learn the repo.
3. Run `cocoder refresh-memory --workspace-root .` and skim `cocoder/memory/codebase-map.md`
4. Edit `cocoder/memory/tech-stack.md` with your real stack (the refresh stub does not infer it in v0.1).

## Day 2 — Priorities and decisions

1. Add your first priority row to `cocoder/PRIORITIES.md` (include a `## [slug]` parser-readable block if you use automation).
2. Create `cocoder/priorities/<slug>/README.md` with objective and scope.
3. Author your first workspace ADR if persona boundaries differ from defaults (`cocoder/decisions/`).

## Day 3 — Persona library

1. Read public summaries in `<CoCoder>/cocoder/personas/playbooks/`.
2. Optionally author private depth in `cocoder/local/playbooks/` (see `README-private-operator-pattern.md` in the install).
3. Run `cocoder validate-personas` against the install persona dir to confirm the shipped library validates.

## Day 4 — Custom persona dry run

1. Walk `examples/personas/phil-primitive-builder/` in the CoCoder install.
2. Copy artifacts you need into `cocoder/personas/custom/` and `cocoder/routes/` when ready.
3. Read `docs/custom-personas.md` for checklist and route eligibility rules.

## Day 5 — First compose-launch

1. Author a minimal profile + route for your priority (copy from dogfood or Phil example shapes).
2. Run `cocoder compose-launch --profile ... --route ... --priority-slug ...` (dry run).
3. Fix validation errors before attempting live `launch`.

## Day 6 — First bounded build

1. Launch with `--execute false` first; inspect rendered prompts under the run directory.
2. Run one small atom with Bob or Talia inside a narrow write boundary.
3. Log outcome in `cocoder/SESSION_LOG.md`.

## Day 7 — Hardening

1. Re-run `cocoder init --workspace-root . --merge true` after editing a tracked file; confirm your edit survives.
2. Add workspace-specific standards under `cocoder/standards/` as needed.
3. Schedule Oz registration (Sub-Playbook C) if you use a multi-workspace dashboard.

## Escalation

- Orchestration mechanics failures: use the CoCoder install debugger docs; do not patch install packages from the workspace repo.
- Persona identity drift: compare composed prompts against fixtures; change prompt fragments, not launch code, unless the bug is in core.
