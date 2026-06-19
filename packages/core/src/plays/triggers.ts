import { playAvailability } from './manifest.js'
import type { Play } from './types.js'

export const MANDATORY_PLAY_TRIGGERS = {
  'run-wrap': 'wrap-up',
} as const

export type MandatoryPlayTriggerPoint = keyof typeof MANDATORY_PLAY_TRIGGERS

export function resolveMandatoryPlay(triggerPoint: MandatoryPlayTriggerPoint, effectivePlays: readonly Play[]): Play {
  const playId = MANDATORY_PLAY_TRIGGERS[triggerPoint]
  const play = effectivePlays.find((candidate) => candidate.id === playId)
  if (!play) {
    throw new Error(`mandatory Play trigger "${triggerPoint}" is bound to missing Play "${playId}"`)
  }
  if (playAvailability(play) !== 'mandatory') {
    throw new Error(`mandatory Play trigger "${triggerPoint}" is bound to non-mandatory Play "${playId}"`)
  }
  return play
}
