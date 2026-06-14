---
id: personas-and-plays
title: "Personas + Plays — base QA roster (Quinn, Talia) + no-brainer Plays on one living-base model"
---

## Objective
**One** living-base + per-repo-extension model governs **both personas and Plays**, and the base QA
roster plus the orchestration Plays we already know we need are landed on it. (Master priority — merges
the former `base-and-extension-personas` and `no-brainer-plays`, since personas and Plays share the same
base/delta model and the QA personas only exist to run the test Plays.)

**Already done — do NOT rebuild (run_17, ADR-0012):** the persona base/delta *mechanism*. The base set
ships as `@cocoder/personas` (`packages/personas/`) as the single source; repos layer `deltas/<id>.md`
or add repo-only personas; the `core` loader merges at load; and a base improvement provably reaches an
already-extended repo (`personas-propagation.test.ts`). CoCoder's own personas are split base-vs-delta.
This priority **completes the roster** and **extends the same model to Plays**.

**Remaining — what this priority builds and verifies:**

1. **Base QA personas — Quinn and Talia (at least).** Neither exists in v2 yet (base set is only
   Oscar/Bob/Deb). **Talia** = acceptance QA: spec-first, derives expectations from specs/architecture,
   actively probes failure paths, owns the verdict (does not inherit builder confidence). **Quinn** =
   automated user-simulation: drives the running app/IDE/website, captures DOM/visual/console evidence,
   read-only. Port the good rules from the archived v1 personas, and **re-home the v1 Talia↔Quinn
   boundary** (old v1 ADR-0002) into the rebuild's persona+Play model as design homework.
2. **The no-brainer Plays:** `documentation`, `code-review`, and Quinn's `electron-test` — the last
   built by **refactoring the ad-hoc Oz-dashboard test scripts from `full-oz-dashboard` into a real
   Play / reusable scaffolding** (tech-debt paydown; earned, not speculative).
3. **Extend the base/delta model to Plays (the coupling).** A base Play is generic (`electron-test` =
   how to test any Electron app); a repo carries a **Play delta** (or scoped task context) for its
   specifics — CoCoder-Quinn's `electron-test` delta for driving the *Oz* Electron app is the first
   concrete case. This is ADR-0012's persona model applied to Plays; ADR it (ADR-0014) only if it proves
   a genuine seam.

**Verified when:** base Quinn and Talia exist in the base set and load (with CoCoder deltas where
needed); `documentation` and `code-review` each dispatch on their assigned models and do their job
in-scope on a real run; Quinn's `electron-test` Play validates a real **Oz dashboard** flow and reports
pass/fail with evidence via the CoCoder-Quinn delta; and a **Play delta provably overrides/extends a
base Play** the way a persona delta does.

**Boundary:** the base QA personas (Quinn, Talia) + the three no-brainer Plays + the Plays base/delta
decision. **Not:** other personas (Ian/Phil/verifier stay demand-driven); **browser** testing of
external apps (stays in backlog [`quinn-app-testing`](./backlog/quinn-app-testing.md), Phase-5-deferred —
no website yet); changing what existing personas do.

## Status — CODE-COMPLETE (run_79)

The buildable work is done. What landed across run_78 (4 atoms) + run_79 (2 atoms):
- Base **Quinn** + **Talia** personas exist and load (run_78 `d2f014d`).
- Plays **base/delta mechanism** in core (run_78 `6bc6615`), the **documentation** + **code-review**
  base Plays (run_78 `f9b828f`), and the **electron-test** base Play + first repo **Play delta**
  (run_78 `10289de`).
- Play deltas are now **honored at run-launch** — `buildRunInput` loads via `loadEffectivePlay`
  (run_79 `c2a838c`); a daemon seam test proves a delta wins at launch and no-delta = base.
- One-command proof harness **`scripts/proof-plays.mjs`** (run_79) machine-proves verified-when
  clauses 1 & 4 against real repo files and bounds the live remainder. `node scripts/proof-plays.mjs`
  → exit 0, 4/4 PASS.

**Remaining = founder-present live evidence only (not delegatable atoms):**
1. documentation + code-review Plays **dispatch** on their assigned CLI/models on a real run and do
   their job in-scope (live half of verified-when clause 2).
2. Quinn's `electron-test` delta **drives the real Oz dashboard** GUI and reports pass/fail with
   captured evidence (verified-when clause 3) — no CDP/GUI driver exists yet (run_78 boundary), so this
   stays founder-present.

**Archive-candidate** once those two live proofs pass. Do NOT relaunch as a build run — there are no
buildable atoms left (F18); the next step is the live ladder above.
