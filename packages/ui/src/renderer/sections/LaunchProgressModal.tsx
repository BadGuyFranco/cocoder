import { useState } from 'react'
import type { RunDetail, RunEvent } from '../../main/ipc-contract.ts'
import { Button, Icon, Modal } from '../ui/primitives.tsx'

export interface LaunchProgressState {
  readonly open: boolean
  readonly title: string
  readonly runId: string | null
  readonly detail: RunDetail | null
  readonly error: string | null
  readonly runnerlessLaunch: { readonly command: string; readonly pid: number | null } | null
  readonly manualHandoff: { readonly command: string } | null
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

function commandWorkingDirectory(command: string): string | null {
  const match = command.match(/^cd\s+(.+?)\s+&&\s+/)
  if (!match) return null
  const raw = match[1]!.trim()
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/'\\''/g, "'")
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1)
  return raw
}

export function LaunchProgressModal({ state, onClose }: { state: LaunchProgressState; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const hasError = !!state.error
  const hasRunnerlessLaunch = !!state.runnerlessLaunch
  const hasManualHandoff = !!state.manualHandoff
  const manualWorkingDirectory = state.manualHandoff ? commandWorkingDirectory(state.manualHandoff.command) : null
  const copyManualCommand = async (): Promise<void> => {
    if (!state.manualHandoff) return
    try {
      await navigator.clipboard?.writeText(state.manualHandoff.command)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  const footer = hasError || hasRunnerlessLaunch || hasManualHandoff ? <Button variant="secondary" onClick={onClose}>Close</Button> : null
  return (
    <Modal
      open={state.open}
      onClose={onClose}
      title={state.title}
      subtitle={hasError ? 'Launch needs attention.' : hasManualHandoff ? 'Manual runnerless handoff.' : hasRunnerlessLaunch ? 'Runnerless launch started.' : stageText(state)}
      icon={hasError ? 'warning-circle' : hasManualHandoff ? 'terminal-window' : hasRunnerlessLaunch ? 'check-circle' : 'rocket-launch'}
      width={520}
      footer={footer}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <style>{'@keyframes ozLaunchSpin { to { transform: rotate(360deg); } }'}</style>
        {hasError ? (
          <div role="alert" style={{ border: '1px solid var(--cb-highlight)', background: 'rgba(212,118,110,0.12)', color: 'var(--cb-text)', borderRadius: 'var(--cb-radius-md)', padding: 12, fontSize: 12.5, lineHeight: 1.5 }}>
            {state.error}
          </div>
        ) : hasManualHandoff ? (
          <div role="status" style={{ display: 'grid', gap: 10, border: '1px solid var(--cb-accent-30)', background: 'var(--cb-accent-muted)', color: 'var(--cb-text)', borderRadius: 'var(--cb-radius-md)', padding: 12, fontSize: 12.5, lineHeight: 1.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="terminal-window" size={16} style={{ color: 'var(--cb-accent)', flexShrink: 0 }} />
              <span>Copy this command and run it in a fresh terminal.</span>
            </div>
            {manualWorkingDirectory && (
              <div style={{ display: 'grid', gap: 3 }}>
                <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)' }}>working directory</span>
                <code style={{ display: 'block', userSelect: 'text', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--cb-font-mono)', fontSize: 11, color: 'var(--cb-text)' }}>{manualWorkingDirectory}</code>
              </div>
            )}
            <code style={{ display: 'block', userSelect: 'text', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--cb-font-mono)', fontSize: 11, color: 'var(--cb-text)' }}>{state.manualHandoff?.command}</code>
            <div>
              <Button variant="secondary" size="sm" icon="copy" onClick={() => { void copyManualCommand() }}>{copied ? 'Copied' : 'Copy command'}</Button>
            </div>
          </div>
        ) : hasRunnerlessLaunch ? (
          <div role="status" style={{ display: 'grid', gap: 10, border: '1px solid rgba(125,175,110,0.22)', background: 'var(--cb-success-muted)', color: 'var(--cb-text)', borderRadius: 'var(--cb-radius-md)', padding: 12, fontSize: 12.5, lineHeight: 1.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="check-circle" size={16} style={{ color: 'var(--cb-success)', flexShrink: 0 }} />
              <span>Runnerless launch started outside the daemon runner.</span>
            </div>
            <code style={{ display: 'block', userSelect: 'text', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--cb-font-mono)', fontSize: 11, color: 'var(--cb-text)' }}>{state.runnerlessLaunch.command}</code>
            {state.runnerlessLaunch.pid !== null && <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)', overflowWrap: 'anywhere' }}>pid {state.runnerlessLaunch.pid}</div>}
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
