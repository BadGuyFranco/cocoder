// Oz dashboard — vanilla JS, no build step. Bootstraps a loopback token from /auth/session, then
// renders the four surfaces (workspaces · priorities+launch · persona→CLI/model editor · run
// list/detail+deep-link) by polling the daemon's JSON API. Pauses polling when the tab is hidden.
'use strict'

const CSRF_HEADER = 'x-oz-csrf-token'
let auth = null // { bearerToken, csrfToken }
const app = document.getElementById('app')
const ctxEl = document.getElementById('ctx')

async function bootstrap() {
  const res = await fetch('/auth/session')
  if (!res.ok) throw new Error('auth bootstrap failed')
  auth = await res.json()
  try {
    sessionStorage.setItem('oz-auth', JSON.stringify(auth))
  } catch {}
}

async function api(method, path, body, retried = false) {
  if (!auth) await bootstrap()
  const headers = { authorization: `Bearer ${auth.bearerToken}` }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    headers[CSRF_HEADER] = auth.csrfToken
  } else if (method !== 'GET') {
    headers[CSRF_HEADER] = auth.csrfToken
  }
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  if ((res.status === 401 || res.status === 403) && !retried) {
    auth = null
    await bootstrap()
    return api(method, path, body, true)
  }
  const json = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (!res.ok) throw new Error(json?.error || `${method} ${path} → ${res.status}`)
  return json
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const statusBadge = (s) => `<span class="status ${esc(s)}">${esc(s)}</span>`
const go = (hash) => { location.hash = hash }
function banner(msg) {
  const b = document.createElement('div')
  b.className = 'banner'
  b.textContent = msg
  app.prepend(b)
}

// --- Surface 1: workspaces ---
async function viewWorkspaces() {
  const { workspaces } = await api('GET', '/workspaces')
  ctxEl.textContent = `${workspaces.length} workspace(s)`
  app.innerHTML = `<h2>Workspaces</h2>${
    workspaces.length === 0 ? '<p class="muted">No workspaces in local/workspaces.json.</p>' : ''
  }${workspaces
    .map(
      (w) => `<div class="card row"><div class="grow"><strong>${esc(w.name)}</strong>
      <span class="muted mono">${esc(w.id)}</span><br><span class="muted mono">${esc(w.path)}</span></div>
      <button class="secondary" data-prio="${esc(w.id)}">Priorities</button>
      <button class="secondary" data-pers="${esc(w.id)}">Personas</button></div>`,
    )
    .join('')}`
  app.querySelectorAll('[data-prio]').forEach((b) => (b.onclick = () => go(`#/ws/${b.dataset.prio}/priorities`)))
  app.querySelectorAll('[data-pers]').forEach((b) => (b.onclick = () => go(`#/ws/${b.dataset.pers}/personas`)))
}

// --- Surface 2: priorities + launch ---
async function viewPriorities(wsId) {
  const { workspace, priorities } = await api('GET', `/workspaces/${encodeURIComponent(wsId)}/priorities`)
  ctxEl.textContent = workspace?.name || wsId
  app.innerHTML = `<h2>Priorities — ${esc(workspace?.name || wsId)}</h2>${
    priorities.length === 0 ? '<p class="muted">No priorities found.</p>' : ''
  }${priorities
    .map(
      (p) => `<div class="card row"><div class="grow"><strong>${esc(p.title)}</strong>
      <span class="muted mono">${esc(p.id)}</span></div>
      <button data-launch="${esc(p.id)}">Launch</button></div>`,
    )
    .join('')}`
  app.querySelectorAll('[data-launch]').forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true
        try {
          const r = await api('POST', '/runs', { workspaceId: wsId, priorityId: b.dataset.launch })
          if (!r || !r.runId) throw new Error('launch did not return a run id') // never navigate to #/run/null
          go(`#/run/${r.runId}`)
        } catch (e) {
          banner(e.message)
          b.disabled = false
        }
      }),
  )
}

// --- Surface 3: persona → CLI+model editor ---
async function viewPersonas(wsId) {
  const { workspace, personas } = await api('GET', `/workspaces/${encodeURIComponent(wsId)}/personas`)
  ctxEl.textContent = workspace?.name || wsId
  app.innerHTML = `<h2>Personas — ${esc(workspace?.name || wsId)}</h2>
    <p class="muted">Edits write the governance file <span class="mono">cocoder/personas/assignments.json</span>, not the database.</p>
    ${personas
      .map(
        (p) => `<div class="card row" data-id="${esc(p.id)}"><div class="grow"><strong>${esc(p.label)}</strong>
        <span class="muted mono">${esc(p.id)}</span> <span class="muted">— ${esc(p.role)}</span></div>
        <label class="muted">CLI <input class="cli" value="${esc(p.cli || '')}" size="8"></label>
        <label class="muted">model <input class="model" value="${esc(p.model || '')}" size="12"></label></div>`,
      )
      .join('')}
    <div class="row"><button id="save">Save assignments</button> <span id="saved" class="muted"></span></div>`
  document.getElementById('save').onclick = async () => {
    const personasOut = {}
    app.querySelectorAll('.card[data-id]').forEach((c) => {
      const cli = c.querySelector('.cli').value.trim()
      if (!cli) return // unassigned personas are omitted
      personasOut[c.dataset.id] = { cli, model: c.querySelector('.model').value.trim() }
    })
    try {
      await api('PUT', `/workspaces/${encodeURIComponent(wsId)}/personas/assignments`, { personas: personasOut })
      document.getElementById('saved').textContent = 'saved ✓'
    } catch (e) {
      banner(e.message)
    }
  }
}

// --- Surface 4: run list + detail ---
async function viewRuns() {
  const { runs } = await api('GET', '/runs')
  ctxEl.textContent = `${runs.length} run(s)`
  app.innerHTML = `<h2>Runs</h2>${runs.length === 0 ? '<p class="muted">No runs yet.</p>' : ''}${runs
    .map(
      (r) => `<div class="card row"><div class="grow"><a class="link" data-run="${esc(r.id)}">${esc(r.id)}</a>
      <span class="muted mono">${esc(r.workspaceId)} / ${esc(r.priorityId)}</span></div>${statusBadge(r.status)}</div>`,
    )
    .join('')}`
  app.querySelectorAll('[data-run]').forEach((a) => (a.onclick = () => go(`#/run/${a.dataset.run}`)))
}

async function viewRun(runId) {
  const d = await api('GET', `/runs/${encodeURIComponent(runId)}`)
  ctxEl.textContent = d.run.status
  const out = [d.files.oscarOut && `# oscar.out\n${d.files.oscarOut}`, d.files.bobOut && `# bob.out\n${d.files.bobOut}`]
    .filter(Boolean)
    .join('\n\n')
  app.innerHTML = `<h2>Run ${esc(runId)} ${statusBadge(d.run.status)}
      <button class="secondary" id="teardown" title="Terminate this run's personas and close their cmux panes (safe — never the daemon)">Teardown</button></h2>
    <p class="muted mono">${esc(d.run.workspaceId)} / ${esc(d.run.priorityId)}</p>
    <div class="card"><strong>Sessions</strong>${d.sessions
      .map(
        (s) => `<div class="row"><div class="grow">${esc(s.persona)} <span class="muted mono">${esc(s.sessionRef)}</span>
        exit ${s.exitCode ?? '—'}</div>${
          s.deepLinkable ? `<button class="secondary" data-show="${esc(runId)}">Open in cmux</button>` : '<span class="muted">not live</span>'
        }</div>`,
      )
      .join('')}</div>
    ${d.workItems
      .map((w) => `<div class="card"><strong>${esc(w.sourcePersona)} → ${esc(w.targetPersona)}</strong> [${esc(w.status)}]
      <div class="muted">scope: ${esc(w.writeScope.join(', ') || '(read-only)')}</div><div>${esc(w.task)}</div></div>`)
      .join('')}
    <div class="card"><strong>Commits</strong>${
      d.commitLinks.length === 0 ? '<div class="muted">none committed</div>' : ''
    }${d.commitLinks.map((c) => `<div class="mono">${esc(c.commitSha)} — ${esc(c.message)}</div>`).join('')}</div>
    ${d.diffs.length ? `<div class="card"><strong>Diff</strong><pre>${esc(d.diffs.map((x) => x.diff).join('\n'))}</pre></div>` : ''}
    ${out ? `<div class="card"><strong>Output</strong><pre>${esc(out)}</pre></div>` : ''}
    ${d.files.record ? `<div class="card"><strong>Run record</strong><pre>${esc(d.files.record)}</pre></div>` : ''}
    <a class="link" href="#/runs">← all runs</a>`
  app.querySelectorAll('[data-show]').forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api('POST', `/runs/${encodeURIComponent(b.dataset.show)}/show`)
        } catch (e) {
          banner(e.message)
        }
      }),
  )
  const td = document.getElementById('teardown')
  if (td)
    td.onclick = async () => {
      td.disabled = true
      try {
        const r = await api('POST', `/runs/${encodeURIComponent(runId)}/teardown`)
        td.textContent = `closed ${r.closed.length} pane(s)`
      } catch (e) {
        banner(e.message)
        td.disabled = false
      }
    }
}

// --- router + polling ---
function parse() {
  const seg = (location.hash.replace(/^#\/?/, '') || 'workspaces').split('/')
  if (seg[0] === 'ws' && seg[2] === 'priorities') return { view: 'priorities', arg: decodeURIComponent(seg[1]) }
  if (seg[0] === 'ws' && seg[2] === 'personas') return { view: 'personas', arg: decodeURIComponent(seg[1]) }
  if (seg[0] === 'run' && seg[1]) return { view: 'run', arg: decodeURIComponent(seg[1]) }
  if (seg[0] === 'runs') return { view: 'runs' }
  return { view: 'workspaces' }
}

const VIEWS = { workspaces: viewWorkspaces, priorities: viewPriorities, personas: viewPersonas, runs: viewRuns, run: viewRun }
let current = null

async function render() {
  current = parse()
  try {
    await VIEWS[current.view](current.arg)
  } catch (e) {
    app.innerHTML = `<h2>Oz</h2>`
    banner(e.message)
  }
}

// Poll only the live surfaces (runs list + run detail), and only when the tab is visible.
setInterval(() => {
  if (document.hidden || !current) return
  if (current.view === 'runs' || current.view === 'run') render()
}, 2500)

// --- Restart-daemon button (global) ---
// Starts the full Electron dashboard from the daemon. The daemon can only confirm the detached
// process started; it cannot prove the window appeared.
const launchDashboardBtn = document.getElementById('launch-dashboard')
if (launchDashboardBtn)
  launchDashboardBtn.onclick = async () => {
    launchDashboardBtn.disabled = true
    launchDashboardBtn.textContent = 'launching…'
    try {
      const r = await api('POST', '/oz/dashboard/launch')
      banner(`Oz dashboard launching (${r.mode}): ${r.command}`)
      launchDashboardBtn.textContent = 'Launch Oz dashboard'
    } catch (e) {
      banner(e.message)
      launchDashboardBtn.textContent = 'Launch Oz dashboard'
    } finally {
      launchDashboardBtn.disabled = false
    }
  }

// Triggers a daemon-side restart onto current code; the daemon refuses (409) while a run is in flight.
// On success the daemon bounces, so we poll /health until it answers again, then reload.
const restartBtn = document.getElementById('restart-daemon')
if (restartBtn)
  restartBtn.onclick = async () => {
    if (!confirm('Restart the Oz daemon onto current code? (Refused if a run is in flight.)')) return
    restartBtn.disabled = true
    restartBtn.textContent = 'restarting…'
    try {
      await api('POST', '/daemon/restart')
    } catch (e) {
      banner(e.message) // e.g. 409 — a run is in flight
      restartBtn.disabled = false
      restartBtn.textContent = 'Restart daemon'
      return
    }
    // Daemon is going down; wait for the fresh one to answer /health, then reload to re-bootstrap auth.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500))
      try {
        if ((await fetch('/health')).ok) return location.reload()
      } catch {}
    }
    banner('Daemon did not come back up — check local/oz.log')
    restartBtn.disabled = false
    restartBtn.textContent = 'Restart daemon'
  }

window.addEventListener('hashchange', render)
bootstrap()
  .then(render)
  .catch((e) => {
    app.innerHTML = ''
    banner(`Could not reach the Oz daemon: ${e.message}`)
  })
