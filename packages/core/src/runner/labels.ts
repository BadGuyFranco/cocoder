// Human pane labels for a run's persona windows: "<Persona> | <LLM> | <Model>" — e.g.
// "Oscar | Claude | Opus 4.8" — so the founder sees who / which CLI / which model at a glance on cmux.
// (The workspace itself is named for the run — "<priority> #<n>" — via SpawnOptions.groupLabel.)
import type { ResolvedPersona } from '../personas/index.js'

// cli id → human LLM name.
const LLM_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', 'cursor-agent': 'Cursor' }
// Known model ids → friendly names; extend as models get pinned in assignments. An unpinned model
// (assignment model:"") shows "default" — the truthful state, since the CLI picks its own default.
const MODEL_NAMES: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
}

export const llmName = (cli: string): string => LLM_NAMES[cli] ?? cli
export const modelName = (model: string): string => (model.trim() === '' ? 'default' : (MODEL_NAMES[model] ?? model))

/** "<Persona> | <LLM> | <Model>" for a persona's pane/tab. */
export const paneLabel = (p: ResolvedPersona): string => `${p.label} | ${llmName(p.cli)} | ${modelName(p.model)}`
