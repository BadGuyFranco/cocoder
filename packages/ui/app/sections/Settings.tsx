// Settings screen — tabbed (Appearance · System dependencies · Watching · Advanced · About). Human
// forms only, never raw JSON. System dependencies probes iTerm2/cmux (separate concern from CLI auth).
// Ported from design-ref/screens.jsx.
import { useState } from 'react'
import { Icon, Button, Card, ScreenHeader } from '../ui/primitives.tsx'
import type { Dependency, Settings } from '../model.ts'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: 38, height: 22, padding: 2, background: on ? 'var(--cb-accent)' : 'var(--cb-bg-soft)', border: `1px solid ${on ? 'var(--cb-accent)' : 'var(--cb-border)'}`, borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'background 120ms ease-out' }}>
      <span style={{ width: 16, height: 16, borderRadius: '50%', background: on ? 'var(--cb-text-on-accent)' : 'var(--cb-text-muted)', transform: on ? 'translateX(16px)' : 'translateX(0)', transition: 'transform 150ms ease-out' }} />
    </button>
  )
}

function SettingsRow({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--cb-border)' }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--cb-text)', fontWeight: 500, marginBottom: 3 }}>{label}</div>
        {help && <div style={{ fontSize: 11.5, color: 'var(--cb-text-muted)', lineHeight: 1.55, maxWidth: 540 }}>{help}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

export function DependenciesPanel({ dependencies, onRecheck }: { dependencies: Dependency[]; onRecheck?: (id: string) => void }) {
  const [checking, setChecking] = useState<string | null>(null)
  const missing = dependencies.filter((d) => d.status !== 'ok').length
  const handleRecheck = (id: string) => { setChecking(id); setTimeout(() => { onRecheck?.(id); setChecking(null) }, 900) }
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 16, background: missing > 0 ? 'var(--cb-highlight-muted)' : 'var(--cb-success-muted)', border: `1px solid ${missing > 0 ? 'rgba(212,118,110,0.20)' : 'rgba(125,175,110,0.20)'}`, borderRadius: 'var(--cb-radius-md)' }}>
        <Icon name={missing > 0 ? 'warning-circle' : 'check-circle'} size={16} style={{ color: missing > 0 ? 'var(--cb-highlight)' : 'var(--cb-success)' }} />
        <div style={{ flex: 1, fontSize: 12.5, color: missing > 0 ? 'var(--cb-highlight)' : 'var(--cb-success)', lineHeight: 1.5 }}>
          {missing > 0 ? `${missing} dependenc${missing === 1 ? 'y is' : 'ies are'} missing. CoCoder runs without them, but attach/orchestration won't work properly.` : 'All system dependencies installed.'}
        </div>
      </div>
      {dependencies.map((dep) => {
        const ok = dep.status === 'ok'
        return (
          <Card key={dep.id} style={{ marginBottom: 10 }}>
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ width: 40, height: 40, background: ok ? 'var(--cb-accent-muted)' : 'var(--cb-bg-soft)', border: `1px solid ${ok ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`, borderRadius: 'var(--cb-radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ok ? 'var(--cb-accent)' : 'var(--cb-text-muted)', flexShrink: 0 }}>
                <Icon name={dep.icon} size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, color: 'var(--cb-text)', fontWeight: 500 }}>{dep.name}</span>
                  <span className={`oz-chip oz-chip-${ok ? 'complete' : 'stopped'}`}>{ok ? `Installed v${dep.version}` : 'Not installed'}</span>
                  <span style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 10.5, color: 'var(--cb-text-muted)' }}>{dep.vendor} · checked {dep.lastChecked}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--cb-text-muted)', lineHeight: 1.55, marginBottom: ok ? 0 : 12 }}>{dep.purpose}</div>
                {!ok && (
                  <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 12, background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', padding: '10px 12px', borderRadius: 'var(--cb-radius-md)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--cb-accent)' }}>$</span><span style={{ flex: 1, color: 'var(--cb-text)' }}>{dep.installCmd}</span>
                    <button className="oz-iconbtn" style={{ width: 26, height: 26 }} title="Copy command"><Icon name="copy" size={12} /></button>
                  </div>
                )}
                {!ok && dep.note && <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: 'var(--cb-text-muted)', padding: '6px 2px', lineHeight: 1.55, marginTop: 8 }}><Icon name="info" size={11} style={{ marginTop: 2, flexShrink: 0 }} /><span>{dep.note}</span></div>}
              </div>
              <Button variant="ghost" size="sm" icon="arrow-clockwise" onClick={() => handleRecheck(dep.id)} disabled={checking === dep.id}>{checking === dep.id ? 'Checking…' : 'Re-check'}</Button>
            </div>
          </Card>
        )
      })}
    </>
  )
}

const TABS = [
  { id: 'preferences', label: 'Appearance', icon: 'palette' },
  { id: 'system', label: 'System dependencies', icon: 'hard-drives' },
  { id: 'watching', label: 'Watching & alerts', icon: 'bell' },
  { id: 'advanced', label: 'Advanced', icon: 'sliders' },
  { id: 'about', label: 'About', icon: 'info' },
]

export function SettingsScreen({ settings, dependencies, onRecheckDep, onChange }: { settings: Settings; dependencies: Dependency[]; onRecheckDep: (id: string) => void; onChange: (s: Settings) => void }) {
  const [tab, setTab] = useState('preferences')
  const update = <S extends keyof Settings>(section: S, key: keyof Settings[S], value: unknown) =>
    onChange({ ...settings, [section]: { ...settings[section], [key]: value } })

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <ScreenHeader title="Settings" subtitle="Global preferences. Everything here applies across workspaces unless overridden." />
      <div style={{ padding: '0 28px 24px', overflow: 'hidden', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, minHeight: 0 }}>
        <div className="oz-panel" style={{ minHeight: 0 }}>
          <div className="oz-panel-body" style={{ padding: 8 }}>
            {TABS.map((t) => (
              <div key={t.id} onClick={() => setTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: tab === t.id ? 'var(--cb-accent-muted)' : 'transparent', border: tab === t.id ? '1px solid var(--cb-accent-15)' : '1px solid transparent', borderRadius: 'var(--cb-radius-md)', cursor: 'pointer', fontSize: 12.5, color: tab === t.id ? 'var(--cb-accent)' : 'var(--cb-text-secondary)', marginBottom: 2 }}>
                <Icon name={t.icon} size={14} />{t.label}
              </div>
            ))}
          </div>
        </div>
        <div className="oz-panel" style={{ minHeight: 0 }}>
          <div className="oz-panel-body" style={{ padding: '0 24px 24px' }}>
            {tab === 'system' && (
              <>
                <div className="oz-section-marker lhs">System dependencies</div>
                <div style={{ fontSize: 12, color: 'var(--cb-text-muted)', lineHeight: 1.6, marginBottom: 16, maxWidth: 600 }}>System tools CoCoder needs on this machine. CLI auth lives on the <span style={{ color: 'var(--cb-accent)' }}>CLIs</span> screen.</div>
                <DependenciesPanel dependencies={dependencies} onRecheck={onRecheckDep} />
              </>
            )}
            {tab === 'preferences' && (
              <>
                <div className="oz-section-marker lhs">Appearance</div>
                <SettingsRow label="Theme" help="Dark is the default. Light flips to warm linen.">
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['dark', 'light'] as const).map((t) => <button key={t} onClick={() => update('preferences', 'theme', t)} style={{ padding: '7px 14px', fontSize: 12, background: settings.preferences.theme === t ? 'var(--cb-accent-muted)' : 'var(--cb-bg-soft)', color: settings.preferences.theme === t ? 'var(--cb-accent)' : 'var(--cb-text-muted)', border: `1px solid ${settings.preferences.theme === t ? 'var(--cb-accent-15)' : 'var(--cb-border)'}`, borderRadius: 'var(--cb-radius-md)', cursor: 'pointer', textTransform: 'capitalize' }}>{t}</button>)}
                  </div>
                </SettingsRow>
                <SettingsRow label="Compact density" help="Tightens spacing across the app."><Toggle on={settings.preferences.compactMode} onChange={(v) => update('preferences', 'compactMode', v)} /></SettingsRow>
                <SettingsRow label="Reduce motion" help="Disables non-essential animation."><Toggle on={settings.preferences.reduceMotion} onChange={(v) => update('preferences', 'reduceMotion', v)} /></SettingsRow>
                <SettingsRow label="Sound on Oz events" help="A subtle chime when a run completes or a decision lands."><Toggle on={settings.preferences.sound} onChange={(v) => update('preferences', 'sound', v)} /></SettingsRow>
                <SettingsRow label="Send on Enter" help="Off makes Enter newline; ⌘+Enter sends."><Toggle on={settings.preferences.sendOnEnter} onChange={(v) => update('preferences', 'sendOnEnter', v)} /></SettingsRow>
              </>
            )}
            {tab === 'watching' && (
              <>
                <div className="oz-section-marker lhs">Notifications</div>
                <SettingsRow label="Decision needed" help="Oz needs a human call on a run."><Toggle on={settings.watching.notifyOnDecisionNeeded} onChange={(v) => update('watching', 'notifyOnDecisionNeeded', v)} /></SettingsRow>
                <SettingsRow label="Run failed" help="A run halted with an error."><Toggle on={settings.watching.notifyOnRunFailed} onChange={(v) => update('watching', 'notifyOnRunFailed', v)} /></SettingsRow>
                <SettingsRow label="Run complete" help="A run finished without intervention. Off by default — they get noisy."><Toggle on={settings.watching.notifyOnRunComplete} onChange={(v) => update('watching', 'notifyOnRunComplete', v)} /></SettingsRow>
                <SettingsRow label="Desktop notifications" help="Show OS-level notifications."><Toggle on={settings.watching.desktopNotifications} onChange={(v) => update('watching', 'desktopNotifications', v)} /></SettingsRow>
                <SettingsRow label="Slack webhook" help="Mirror Oz alerts to a Slack channel."><input className="oz-input" style={{ width: 320, fontFamily: 'var(--cb-font-mono)', fontSize: 11 }} value={settings.watching.slackWebhook} onChange={(e) => update('watching', 'slackWebhook', e.target.value)} placeholder="https://hooks.slack.com/services/…" /></SettingsRow>
              </>
            )}
            {tab === 'advanced' && (
              <>
                <div className="oz-section-marker lhs">Advanced</div>
                <SettingsRow label="Transcript retention" help="Number of days Oz keeps run transcripts before pruning.">
                  <select className="oz-select" style={{ width: 120 }} value={settings.advanced.transcriptRetention} onChange={(e) => update('advanced', 'transcriptRetention', parseInt(e.target.value))}>
                    {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
                  </select>
                </SettingsRow>
                <SettingsRow label="Auto-attach Oz to new runs" help="Oz watches every run by default. Off if you want explicit watchers."><Toggle on={settings.advanced.autoAttach} onChange={(v) => update('advanced', 'autoAttach', v)} /></SettingsRow>
              </>
            )}
            {tab === 'about' && (
              <>
                <div className="oz-section-marker lhs">About</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 0' }}>
                  <div style={{ width: 56, height: 56, borderRadius: 'var(--cb-radius-md)', background: 'var(--cb-accent-muted)', border: '1px solid var(--cb-accent-15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cb-accent)' }}><Icon name="eye" size={28} /></div>
                  <div>
                    <div style={{ fontFamily: 'var(--cb-font-display)', fontSize: 18, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--cb-text)', fontWeight: 600 }}>Oz · CoCoder</div>
                    <div style={{ fontFamily: 'var(--cb-font-mono)', fontSize: 11, color: 'var(--cb-text-muted)', marginTop: 4 }}>version 0.7.2 · build a7e3d91 · macOS (Apple Silicon)</div>
                  </div>
                </div>
                <SettingsRow label="Check for updates"><Button variant="secondary" icon="arrow-clockwise" size="sm">Check now</Button></SettingsRow>
                <SettingsRow label="Diagnostics & logs"><Button variant="ghost" icon="file-text" size="sm">Open log</Button></SettingsRow>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
