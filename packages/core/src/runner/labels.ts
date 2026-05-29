// Human pane labels for a run's persona windows: "<Persona> | <LLM> | <Model>" — e.g.
// "Oscar | Claude | Opus 4.8" — so the founder sees who / which CLI / which model at a glance on cmux.
// (The workspace itself is named for the run — "<priority> #<n>" — via SpawnOptions.groupLabel.)
import type { ResolvedPersona } from '../personas/index.js'

// cli id → human LLM name.
const LLM_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', 'cursor-agent': 'Cursor' }
// Pinned model ids → friendly names; extend as models get pinned in assignments.
const MODEL_NAMES: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
}
// The CLI's DEFAULT model, shown in the label when the assignment leaves `model` unpinned (""). This is
// DISPLAY-ONLY — it does not change the launch `--model` (the CLI still picks its own default), so the
// label reads e.g. "Opus 4.8" without forcing a model. Update if a CLI's default changes; an unmapped
// CLI shows "default" (truthful) rather than a guess (codex's default id isn't pinned here yet).
const DEFAULT_MODELS: Record<string, string> = { claude: 'Opus 4.8' }

export const llmName = (cli: string): string => LLM_NAMES[cli] ?? cli
export const modelName = (cli: string, model: string): string =>
  model.trim() !== '' ? (MODEL_NAMES[model] ?? model) : (DEFAULT_MODELS[cli] ?? 'default')

/** "<Persona> | <LLM> | <Model>" for a persona's pane/tab. */
export const paneLabel = (p: ResolvedPersona): string => `${p.label} | ${llmName(p.cli)} | ${modelName(p.cli, p.model)}`
