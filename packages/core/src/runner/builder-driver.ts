import type { SessionHost, SessionRef } from '../session-host/index.js'

export interface BuilderDriver {
  readonly kind: 'pane' | 'headless'
  readonly refId: string
  dispatch(text: string): Promise<void>
  nudge(text: string): Promise<void>
  show(): Promise<void>
  alive(): Promise<boolean>
  readScreen(): Promise<string>
  kill(): Promise<void>
}

export function createPaneBuilderDriver(sessionHost: SessionHost, ref: SessionRef): BuilderDriver {
  return {
    kind: 'pane',
    refId: ref.id,
    dispatch: (text) => sessionHost.sendInput(ref, text),
    nudge: (text) => sessionHost.sendInput(ref, text),
    show: () => sessionHost.show(ref),
    alive: async () => (await sessionHost.status(ref)).state === 'running',
    readScreen: () => sessionHost.readScreen(ref),
    kill: () => sessionHost.kill(ref),
  }
}
