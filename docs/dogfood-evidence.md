# Dogfood Evidence

**Status:** Draft, implemented by Sub-Playbook D Solve  
**Last verified:** 2026-05-28 (summarized from tracked session log, architecture notes, docs, and tests; no new polish session run)

CoCoder v0.1 was built through its own orchestration loop before the public publish pass. This page summarizes the evidence that the core run model, workspace boundaries, and Oz observability surfaces have already been exercised inside the CoCoder dogfood workspace.

## Sub-Playbook E orchestration runs

Sub-Playbook E proved that CoCoder could compose, launch, dispatch, verify, and close real work against the CoCoder repository itself.

Evidence from `cocoder/SESSION_LOG.md` records:

- First end-to-end dogfood execution, `run-20260522T133403Z-rwrkcfcg`: Talia ported `core.test.mjs`; Bob independently audited and accepted; full core suite reached 75/75 passing.
- Reproducibility run, `run-20260522T135126Z-t4rnd35z`: Talia ported `dispatch.test.mjs`; both lanes returned `PASS`; full core suite reached 86/86 passing.
- Chained autonomous runs, `run-20260522T160453Z-nsluixnb` and `run-20260522T161135Z-i3wg7ti9`: additional adapter and composition ports moved the suite to 110/110 passing, with run-local result artifacts and boundary notes.
- Sub-Playbook E final closure on 2026-05-23: the dogfood loop became the reusable basis for persona identity regression coverage and workspace-template validation.

Those runs also surfaced and pinned real orchestration defects: model-role null handling, `iso-datetime` schema validation, private legacy pattern false positives, workspace-slug path parsing, and lead-lane sandbox requirements.

## Boundary evidence

The dogfood workspace exercises the same four-zone model documented in [`ARCHITECTURE.md`](../ARCHITECTURE.md):

- tracked install surfaces under `packages/`, `docs/`, `templates/`, and root project files
- ignored install-local run records under `<CoCoder>/local/workspaces/<workspace-slug>/`
- tracked workspace governance under `<CoCoder>/cocoder/`
- ignored workspace-local overrides under `<CoCoder>/cocoder/local/`

Regression coverage now includes workspace artifact paths, nested workspace refusal, persona prompt identity, template/dogfood drift, and orchestrator commit boundary behavior.

## Oz observability

Sub-Playbook C expanded Oz from security and registry primitives into the v0.1 operator surface:

- PR #42: workspace registry HTTP CRUD plus auth bootstrap; core suite 322/322.
- PR #43: runs API, evidence endpoint, multiplexer observer, and launch/stop subprocess path; core suite 328/328.
- PR #45: dashboard scaffold, Workspaces page, Settings page, and dashboard tests; core suite 330/330 plus dashboard 5/5.
- PR #47: Priorities, Runs, Run Inspector, polling behavior, and end-to-end Oz coverage; core suite 335/335 plus dashboard 8/8.

The public operator docs intentionally summarize rather than duplicate the C Expand implementation details:

- [`docs/oz.md`](./oz.md)
- [`docs/oz-launch.md`](./oz-launch.md)
- [`docs/oz-security-checklist.md`](./oz-security-checklist.md)

## Current limitation

This is release-candidate evidence, not a fresh external user study. The v0.1 publish bar keeps the internal-proxy dry run as the remaining readiness check before the founder tags `v0.1.0`.
