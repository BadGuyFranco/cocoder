// Settings section — slice 0 placeholder; slice 7 builds client-only local prefs (poll interval,
// default workspace). Human-friendly forms only, never raw JSON. Daemon GET/PUT /settings is owed.
import { Pending } from '../components.tsx'

export function Settings(): JSX.Element {
  return (
    <div className="section">
      <h2>Settings</h2>
      <Pending label="Local preferences" note="Poll interval, default workspace, and more — forms/toggles only. Client-only today; GET/PUT /settings is owed for daemon-backed settings. Arrives in slice 7." />
    </div>
  )
}
