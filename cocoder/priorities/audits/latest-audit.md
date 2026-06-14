# Priority Set Audit — 2026-06-14 (actioned)

Founder-directed, post `orchestration-operating-model-reset`. Unlike the prior read-and-recommend pass
(run_80), the founder approved acting on the findings, so the dispositions below were **applied this
pass** (direct-to-branch governance commits, ADR-0023).

| Priority | Was | Disposition | Action taken |
|---|---|---|---|
| `orchestration-operating-model-reset` | Active, in flight | keep active (archive-candidate) | Code-complete; all six phases landed + pushed. Kept active pending an optional live founder demo; PLAYBOOK entry slimmed to one block. |
| `personas-and-plays` | Active, CODE-COMPLETE | **archive** | `git mv` → `zArchive/v2/personas-and-plays.md`; added to PLAYBOOK "Done". The 2 founder-present live proofs are opportunistic, recorded in the Done note. |
| `full-oz-dashboard` | Active, 704-line run-log | **redefine + de-stale** | Rewritten as a lean stub (704 → ~55 lines): Objective + a founder live-proof ladder. Removed the pre-reset run-by-run log (lives in PLAYBOOK + SESSION_LOG + git) and the 42 stale ADR-0015/21/22 references; added a post-reset surface-check note (ADR-0023 changed resolve/Awaiting-you semantics). |
| `new-primary-root` | Active, overlaps onboarding | **merge** | Absorbed `workspace-onboarding` (two operated-from-Oz flows + the workspace-footprint contract + CoPublisher motivation) into the launch note; one bootstrap/audit/onboarding path now. |
| `workspace-onboarding` | Backlog | **merge → removed** | Folded into `new-primary-root`; `git rm` the backlog file. |
| `deployment-plays` | Backlog | **update blocker** | Blocker was the (now-built) Plays mechanism; rewritten to "Phase 5 only — external deploy target + secrets UX". |
| `multi-repo-commit-spine` | Backlog | **update** | Added an ADR-0023 reconciliation note — multi-root = one commit-spine instance per root; the "per-root worktree isolation" framing predates the reset (isolation is now opt-in). |
| `quinn-app-testing` | Backlog | **label fix** | File already browser-only; the stale PLAYBOOK "Quinn persona + browser/Electron" summary narrowed to browser-only (Quinn + electron-test shipped under archived personas-and-plays). |
| `priority-architecture-contract` | Backlog | keep (flag) | Left as the founder-owned placeholder; PLAYBOOK note added to re-scope it to a real launch boundary (not governance-of-governance, G4/F5) before any build. |
| `build-priorities-from-plan` · `priority-audit` · `adhoc-session` | Active meta | keep-active | The three standing meta-priorities; unchanged. |

**Net:** active set 5 → 4 (`orchestration-operating-model-reset`, `full-oz-dashboard`, `new-primary-root`
+ 3 meta); backlog 5 → 4 (onboarding folded out). One archive, one big de-stale/redefine, one merge,
three backlog updates. No live ADR/priority now describes the retired orchestration model as current.
