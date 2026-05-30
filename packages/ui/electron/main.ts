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
    // The smoke runs in either source: OZ_FIXTURES replay ('fixtures') or a real read-only launch
    // against the live daemon ('connected'). Both must round-trip health through the IPC bridge.
    if (!health || (health.state !== 'fixtures' && health.state !== 'connected')) throw new Error(`IPC health round-trip failed: ${JSON.stringify(health)}`)
    if (health.state === 'connected') await wait(1500) // let the live load settle before screenshots
    for (const label of SECTIONS) {
      try {
        await win.webContents.executeJavaScript(
          `(() => { const b=[...document.querySelectorAll('.oz-nav-item')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); if(b) b.click(); return !!b })()`,
        )
        await wait(400)
        const img = await win.webContents.capturePage()
        writeFileSync(join(dir, `${label.toLowerCase()}.png`), img.toPNG())
      } catch (e) {
        console.error(`SMOKE: screenshot ${label} failed — ${(e as Error).message}`)
      }
    }
    // Overlay-surface proof: the workspace-tab "+" dropdown and the New Workspace modal must each (a)
    // paint ON TOP of the content (elementFromPoint), and (b) be OPAQUE — computed backgroundColor must
    // be solid rgb(), not rgba() with alpha — so a glass/translucent surface that lets the blurred
    // dashboard bleed through fails the smoke loudly (exit 1).
    try {
      // Match by includes, not ===: the Dashboard nav item's text is "Dashboard2" (it carries a badge).
      await win.webContents.executeJavaScript(`(() => { const d=[...document.querySelectorAll('.oz-nav-item')].find(x=>(x.textContent||'').includes('Dashboard')); if(d) d.click(); return !!d })()`)
      await wait(500)
      await win.webContents.executeJavaScript(`(() => { const b=document.querySelector('.oz-ws-tab-add'); if(b) b.click(); return !!b })()`)
      await wait(500)
      const dd = await win.webContents.executeJavaScript(
        `(() => { const solid=(el)=>{const c=getComputedStyle(el).backgroundColor; return /^rgb\\(/.test(c)?c:null}; const n=[...document.querySelectorAll('span')].find(x=>(x.textContent||'').includes('New workspace')); if(!n) return {open:false}; let pop=n; let bg=null; while(pop && !(bg=solid(pop))) pop=pop.parentElement; if(!pop) return {open:true, opaque:false, bg:'(none found)'}; const r=pop.getBoundingClientRect(); const t=document.elementFromPoint(r.left+8,r.top+8); return {open:true, onTop: pop.contains(t)||t===pop, bg, opaque:true} })()`,
      )
      writeFileSync(join(dir, 'dropdown.png'), (await win.webContents.capturePage()).toPNG())
      console.log(`SMOKE: dropdown open=${dd.open} onTop=${dd.onTop} opaque=${dd.opaque} bg=${dd.bg}`)
      if (!dd.open) throw new Error('adder dropdown did not open')
      if (!dd.onTop || !dd.opaque) throw new Error(`dropdown not solid-on-top (onTop=${dd.onTop} opaque=${dd.opaque} bg=${dd.bg})`)
      await win.webContents.executeJavaScript(`(() => { const n=[...document.querySelectorAll('span')].find(x=>(x.textContent||'').includes('New workspace')); if(n) n.click(); return !!n })()`)
      await wait(500)
      const m = await win.webContents.executeJavaScript(
        `(() => { const solid=(el)=>{const c=getComputedStyle(el).backgroundColor; return /^rgb\\(/.test(c)?c:null}; const h=[...document.querySelectorAll('h2')].find(x=>x.textContent.trim()==='New workspace'); if(!h) return {open:false}; let card=h; let bg=null; while(card && !(bg=solid(card))) card=card.parentElement; if(!card) return {open:true, opaque:false, bg:'(none found)'}; const r=card.getBoundingClientRect(); const t=document.elementFromPoint(r.left+12,r.top+12); return {open:true, onTop: card.contains(t)||t===card, bg, opaque:true} })()`,
      )
      writeFileSync(join(dir, 'modal.png'), (await win.webContents.capturePage()).toPNG())
      console.log(`SMOKE: modal open=${m.open} onTop=${m.onTop} opaque=${m.opaque} bg=${m.bg}`)
      if (!m.open) throw new Error('New Workspace modal did not open')
      if (!m.onTop || !m.opaque) throw new Error(`modal not solid-on-top (onTop=${m.onTop} opaque=${m.opaque} bg=${m.bg})`)
    } catch (e) {
      code = 1
      console.error(`SMOKE: overlay check FAILED — ${(e as Error).message}`)
    }
    // Tweak captures: close the modal, then screenshot the collapsed sidebar (icon rail) on the
    // Dashboard. Verifies the collapse toggle actually narrows the shell.
    try {
      await win.webContents.executeJavaScript(`(() => { const x=[...document.querySelectorAll('button[aria-label="Close (Esc)"]')][0]; if(x) x.click(); return true })()`)
      await wait(300)
      // Resize proof: drag the Priorities divider +60px and assert the panel grows ~60px (1:1), not a
      // runaway multiple. Dispatch the drag, then measure AFTER a tick (React state flush + repaint).
      const before = await win.webContents.executeJavaScript(
        `(() => { const panel=document.querySelector('.oz-panel'); const h=document.querySelector('.oz-resize-handle'); if(!panel||!h) return null; const w=Math.round(panel.getBoundingClientRect().width); const hr=h.getBoundingClientRect(); const sx=hr.left+hr.width/2, sy=hr.top+hr.height/2; const mk=(t,x)=>new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:sy}); h.dispatchEvent(mk('mousedown',sx)); document.dispatchEvent(mk('mousemove',sx+60)); document.dispatchEvent(mk('mouseup',sx+60)); return w })()`,
      )
      await wait(250)
      const after = await win.webContents.executeJavaScript(`Math.round(document.querySelector('.oz-panel').getBoundingClientRect().width)`)
      const delta = after - before
      console.log(`SMOKE: resize before=${before} after=${after} delta=${delta} (expect ~60)`)
      if (before != null && Math.abs(delta - 60) > 12) throw new Error(`resize not 1:1 — moved 60px but panel changed ${delta}px`)
      await win.webContents.executeJavaScript(`(() => { const b=document.querySelector('.oz-collapse-btn'); if(b) b.click(); return !!b })()`)
      await wait(400)
      const sb = await win.webContents.executeJavaScript(`(() => { const s=document.querySelector('.oz-sidebar'); return { collapsed: s.classList.contains('collapsed'), width: Math.round(s.getBoundingClientRect().width) } })()`)
      writeFileSync(join(dir, 'sidebar-collapsed.png'), (await win.webContents.capturePage()).toPNG())
      console.log(`SMOKE: sidebar collapsed=${sb.collapsed} width=${sb.width}px`)
      // Light-mode overlay proof: flip to light theme, re-open the adder dropdown, assert it's still
      // opaque AND not a dark surface (the theme-aware --cb-surface-raised must flip to warm linen).
      await win.webContents.executeJavaScript(`document.documentElement.setAttribute('data-theme','light')`)
      await wait(200)
      await win.webContents.executeJavaScript(`(() => { if(document.querySelector('.oz-sidebar').classList.contains('collapsed')) document.querySelector('.oz-collapse-btn').click(); return true })()`)
      await wait(300)
      await win.webContents.executeJavaScript(`(() => { const b=document.querySelector('.oz-ws-tab-add'); if(b) b.click(); return !!b })()`)
      await wait(400)
      const lt = await win.webContents.executeJavaScript(
        `(() => { const solid=(el)=>{const c=getComputedStyle(el).backgroundColor; return /^rgb\\(/.test(c)?c:null}; const n=[...document.querySelectorAll('span')].find(x=>(x.textContent||'').includes('New workspace')); if(!n) return {open:false}; let pop=n; let bg=null; while(pop && !(bg=solid(pop))) pop=pop.parentElement; if(!pop) return {open:true, opaque:false}; const m=bg.match(/\\d+/g).map(Number); const light=(m[0]+m[1]+m[2])/3 > 150; return {open:true, opaque:true, bg, light} })()`,
      )
      writeFileSync(join(dir, 'dropdown-light.png'), (await win.webContents.capturePage()).toPNG())
      console.log(`SMOKE: light-dropdown open=${lt.open} opaque=${lt.opaque} light=${lt.light} bg=${lt.bg}`)
      if (lt.open && (!lt.opaque || !lt.light)) throw new Error(`light-mode dropdown wrong (opaque=${lt.opaque} light=${lt.light} bg=${lt.bg})`)
    } catch (e) {
      code = 1
      console.error(`SMOKE: tweak capture FAILED — ${(e as Error).message}`)
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
