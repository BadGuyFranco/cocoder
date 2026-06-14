export { makeGit, parsePorcelain, type Git, type WorktreeInfo } from './git.js'
export { runCommitGate, type CommitGateInput, type CommitGateResult } from './gate.js'
export { gateCommitRepair, type RepairCommitInput, type RepairCommitResult } from './repair.js'
export { commitFiles, commitScoped, type CommitReceipt, type CommitAuthor } from './workspace-commit.js'
