import type { Adapter } from '../adapter/index.js'
import type { Priority } from '../priorities/index.js'
import type { ResolvedPersona } from '../personas/index.js'
import type { Run, RunStore, Workspace } from '../store/index.js'
import type { SessionHost, SessionRef } from '../session-host/index.js'
import { join } from 'node:path'
import { buildObserverPrompt } from './prompts.js'

export async function spawnObserver(input: {
  readonly store: RunStore
  readonly sessionHost: SessionHost
  readonly getAdapter: (cli: string) => Adapter
  readonly run: Run
  readonly workspace: Workspace
  readonly priority: Priority
  readonly deb: ResolvedPersona
  readonly sharedStandards: string
  readonly runDir: string
  readonly groupLabel: string
}): Promise<SessionRef | null> {
  const { store, sessionHost, getAdapter, run, workspace, priority, deb, sharedStandards, runDir, groupLabel } = input
  try {
    const adapter = getAdapter(deb.cli)
    const pf = await adapter.preflight(deb.model)
    store.recordEvent({ runId: run.id, type: 'preflight', data: { persona: deb.id, cli: deb.cli, ok: pf.ok, checks: pf.checks } })
    if (!pf.ok) {
      const failed = pf.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ')
      store.recordEvent({ runId: run.id, type: 'deb-skipped', data: { reason: failed || 'preflight failed' } })
      return null
    }
    const cmd = adapter.build({
      prompt: buildObserverPrompt({
        sharedStandards,
        debBody: deb.body,
        priorityTitle: priority.title,
        priorityGoal: priority.goal,
        runId: run.id,
      }),
      model: deb.model,
      cwd: workspace.path,
      outPath: join(runDir, 'deb.out'),
    })
    const ref = await sessionHost.spawn({
      persona: deb.id,
      command: cmd.command,
      args: cmd.args,
      cwd: workspace.path,
      group: run.id,
      groupLabel,
      label: deb.label,
    })
    store.createSession({ runId: run.id, persona: deb.id, sessionRef: ref.id })
    store.recordEvent({ runId: run.id, type: 'spawn', data: { persona: deb.id, ref: ref.id } })
    return ref
  } catch (err) {
    store.recordEvent({ runId: run.id, type: 'deb-skipped', data: { reason: err instanceof Error ? err.message : String(err) } })
    return null
  }
}
