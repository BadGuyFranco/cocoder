export { makeGit, parsePorcelain, type Git, type WorktreeInfo } from './git.js'
export { AuditWriteBoundaryError, runCommitGate, type AuditWriteBoundary, type CommitGateInput, type CommitGateResult } from './gate.js'
export { gateCommitRepair, type RepairCommitInput, type RepairCommitResult } from './repair.js'
export { COCODER_GOVERNANCE_AUTHOR, commitFiles, commitScoped, type CommitReceipt, type CommitAuthor } from './workspace-commit.js'
