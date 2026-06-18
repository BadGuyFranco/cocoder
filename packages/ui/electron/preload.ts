// The narrow bridge. Exposes exactly the typed OzApi on window.oz via contextBridge — no ipcRenderer,
// no node, no tokens reach the renderer. Channel names come from the shared contract so a rename is a
// compile error here, in main, and in the renderer at once.
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type OzApi, type OzEventHint } from './ipc-contract.ts'

const api: OzApi = {
  health: () => ipcRenderer.invoke(CHANNELS.health),
  daemonGet: (path) => ipcRenderer.invoke(CHANNELS.daemonGet, path),
  daemonPost: (path, body) => ipcRenderer.invoke(CHANNELS.daemonPost, path, body),
  daemonPut: (path, body) => ipcRenderer.invoke(CHANNELS.daemonPut, path, body),
  daemonDelete: (path) => ipcRenderer.invoke(CHANNELS.daemonDelete, path),
  onOzEvent: (cb: (event: OzEventHint) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: OzEventHint) => cb(event)
    ipcRenderer.on(CHANNELS.ozEvent, listener)
    return () => ipcRenderer.off(CHANNELS.ozEvent, listener)
  },
  chatSend: (ws, text) => ipcRenderer.invoke(CHANNELS.chatSend, ws, text),
  personasAssignmentsSave: (ws, assignments) => ipcRenderer.invoke(CHANNELS.personasAssignmentsSave, ws, assignments),
  prioritiesCreate: (ws, priority) => ipcRenderer.invoke(CHANNELS.prioritiesCreate, ws, priority),
  ticketsCreate: (ws, ticket) => ipcRenderer.invoke(CHANNELS.ticketsCreate, ws, ticket),
  prioritiesReorder: (ws, order) => ipcRenderer.invoke(CHANNELS.prioritiesReorder, ws, order),
  ticketsReorder: (ws, order) => ipcRenderer.invoke(CHANNELS.ticketsReorder, ws, order),
  prioritiesOrder: (ws) => ipcRenderer.invoke(CHANNELS.prioritiesOrder, ws),
  workspacesUpdate: (ws, folders) => ipcRenderer.invoke(CHANNELS.workspacesUpdate, ws, folders),
  workspacesCreate: (ws, folders) => ipcRenderer.invoke(CHANNELS.workspacesCreate, ws, folders),
  workspacesDelete: (ws) => ipcRenderer.invoke(CHANNELS.workspacesDelete, ws),
  settingsGet: () => ipcRenderer.invoke(CHANNELS.settingsGet),
  settingsSet: (patch) => ipcRenderer.invoke(CHANNELS.settingsSet, patch),
}

contextBridge.exposeInMainWorld('oz', api)
