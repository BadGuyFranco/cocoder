import { partitionByScope } from '../write-scope/index.js'

export function declaredOutOfScopeWritePaths(writePaths: readonly string[], scope: readonly string[]): readonly string[] {
  return partitionByScope(writePaths, scope).outOfScope
}
