import type { RunDetail, RunEvent } from '../../main/ipc-contract.ts'
import { Button, Icon, Modal } from '../ui/primitives.tsx'

export interface LaunchProgressState {
  readonly open: boolean
  readonly title: string
  readonly runId: string | null
  readonly detail: RunDetail | null
  readonly error: string | null
}

type PersonaId = 'oscar'

function dataString(event: RunEvent, key: string): string | null {
  const value = event.data[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function persona(event: RunEvent): string | null {
  return dataString(event, 'persona')?.toLowerCase() ?? null
}

function spawnStart(detail: RunDetail | null, id: PersonaId): RunEvent | undefined {
  return detail?.events.find((event) => event.type === 'launch-spawn-start' && persona(event) === id)
}

function spawnEnd(detail: RunDetail | null, id: PersonaId): RunEvent | undefined {
  return detail?.events.find((event) => event.type === 'launch-spawn-end' && persona(event) === id)
}

function eventOk(event: RunEvent | undefined): boolean {
  return event?.data.ok === true
}

function eventFailed(event: RunEvent | undefined): boolean {
  return event?.data.ok === false
}

export function launchIsUp(detail: RunDetail | null): boolean {
  if (!detail) return false
  return detail.sessions.some((session) => session.persona.toLowerCase() === 'oscar') || eventOk(spawnEnd(detail, 'oscar'))
}

export function launchFailure(detail: RunDetail | null): string | null {
  if (!detail) return null
  const failedSpawn = detail.events.find((event) => event.type === 'launch-spawn-end' && eventFailed(event))
  if (failedSpawn) return dataString(failedSpawn, 'message') ?? `${dataString(failedSpawn, 'persona') ?? 'A launch pane'} failed to start.`
  const runError = detail.events.find((event) => event.type === 'run-error')
  if (runError) return dataString(runError, 'message') ?? 'The run failed during launch.'
  return detail.run.status === 'failed' ? 'The run failed during launch.' : null
}

function stageText(state: LaunchProgressState): string {
  const detail = state.detail
  if (!state.runId) return 'Contacting Oz daemon…'
  if (!detail) return 'Creating run…'
  const oscarStart = spawnStart(detail, 'oscar')
  const oscarEnd = spawnEnd(detail, 'oscar')
  if (eventOk(oscarEnd)) return 'Oscar ready.'
  if (oscarStart) return 'Starting Oscar…'
  if (detail.events.some((event) => event.type === 'launch-run-created')) return 'Preparing agent panes…'
  if (detail.events.some((event) => event.type === 'launch-stale-check-finished')) return 'Checking daemon freshness…'
  if (detail.events.some((event) => event.type === 'launch-run-input-assembled')) return 'Assembling run input…'
  return 'Creating run…'
}

export function LaunchProgressModal({ state, onClose }: { state: LaunchProgressState; onClose: () => void }) {
  const hasError = !!state.error
  const footer = hasError ? <Button variant="secondary" onClick={onClose}>Close</Button> : null
  return (
    <Modal
      open={state.open}
      onClose={onClose}
      title={state.title}
      subtitle={hasError ? 'Launch needs attention.' : stageText(state)}
      icon={hasError ? 'warning-circle' : 'rocket-launch'}
      width={520}
      footer={footer}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <style>{'@keyframes ozLaunchSpin { to { transform: rotate(360deg); } }'}</style>
        {hasError ? (
          <div role="alert" style={{ border: '1px solid var(--cb-highlight)', background: 'rgba(212,118,110,0.12)', color: 'var(--cb-text)', borderRadius: 'var(--cb-radius-md)', padding: 12, fontSize: 12.5, lineHeight: 1.5 }}>
            {state.error}
          </div>
        ) : (
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--cb-text)' }}>
            <Icon name="spinner" size={17} style={{ color: 'var(--cb-accent)', animation: 'ozLaunchSpin 900ms linear infinite' }} />
            {stageText(state)}
          </div>
        )}
        {state.runId && <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)' }}>{state.runId}</div>}
      </div>
    </Modal>
  )
}
