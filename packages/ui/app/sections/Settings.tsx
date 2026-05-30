// Settings — human-friendly forms only, never raw JSON. These are REAL but CLIENT-ONLY local prefs
// (poll interval, default workspace), persisted via the window.oz.settingsSet seam (a main-process
// JSON store today). Daemon-backed settings + redaction are owed (ENDPOINTS OWED: GET/PUT /settings).
import type { Settings as S, Workspace } from '../../electron/ipc-contract.ts'
import { Pending } from '../components.tsx'

const POLL_OPTIONS = [
  { ms: 1000, label: '1s' },
  { ms: 2500, label: '2.5s' },
  { ms: 5000, label: '5s' },
  { ms: 10000, label: '10s' },
]

export function Settings({ settings, workspaces, onChange }: { settings: S; workspaces: Workspace[]; onChange: (patch: Partial<S>) => void }): JSX.Element {
  return (
    <div className="section">
      <h2>Settings</h2>
      <p className="muted">Local preferences — stored on this machine only.</p>

      <div className="settings-form">
        <label className="field">
          <span>Run polling interval</span>
          <select value={settings.pollIntervalMs} onChange={(e) => onChange({ pollIntervalMs: Number(e.target.value) })}>
            {POLL_OPTIONS.map((o) => (
              <option key={o.ms} value={o.ms}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Default workspace</span>
          <select value={settings.defaultWorkspaceId ?? ''} onChange={(e) => onChange({ defaultWorkspaceId: e.target.value || null })}>
            <option value="">None (first available)</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
      </div>

      <Pending label="Daemon-backed settings" note="Defaults shared with the daemon, plus the deferred secret-redaction control, need GET/PUT /settings. Everything above is client-only for now." />
    </div>
  )
}
