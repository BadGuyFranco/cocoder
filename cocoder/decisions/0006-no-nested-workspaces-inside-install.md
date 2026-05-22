---
id: ADR-0006
title: "No workspaces nested inside the CoCoder install repository"
status: accepted
date: 2026-05-22
supersedes: none
relates-to: ADR-0001, ADR-0005
---

# ADR-0006: No workspaces nested inside the CoCoder install repository

## Context

CoCoder's workspace detection today walks ancestors from cwd looking for the install markers `cocoder/AGENTS.md` + `ARCHITECTURE.md`. Any directory under the CoCoder clone — including arbitrary nested checkouts that happen to live there — therefore resolves to the CoCoder install root, which silently becomes "the" workspace. Audit §H7 (2026-05-22) flagged this as a foot-gun: a normal adopter who clones their own app into a subfolder of CoCoder would have CLI defaults, run paths, and orchestrator-commit surfaces silently switch from "their app" to "CoCoder dogfood." Combined with the cwd-anchored defaults across `cli.mjs` and `orchestrator-commit.mjs` (audit §B5, §B6), this creates a credible path for accidental product mutation when the user thinks they are working on their own repo.

CoCoder is also its own legitimate dogfood workspace — the `cocoder/` meta-project at the install root *is* a workspace, and Sub-Playbook E exercises it end-to-end. That case must keep working. So the constraint is not "no workspace at all under install" but "no *additional, nested, third-party* workspace under install."

Three options were considered (pending-decisions.md Q4):

- **A — Documented constraint:** workspaces cannot be nested inside the CoCoder install repo. Ancestor walk resolves to the install dogfood and stops. `cocoder init` refuses to operate inside the install tree.
- **B — Support nested workspaces:** detection adds an "inner workspace" pattern (`cocoder/AGENTS.md` *without* sibling `ARCHITECTURE.md`) and a `--workspace=<slug>` override.
- **C — Registry-first:** treat `local/workspaces.json` as the source of truth; cwd ancestor walk is fallback only; disallow registering a workspace whose path is inside install.

## Decision

Adopt **Option A** for v0.1. The CoCoder install repository contains exactly one workspace — the dogfood `cocoder/` meta-project at the install root. Any other workspace must live outside the install tree.

Concretely:

1. **Detection:** `resolveActiveWorkspaceRoot()` (M4.24) walks ancestors from cwd. The first directory containing `cocoder/AGENTS.md` is the workspace root. If that same directory also contains `ARCHITECTURE.md`, the workspace is the CoCoder install's own dogfood — the only legitimate "workspace inside install" instance. No deeper nesting is attempted.
2. **`cocoder init` refusal:** when cwd (or `--workspace-root`) resolves to a path inside the CoCoder install repository and that path is not the install root itself, `cocoder init` fails with a friendly, actionable error.
3. **Friendly error wording (canonical):**
   ```
   cocoder init: refusing to create a workspace inside the CoCoder install repository.

   CoCoder workspaces must live outside the install tree. The install repo
   already contains the dogfood workspace at <install>/cocoder/, and v0.1 does
   not support additional nested workspaces.

   Move the target directory outside <install>, or pass --workspace-root to
   point at an out-of-tree path.

   (Nested workspaces are tracked for v0.2 via the workspaces registry; see
   ADR-0005 + Sub-Playbook C.)
   ```
4. **Documentation:** the constraint is documented in `docs/configuration.md` ("Workspaces and the install repo") and — when authored in Sub-Playbook D — `docs/getting-started.md`. The Q4 founder directive ("be sure this is a well documented requirement") is satisfied only when both docs name the constraint, the friendly error appears in `packages/core/lib/init-merge.mjs` (or equivalent init entry point), and a regression test asserts the refusal path.
5. **Dogfood exception:** the CoCoder install's own `cocoder/` IS a valid workspace; CLI invocations against it pass `--workspace-root=<install>/cocoder` explicitly per the Sub-Playbook E ramp guidance, so cwd ambiguity never decides the routing.

   **Correction 2026-05-22 (Sub-Playbook E execute):** the working shape is `--workspace-root=<install>` AND `--workspace-slug=cocoder-dogfood`, NOT `--workspace-root=<install>/cocoder`. The config resolver expects `<workspaceRoot>/cocoder/<file>`, so passing `<install>/cocoder` would make every workspace-tracked lookup miss (resolver would search for `<install>/cocoder/cocoder/<file>`). The install's own `cocoder/` subdirectory IS the workspace; the workspace-root flag therefore points at the directory whose `cocoder/` child is that workspace — i.e., the install root itself. The Decision in steps 1-4 above remains correct; only this example invocation in step 5 was wrong as originally drafted. The corrected invocation is documented in `docs/configuration.md` "Workspaces and the install repo" and exercised end-to-end across 4 autonomous Sub-Playbook E runs (`run-20260522T133403Z-rwrkcfcg`, `run-20260522T135126Z-t4rnd35z`, `run-20260522T160453Z-nsluixnb`, `run-20260522T161135Z-i3wg7ti9`).

## Consequences

- **For normal adopters:** workspace boundaries are predictable. A user who runs `cocoder init` inside a subfolder of a CoCoder clone gets a friendly error instead of silent install-root binding. There is exactly one ambient workspace per install repo: the dogfood.
- **For contributors:** the dogfood workspace remains the canonical "CoCoder using CoCoder" instance. All Sub-Playbook E orchestration runs pass `--workspace-root="<install>/cocoder"` explicitly.
- **For Sub-Playbook C / future:** when Oz lands (Sub-Playbook C), the workspaces registry becomes available. ADR-0006 can be revisited if the registry-first model (Option C in Q4) becomes worth its complexity. Until then the simple ancestor-walk model is canonical and any registry behavior must keep this constraint.
- **For documentation:** stranger-test docs (Sub-Playbook D Refine) MUST tell the user to `cd` to their project directory before running `cocoder init`. Running from inside the CoCoder install will fail loudly.
- **For tests:** a regression test under `packages/core/tests/` must exercise the refusal path (passing a path inside install to `cocoder init` returns a non-zero exit with the canonical error text). This test ships with M4.24.

## Alternatives considered

- **Option B (support nested workspaces):** rejected for v0.1. The detection logic gets noticeably more complex, and the dominant use case (CoCoder install + user's own repo elsewhere on disk) does not need it. Power users who really want nested workspaces can wait for Option C in v0.2, when the workspaces registry actually exists.
- **Option C (registry-first):** rejected for v0.1 only because the registry CLI (`oz register`) lands in Sub-Playbook C. The schema + JSON artifact exist already (`packages/schemas/src/workspaces-registry.ts`); the missing piece is the runtime that reads/writes it. Once Sub-Playbook C ships, ADR-0006 should be revisited and likely superseded by an Option-C ADR that promotes the registry to canonical truth and treats ancestor-walk as a fallback.

## Provenance

- Question Q4 in `cocoder/priorities/v0.1-foundation/pending-decisions.md`
- Audit findings §B6, §H7 in `plans/2026-05-22-foundation-audit.md`
- Founder directive 2026-05-22: "be sure this is a well documented requirement"
- Implementation gated to Sub-Playbook A Milestone M4.24
