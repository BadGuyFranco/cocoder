// CLIs section — stub for full IA fidelity. No daemon endpoints yet (see ENDPOINTS OWED: GET /clis,
// POST /clis/:id/test, POST /clis). Rendered as a clearly-marked pending surface, never a broken form.
import { Pending } from '../components.tsx'

export function CLIs(): JSX.Element {
  return (
    <div className="section">
      <h2>CLIs</h2>
      <Pending
        label="CLI registry + per-CLI Test"
        note="List the coding-agent CLIs (Claude Code, Codex, Cursor-agent, …) with install + auth status, an add form, and a Test button returning Success or the exact error. Needs GET /clis, POST /clis/:id/test, POST /clis."
      />
    </div>
  )
}
