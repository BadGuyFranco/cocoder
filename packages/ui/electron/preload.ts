// The narrow bridge. Exposes exactly the typed OzApi on window.oz via contextBridge — no ipcRenderer,
// no node, no tokens reach the renderer. Channel names come from the shared contract so a rename is a
// compile error here, in main, and in the renderer at once.
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type OzApi } from './ipc-contract.ts'

const api: OzApi = {
  health: () => ipcRenderer.invoke(CHANNELS.health),
  daemonGet: (path) => ipcRenderer.invoke(CHANNELS.daemonGet, path),
  daemonPost: (path, body) => ipcRenderer.invoke(CHANNELS.daemonPost, path, body),
  daemonPut: (path, body) => ipcRenderer.invoke(CHANNELS.daemonPut, path, body),
  chatSend: (ws, text) => ipcRenderer.invoke(CHANNELS.chatSend, ws, text),
  personasAssignmentsSave: (ws, assignments) => ipcRenderer.invoke(CHANNELS.personasAssignmentsSave, ws, assignments),
  prioritiesCreate: (ws, priority) => ipcRenderer.invoke(CHANNELS.prioritiesCreate, ws, priority),
  prioritiesReorder: (ws, order) => ipcRenderer.invoke(CHANNELS.prioritiesReorder, ws, order),
  prioritiesOrder: (ws) => ipcRenderer.invoke(CHANNELS.prioritiesOrder, ws),
  settingsGet: () => ipcRenderer.invoke(CHANNELS.settingsGet),
  settingsSet: (patch) => ipcRenderer.invoke(CHANNELS.settingsSet, patch),
}

contextBridge.exposeInMainWorld('oz', api)
