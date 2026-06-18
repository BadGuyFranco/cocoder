---
id: 0016
title: Atom quarantine hard-deletes a rejected atom's untracked files with no recovery path
type: bug
status: Open
priority: workspace-segmentation
owner: oscar run_135
created: 2026-06-18
---

# 0016 — Atom quarantine hard-deletes a rejected atom's untracked files with no recovery path

## Symptom
Run run_135, atom 1: the builder produced a sound `cocoder/decisions/0027-workspace-storage-contract.md`.
Oscar failed the verify gate **on purpose** — per ADR-0014 an ADR that amends accepted ADRs needs founder
approval, which a persona verify-pass cannot give — intending to *hold* the draft for the founder. The
file was **permanently gone from the working tree** by the time Oscar wrote the wrap directive. Recovery
was only possible because the full ADR text happened to still be in Oscar's session context; nothing on
disk or in git history held it. The wrap pickup's "held back, do not delete" instruction was operating on
a file that had already been destroyed at the moment of rejection.

## Root Cause
On a rejected atom the runner calls `quarantineAtom` (`packages/core/src/runner/runner.ts:774`), which
collects every file the atom produced (`git.changedFiles`, untracked-files=all, minus `dirtyAtStart`) and
calls `restoreToHead` (`packages/core/src/commit-gate/git.ts:157`). For a **tracked** file that is
`git checkout HEAD -- <f>` (recoverable from HEAD). For an **untracked** file it is `git clean -f -- <f>`
— an **irreversible hard delete**. A rejected atom's brand-new files are untracked by definition, so they
are destroyed with no copy anywhere.

Quarantine *itself* is correct and must stay: it deliberately discards a rejected atom's tree changes so
they can't ride into a later passing atom's whole-tree commit (the gate commits the whole tree). The
defect is narrower and twofold:

1. **Destructive, not recoverable.** `clean -f` annihilates the only copy. A rejected atom's work should
   be *removed from the worktree* (so it can't contaminate a later commit) **without being unrecoverable**.
2. **No "hold for approval" disposition.** A verify-fail meaning "this work is wrong" and a verify-fail
   meaning "this work is sound but needs founder approval (ADR-0014)" are treated identically — both hard-
   deleted. The orchestrator has no way to reject-an-atom-but-preserve-the-artifact, so a governance hold
   silently loses the artifact.

## Fix options (pick at build; 1 is the core fix)
1. **Non-destructive quarantine (recommended):** instead of `git clean -f`, *move* a rejected atom's
   untracked files into a run-scoped stash, e.g. `local/runs/<runId>/quarantine/atom-<n>/<path>`, and
   record the stash location in the existing `atom-quarantined` event (`runner.ts:786`). The worktree is
   still clean (no contamination), but nothing the agent produced is ever truly lost — recovery is a copy-
   back. Tracked files keep the `checkout HEAD` behavior (already recoverable from HEAD). This fixes the
   whole defect class, not just ADRs.
2. **Distinct "hold" verdict:** give the verify gate a third disposition (e.g. `hold`) separate from
   `fail`, that preserves the atom's artifact (no quarantine, or quarantine-to-stash) and surfaces it for
   founder approval. Complements (1); without (1), `fail` is still silently destructive.
3. **Quarantine receipt visibility:** whatever the storage choice, the `atom-quarantined` event must name
   where the files went (or that they were deleted) so a "held" file can never be silently lost — surface,
   don't swallow (shared-standards: no silent caps). Sibling concern to ticket 0015's silent-drop class.

## Acceptance criteria
- A rejected atom's untracked file is **recoverable** after quarantine (proven by a runner/gate test:
  fail an atom that creates `foo.md`, assert the worktree no longer contains it AND it is retrievable from
  the recorded quarantine location).
- Tracked-file quarantine behavior is unchanged (still restored from HEAD).
- The `atom-quarantined` event records the recovery location (or explicit deletion), so the disposition is
  never silent.
- No regression to the contamination guard: a rejected atom's work still cannot appear in a later atom's
  commit (assert the whole-tree commit of a subsequent passing atom excludes the quarantined paths).

## Workaround applied run_135
ADR-0027 was reconstructed from Oscar's session context and landed with founder approval (history: yes,
identity: keep) plus the ADR-0014 banners on 0003/0019 and the index update. This ticket tracks the
underlying engine defect so the next governance-hold (or any rejected-but-valuable atom) isn't lost the
same way.
