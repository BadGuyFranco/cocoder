# Drift Audit Owner Map

Scope: analysis only for the Drift Audit reframe. Drift now runs as an ordinary Oscar-driven priority:
atoms call the audit engines directly as library tooling, while founder gates are normal wrap/verify
beats rather than an in-loop phase-executor. ADR-0026 retires the standalone executor runner-mode and
preserves the audit engines as tooling (`cocoder/decisions/0026-onboard-existing-as-oscar-priority.md:44-61`,
`cocoder/decisions/0026-onboard-existing-as-oscar-priority.md:71-80`); ADR-0020 defines Drift as the
third onboarding situation for an already-managed `cocoder/` root (`cocoder/decisions/0020-primary-root-audit.md:57-64`,
`cocoder/decisions/0020-primary-root-audit.md:95-103`). The `cocoder/**`-only audit write boundary
applies to the founder-ratified apply step only: P1-P4 produce report artifacts, and only P6 lands
ratified governance through the commit spine (`cocoder/decisions/0020-primary-root-audit.md:131-136`,
`cocoder/priorities/drift-audit.md:16-28`).

## Evidence Commands

- `sed -n '1,260p' docs/onboarding-rebuild-ownermap.md` established the template structure and evidence style.
- `nl -ba cocoder/priorities/drift-audit.md | sed -n '1,110p'` verified the Reuse map and proposed atom sequence.
- `nl -ba cocoder/decisions/0026-onboard-existing-as-oscar-priority.md | sed -n '1,130p'` verified the executor retirement and ordinary-priority reframe.
- `nl -ba cocoder/decisions/0020-primary-root-audit.md | sed -n '1,190p'` verified the three onboarding situations, Drift propose-only shape, and `cocoder/**` trust boundary.
- `nl -ba packages/core/src/playbooks/{recon.ts,recon-pass.ts,p2-fanout.ts,p2-dispatch.ts,p6-apply.ts}` verified the reusable onboard-existing engines.
- `nl -ba packages/core/src/{priorities/loader.ts,commit-gate/gate.ts,runner/agent-step.ts,runner/runner.ts,runner/prompts.ts}` verified priority boundary parsing, commit-gate enforcement, and the ordinary directive/verify/wrap loop.

## 1. Classification - Reuse Boundary

| Engine/symbol | File:line | Drift phase it serves | Verdict | Note |
|---|---|---|---|---|
| `inventoryRepo` | `packages/core/src/playbooks/recon.ts:38-65` | P2 read-reality | REUSE-AS-IS | Deterministic repo inventory already reports packages, scripts, entry points, language indicators, validation roots, and risk hints. Drift needs the same reality baseline. |
| `runAgenticRecon` | `packages/core/src/playbooks/recon-pass.ts:58-60`; prompt/parser at `packages/core/src/playbooks/recon-pass.ts:63-93` | P2 read-reality | ADAPT | The engine and structured output are reusable, but the surviving Drift surface should not expose "P1 Agentic Recon Pass" wording from the onboard-existing prompt (`packages/core/src/playbooks/recon-pass.ts:65`). Rename/framing only; parser stays. |
| `runDeepReadSource` | `packages/core/src/playbooks/p2-fanout.ts:153-177` | P2 read-reality | REUSE-AS-IS | This is the bounded per-source read loop with iteration, wall-clock, and token caps. It is already source-agnostic over a `Subsystem` and `DeepReadTurn`. |
| `combineSourcePair` | `packages/core/src/playbooks/p2-fanout.ts:179-193` | P2 read-reality | REUSE-AS-IS | Combines builder + orchestrator source records into a convergence payload and agreement index; Drift can treat disagreements as reality uncertainty. |
| `resolveDeepReadAssignments` | `packages/core/src/playbooks/p2-dispatch.ts:42-65` | P2 read-reality | REUSE-AS-IS | Preserves top-tier/different-source enforcement for Bob vs Oscar deep reads; Drift should not fork this assignment rule. |
| `createDeepReadTurn` | `packages/core/src/playbooks/p2-dispatch.ts:67-87` | P2 read-reality | ADAPT | Dispatch mechanics are reusable, but the output path is hard-coded to `playbook/P2/findings/...` (`packages/core/src/playbooks/p2-dispatch.ts:70`). Drift should parameterize the artifact root or wrap this for Drift P2 paths. |
| `applyP6Governance` materialize staged files to `cocoder/**` | `packages/core/src/playbooks/p6-apply.ts:73-113`; staged root at `packages/core/src/playbooks/p6-apply.ts:57-58` | P5 ratify / P6 apply | ADAPT | The materialize-and-record behavior is reusable, but the current owner reads onboard-existing `P5` synthesis and `playbook/P5/proposed-cocoder` (`packages/core/src/playbooks/p6-apply.ts:74-82`). Drift needs an apply adapter over ratified amendment artifacts. |
| `runPlaybookP6Action` ratification package | `packages/core/src/playbooks/p6-apply.ts:60-70` | P5 ratify | ADAPT | It creates a ratification package from onboard-existing synthesis. Drift needs the same ratify concept, but its package source is P4 report amendments/tickets, not P5 governance synthesis. |
| `AuditWriteBoundary` | `packages/core/src/commit-gate/gate.ts:41-44` | P6 apply | REUSE-AS-IS | The hard scope object is already generic: `{ label, scope }`. Drift should set `scope: ["cocoder/**"]` through priority frontmatter. |
| `AuditWriteBoundaryError` | `packages/core/src/commit-gate/gate.ts:46-54` | P6 apply | REUSE-AS-IS | Existing refusal error already reports self-commit or offending paths; no Drift-specific class needed. |
| `runCommitGate` audit boundary enforcement | `packages/core/src/commit-gate/gate.ts:57-90` | P6 apply | REUSE-AS-IS | The gate refuses any changed path outside `auditWriteBoundary.scope` before committing (`packages/core/src/commit-gate/gate.ts:67-73`), while ordinary scope remains advisory (`packages/core/src/commit-gate/gate.ts:75-90`). |
| Priority `auditWriteBoundary` parsing/threading | `packages/core/src/priorities/loader.ts:42-55`; `packages/core/src/runner/runner.ts:507-510` | P6 apply | REUSE-AS-IS | Frontmatter already becomes the runner's `AuditWriteBoundary`; no runner-mode or executor hook is needed. |
| Ordinary Oscar->Bob directive + verify + atom commit loop | `packages/core/src/runner/runner.ts:1106-1124`, `packages/core/src/runner/runner.ts:1190-1248`; `packages/core/src/runner/agent-step.ts:228-270`; `packages/core/src/runner/prompts.ts:539-557` | Driver + founder gates | REUSE-AS-IS | This is the shipping atom protocol: directive, Bob completion marker, Oscar verify artifact, commit on pass, then next-or-wrap. Drift phases should be ordinary atoms in this loop. |
| Wrap/resume / pickup continuity | `packages/daemon/src/launcher.ts:103-129`; `packages/core/src/runner/runner.ts:1121-1187`; `packages/core/src/runner/runner.ts:1254-1265` | Driver + founder gates | REUSE-AS-IS | Founder ratification is a normal Oscar decision/wrap/resume beat, with pickup briefs carrying continuity instead of typed executor gate payloads. |
| Inert Drift phase skeleton | `packages/personas/base/playbooks/drift-audit.md:23-36` | Phase reference only | ADAPT | The phase order is useful, but ADR-0020's loader amendment moved onboarding delivery away from shipped playbooks to ordinary seeded priorities (`cocoder/decisions/0020-primary-root-audit.md:119-129`). Do not revive the playbook executor. |
| P1 read-claims | Requirement at `cocoder/priorities/drift-audit.md:40`; inert phase at `packages/personas/base/playbooks/drift-audit.md:27` | P1 read-claims | NEW | No existing onboard-existing owner reads `cocoder/` governance as claims. Recon reads repo reality, not governance truth claims. |
| P3 compare | Requirement at `cocoder/priorities/drift-audit.md:41`; inert phase at `packages/personas/base/playbooks/drift-audit.md:29` | P3 compare | NEW | Existing P3 cross-check compares dual source reads, not governance claims versus reality. Drift needs a non-gameable claims-vs-reality diff. |
| P4 report | Requirement at `cocoder/priorities/drift-audit.md:42`; inert phase at `packages/personas/base/playbooks/drift-audit.md:30` | P4 report | NEW | Existing renderers report onboarding synthesis/questions. Drift needs report + amendment/ticket draft artifacts without rewriting governance. |

## 2. NEW Drift Engines

| Piece | Proposed owner | Input -> output contract |
|---|---|---|
| P1 read-claims | `packages/core/src/drift/read-claims.ts`, exported through `packages/core/src/drift/index.ts` | Input: target repo root plus `cocoder/` governance path. Output: `DriftClaimsInventory` with versioned claims, source file paths, and file:line/source-span evidence for each claim. Refuse malformed governance, duplicate ids, unreadable required governance files, or claims without source evidence. No writes. |
| P3 compare | `packages/core/src/drift/compare.ts` | Input: `DriftClaimsInventory` + P2 `DriftRealityInventory`. Output: versioned `DriftFinding[]`, each with claim evidence, reality evidence, severity, and proposed amendment/ticket kind. Empty claims or empty reality produce an empty finding set, not invented findings. The comparator is deterministic and non-gameable: a finding requires concrete mismatch evidence from both sides. |
| P4 report | `packages/core/src/drift/report.ts` | Input: P3 findings plus target metadata and optional founder/report settings. Output: a `DriftReportPackage` containing `report.md`, machine-readable findings JSON, and amendment/ticket draft artifacts. The engine returns artifacts for the caller to write under the run directory only; it never edits `cocoder/**` in place. |

## 3. Open Seams / Risks

| Seam | Risk | Evidence |
|---|---|---|
| `runAgenticRecon` prompt labels the pass as P1. | This is harmless internally but can leak stale phase naming into Drift P2 artifacts unless the caller/prompt is adapted. | Prompt heading is `# P1 Agentic Recon Pass` (`packages/core/src/playbooks/recon-pass.ts:63-66`); Drift priority assigns recon to P2 read-reality (`cocoder/priorities/drift-audit.md:37`, `cocoder/priorities/drift-audit.md:49`). |
| `createDeepReadTurn` owns an onboard-existing artifact path. | Reusing it as-is would write Drift reads under `playbook/P2/findings`, preserving retired playbook vocabulary and making later Drift artifacts harder to reason about. | Output path is hard-coded at `packages/core/src/playbooks/p2-dispatch.ts:67-78`; ADR-0026 retires executor/playbook runner-mode (`cocoder/decisions/0026-onboard-existing-as-oscar-priority.md:71-80`). |
| `applyP6Governance` assumes onboard-existing P5 synthesis. | The path safety is right, but Drift ratification applies selected amendments/tickets from P4, not a full P5 governance synthesis payload. | Source root is `playbook/P5/proposed-cocoder` (`packages/core/src/playbooks/p6-apply.ts:57-58`); apply reads P6 synthesis then materializes staged files (`packages/core/src/playbooks/p6-apply.ts:73-87`). |
| Priority boundary must be present on the future seeded Drift priority. | `runCommitGate` can enforce `cocoder/**`, but only when the launched priority frontmatter supplies `auditWriteBoundary`. | Loader parses optional boundary (`packages/core/src/priorities/loader.ts:42-55`); runner threads it only when present (`packages/core/src/runner/runner.ts:507-510`). |
| No named Reuse-map symbol was unlocated. | P1 read-claims, P3 compare, and P4 report are intentionally NEW rather than missing existing symbols. | Priority Reuse map declares the three as NEW (`cocoder/priorities/drift-audit.md:40-42`). |

## Working Disposition

Complete for analysis. Drift should reuse the repo inventory, dual-source read loop, commit gate, and
ordinary Oscar run protocol; adapt recon labeling, deep-read artifact paths, and P6 apply/ratification
inputs; and add three new Drift-owned engines for read-claims, compare, and report before any apply work.
