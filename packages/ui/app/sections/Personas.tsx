// Personas section — slice 0 placeholder; slice 5 builds the CLI+Model editor over the assignments map
// (the daemon returns personas:[] empty — the real data is the assignments object).
import { Pending } from '../components.tsx'

export function Personas({ wsId, wsName }: { wsId: string; wsName: string }): JSX.Element {
  return (
    <div className="section">
      <h2>Personas — {wsName}</h2>
      <Pending label={`Persona → CLI + Model editor (${wsId})`} note="Linked CLI/Model dropdowns, Oz in the list, sub-agent hierarchy + visible/headless. Arrives in slice 5." />
    </div>
  )
}
