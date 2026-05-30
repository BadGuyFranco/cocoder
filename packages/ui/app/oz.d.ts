// window.oz is the only thing the sandboxed renderer can touch (set by preload via contextBridge).
import type { OzApi } from '../electron/ipc-contract.ts'

declare global {
  interface Window {
    readonly oz: OzApi
  }
}
export {}
