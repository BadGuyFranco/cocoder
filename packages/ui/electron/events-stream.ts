import { BrowserWindow } from 'electron'
import { CHANNELS, type OzEventHint } from './ipc-contract.ts'
import { daemonBaseUrl, ensureDaemonSession, resetDaemonSession } from './daemon-client.ts'
import { fixturesEnabled } from './fixtures.ts'

export type ParsedSseFrame = { readonly event: string; readonly data: unknown }

export function sanitizeOzEventHint(value: unknown): OzEventHint | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.type !== 'string' || typeof record.ts !== 'string') return null
  return {
    type: record.type,
    ts: record.ts,
    ...(typeof record.runId === 'string' ? { runId: record.runId } : {}),
    ...(typeof record.workspaceId === 'string' ? { workspaceId: record.workspaceId } : {}),
    ...(typeof record.status === 'string' ? { status: record.status } : {}),
    ...(typeof record.disposition === 'string' ? { disposition: record.disposition } : {}),
  }
}

export class SseParser {
  private buffer = ''
  private eventName = 'message'
  private dataLines: string[] = []

  constructor(private readonly onFrame: (frame: ParsedSseFrame) => void) {}

  push(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const raw = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      this.line(raw.endsWith('\r') ? raw.slice(0, -1) : raw)
      newline = this.buffer.indexOf('\n')
    }
  }

  private line(line: string): void {
    if (line === '') {
      this.dispatch()
      return
    }
    if (line.startsWith(':') || line.startsWith('retry:')) return
    if (line.startsWith('event:')) {
      this.eventName = line.slice('event:'.length).trim()
      return
    }
    if (line.startsWith('data:')) {
      const data = line.slice('data:'.length)
      this.dataLines.push(data.startsWith(' ') ? data.slice(1) : data)
    }
  }

  private dispatch(): void {
    if (this.dataLines.length === 0) {
      this.eventName = 'message'
      return
    }
    try {
      this.onFrame({ event: this.eventName, data: JSON.parse(this.dataLines.join('\n')) })
    } catch {
      /* a malformed daemon/event frame should not kill the stream */
    } finally {
      this.eventName = 'message'
      this.dataLines = []
    }
  }
}

type WindowSource = () => ReadonlyArray<{ readonly webContents: { send(channel: string, event: OzEventHint): void } }>

export interface OzEventStreamOptions {
  readonly fetchImpl?: typeof fetch
  readonly getWindows?: WindowSource
  readonly fixtures?: () => boolean
  readonly backoffMs?: number
  readonly setTimeoutFn?: typeof setTimeout
  readonly clearTimeoutFn?: typeof clearTimeout
}

export interface OzEventStreamHandle {
  stop(): void
}

function sendToWindows(event: OzEventHint, getWindows: WindowSource): void {
  for (const win of getWindows()) {
    try {
      win.webContents.send(CHANNELS.ozEvent, event)
    } catch {
      /* a closing window should not stop the stream */
    }
  }
}

export function startOzEventStream(opts: OzEventStreamOptions = {}): OzEventStreamHandle {
  const fixtures = opts.fixtures ?? fixturesEnabled
  if (fixtures()) return { stop() {} }

  const fetchImpl = opts.fetchImpl ?? fetch
  const getWindows = opts.getWindows ?? (() => BrowserWindow.getAllWindows())
  const backoffMs = opts.backoffMs ?? 5000
  const setTimer = opts.setTimeoutFn ?? setTimeout
  const clearTimer = opts.clearTimeoutFn ?? clearTimeout
  let stopped = false
  let retry: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null

  const schedule = (): void => {
    if (stopped) return
    retry = setTimer(connect, backoffMs)
  }

  const connect = (): void => {
    if (stopped || fixtures()) return
    controller = new AbortController()
    void (async () => {
      try {
        const session = await ensureDaemonSession()
        const res = await fetchImpl(`${daemonBaseUrl()}/oz/events`, {
          method: 'GET',
          headers: { authorization: `Bearer ${session.bearerToken}` },
          signal: controller?.signal,
        })
        if (res.status === 401 || res.status === 403) resetDaemonSession()
        if (!res.ok || !res.body) return
        const parser = new SseParser((frame) => {
          const event = sanitizeOzEventHint(frame.data)
          if (event) sendToWindows(event, getWindows)
        })
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        while (!stopped) {
          const chunk = await reader.read()
          if (chunk.done) break
          parser.push(decoder.decode(chunk.value, { stream: true }))
        }
        const tail = decoder.decode()
        if (tail) parser.push(tail)
      } catch {
        /* daemon offline / stream dropped: reconnect below */
      } finally {
        controller = null
        schedule()
      }
    })()
  }

  connect()
  return {
    stop() {
      stopped = true
      if (retry) clearTimer(retry)
      controller?.abort()
    },
  }
}
