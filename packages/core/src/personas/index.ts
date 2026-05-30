export type { Persona, PersonaDelta, PersonaAssignment, Assignments, ResolvedPersona } from './types.js'
export { parseFrontmatter, type Frontmatter } from './frontmatter.js'
export { loadPersona, loadAssignments, isPersonaEnabled, resolvePersona } from './loader.js'
export { mergePersona, PersonaMergeError } from './merge.js'
export {
  loadPersonaDelta,
  loadEffectivePersona,
  resolveEffectivePersona,
  PersonaDeltaLoadError,
  type PersonaSources,
} from './effective.js'
