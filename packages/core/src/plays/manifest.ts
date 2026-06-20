import { isReservedPlay, type Play } from './types.js'

export type PlayAvailability = 'mandatory' | 'optional'

export function playAvailability(play: Pick<Play, 'triggerClass'>): PlayAvailability {
  return play.triggerClass === 'lifecycle-triggered' ? 'mandatory' : 'optional'
}

export function renderPlayManifest(plays: readonly Play[], caller: string): string {
  const visible = plays.filter((play) => !isReservedPlay(play) && play.allowedCallers?.includes(caller))
  if (visible.length === 0) return '(none)'

  return visible
    .map((play) => {
      const purpose = play.purpose ?? 'No purpose declared.'
      const trigger = play.triggerClass ?? 'unspecified'
      const input = play.inputSchema?.ref ?? 'none'
      return `- ${play.id}: ${purpose} | trigger: ${trigger} | ${playAvailability(play)} | writes: ${writeBehavior(play)} | input: ${input}`
    })
    .join('\n')
}

function writeBehavior(play: Pick<Play, 'writeScope'>): string {
  if (play.writeScope.length === 0) return 'read-only'
  return play.writeScope.join(', ')
}
