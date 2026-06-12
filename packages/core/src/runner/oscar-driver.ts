import type { SessionHost, SessionRef } from '../session-host/index.js'

export interface OscarDriver {
  send(text: string): Promise<void>
  show(): Promise<void>
  alive(): Promise<boolean>
  readScreen(): Promise<string>
}

export function createPaneOscarDriver(sessionHost: SessionHost, ref: SessionRef): OscarDriver {
  return {
    send: (text) => sessionHost.sendInput(ref, text),
    show: () => sessionHost.show(ref),
    alive: async () => (await sessionHost.status(ref)).state === 'running',
    readScreen: () => sessionHost.readScreen(ref),
  }
}
