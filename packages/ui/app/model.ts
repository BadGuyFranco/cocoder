// Domain model for the Oz renderer — the data shapes the V1 design is built around (see
// design-ref/README.md "Data model"). The renderer consumes these view-model types; in fixture mode
// they come from the ported prototype seed (seed.json), and in live mode from a daemon→view adapter
// (built in the wiring slice). One shape means surfaces don't care which backend filled them.
import seedJson from './seed.json'

export type RootRole = 'primary' | 'writable' | 'readonly'
export interface Root { id: string; name: string; path: string; role: RootRole; resolvedPath?: string; description?: string }

export type RunStatus = 'running' | 'blocked' | 'complete' | 'failed' | 'stopped'

export interface PersonaSpec {
  name: string; tagline: string; description: string
  cli: string; model: string; runMode: 'visible' | 'headless'
  capabilities: string; needsSubAgents: boolean; subAgentSketch: string
}
export interface Priority {
  id: string; name: string; summary: string
  status: string; labels: string[]
  runId?: string; spec?: PersonaSpec
}
export interface Workspace {
  id: string; name: string; description: string; icon: string
  roots: Root[]; priorities?: Priority[]; created?: string
}
export interface TranscriptLine { role: string; body: string; flag?: string }
export interface EvidenceItem { kind: string; label: string; body?: string; lines?: string }
export interface Run {
  id: string; title: string; status: RunStatus
  priorityId?: string | null
  personas: string[]; cli: string; startedAt: string
  progress?: number | null; lastEvent?: string; attachCmd?: string
  transcript?: TranscriptLine[]; evidence?: EvidenceItem[]
}
export interface Play {
  id: string; label: string; kind: 'headless' | 'interactive'; writeScope: readonly string[]
}
export interface SubAgent { id: string; name: string; cli: string; model: string }
export interface Persona {
  id: string; name: string; role: string; description: string; icon: string
  cli: string; model: string; runMode: 'visible' | 'headless'
  subAgents: SubAgent[]; headless?: boolean
}
export type CliStatus = 'ok' | 'auth-failed' | 'not-installed'
export interface CliRunReadiness {
  mechanism: string; flags: string[]; managesUserConfig: boolean; detail: string
}
export interface Cli {
  id: string; name: string; vendor: string; status: CliStatus
  version: string; lastTested: string; models: string[]; errorDetail?: string | null
  tested: boolean; canEnumerate: boolean; headlessCapable: boolean; modelsDetail?: string; runReadiness?: CliRunReadiness
}
export type DepStatus = 'ok' | 'not-installed'
export interface Dependency {
  id: string; name: string; vendor: string; purpose: string; status: DepStatus
  version: string | null; lastChecked: string; installCmd: string; icon: string; note?: string | null
}
export interface ChatMessage {
  id: string; role: 'oz' | 'user' | 'system'; body: string; time: string
  flag?: 'decision'; attachments?: { kind: string; runId: string }[]
}
export interface Settings {
  preferences: { theme: 'dark' | 'light'; sound: boolean; sendOnEnter: boolean }
  watching: { notifyOnDecisionNeeded: boolean; notifyOnRunFailed: boolean; notifyOnRunComplete: boolean; desktopNotifications: boolean; slackWebhook: string }
  advanced: { transcriptRetention: number; autoAttach: boolean }
}
export const DEFAULT_SETTINGS: Settings = {
  preferences: { theme: 'dark', sound: false, sendOnEnter: true },
  watching: { notifyOnDecisionNeeded: true, notifyOnRunFailed: true, notifyOnRunComplete: false, desktopNotifications: true, slackWebhook: '' },
  advanced: { transcriptRetention: 7, autoAttach: true },
}

// ── Seed (the prototype's demo content; powers fixture mode + visual parity) ──
interface Seed {
  workspaces: Workspace[]
  priorities: Record<string, Priority[]>
  runsByWs: Record<string, Run[]>
  plays: Play[]
  personas: Persona[]
  clis: Cli[]
  dependencies: Dependency[]
  ozChat: Record<string, ChatMessage[]>
  settings: { preferences?: Partial<Settings['preferences']>; watching?: Partial<Settings['watching']>; advanced?: Partial<Settings['advanced']> }
}
export const seed = seedJson as unknown as Seed

export const phicon = (icon: string): string => icon.replace('ph-thin ph-', '')
