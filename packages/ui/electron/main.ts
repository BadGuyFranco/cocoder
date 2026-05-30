// Electron MAIN: app lifecycle + the one secure window + the typed IPC handlers. The renderer is
// sandboxed (contextIsolation:true, sandbox:true, nodeIntegration:false) and can ONLY reach the daemon
// through these handlers, which attach auth in daemon-client.ts. No remote content is loaded.
import { app, BrowserWindow, ipcMain } from 'electron'
import { dirname, join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CHANNELS } from './ipc-contract.ts'
import { daemonGet, daemonPost, daemonPut, health } from './daemon-client.ts'
import { initStore, getSettings, setSettings, getPriorityOrder, setPriorityOrder } from './store.ts'
import { ozReply } from './chat.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

function registerIpc(): void {
  ipcMain.handle(CHANNELS.health, () => health())
  ipcMain.handle(CHANNELS.daemonGet, (_e, path: string) => daemonGet(path))
  ipcMain.handle(CHANNELS.daemonPost, (_e, path: string, body?: unknown) => daemonPost(path, body))
  ipcMain.handle(CHANNELS.daemonPut, (_e, path: string, body?: unknown) => daemonPut(path, body))
  ipcMain.handle(CHANNELS.chatSend, (_e, _ws: string, text: string) => ozReply(text, Date.now()))
  ipcMain.handle(CHANNELS.prioritiesReorder, (_e, ws: string, order: string[]) => setPriorityOrder(ws, order))
  ipcMain.handle(CHANNELS.prioritiesOrder, (_e, ws: string) => getPriorityOrder(ws))
  ipcMain.handle(CHANNELS.settingsGet, () => getSettings())
  ipcMain.handle(CHANNELS.settingsSet, (_e, patch) => setSettings(patch))
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Oz — CoCoder',
    backgroundColor: '#0b0d12',
    show: process.env.OZ_SMOKE !== '1',
    webPreferences: {
      preload: join(HERE, '../preload/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(HERE, '../renderer/index.html'))
  return win
}

// Headless evidence: launch, round-trip IPC health, screenshot every surface in fixture-replay, quit.
// Triggered only by OZ_SMOKE=1 — a normal launch is untouched.
const SECTIONS = ['Dashboard', 'Workspaces', 'CLIs', 'Personas', 'Settings']
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runSmoke(win: BrowserWindow): Promise<void> {
  const dir = join(HERE, '../screenshots')
  mkdirSync(dir, { recursive: true })
  // Hard watchdog: a smoke must never hang the process. Force-exit if it overruns.
  const watchdog = setTimeout(() => {
    console.error('SMOKE FAIL — watchdog timeout (40s)')
    app.exit(2)
  }, 40000)
  let code = 0
  try {
    if (win.webContents.isLoading()) {
      await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    }
    console.log('SMOKE: page loaded')
    win.show() // paint the window so capturePage has real pixels (and prove it launches visibly)
    console.log('SMOKE: bridge present =', await win.webContents.executeJavaScript('!!window.oz'))
    // wait for the preload bridge to be present, then round-trip IPC health through it
    const health = await win.webContents.executeJavaScript(
      `new Promise((resolve, reject) => { let n=0; const c = () => (window.oz ? resolve(window.oz.health()) : (++n>40 ? reject(new Error('window.oz never appeared — preload bridge failed to load')) : setTimeout(c, 50))); c() })`,
    )
    if (!health || health.state !== 'fixtures') throw new Error(`IPC health round-trip failed: ${JSON.stringify(health)}`)
    for (const label of SECTIONS) {
      try {
        await win.webContents.executeJavaScript(
          `(() => { const b=[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); if(b) b.click(); return !!b })()`,
        )
        await wait(400)
        const img = await win.webContents.capturePage()
        writeFileSync(join(dir, `${label.toLowerCase()}.png`), img.toPNG())
      } catch (e) {
        console.error(`SMOKE: screenshot ${label} failed — ${(e as Error).message}`)
      }
    }
    console.log(`SMOKE OK — health=${health.state}, screenshots in ${dir}`)
  } catch (e) {
    code = 1
    console.error(`SMOKE FAIL — ${(e as Error).message}`)
  } finally {
    clearTimeout(watchdog)
    app.exit(code)
  }
}

app.whenReady().then(() => {
  initStore(app.getPath('userData'))
  registerIpc()
  const win = createWindow()
  if (process.env.OZ_SMOKE === '1') void runSmoke(win)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
