// CLIs section — stub for full IA fidelity. No daemon endpoints yet (ENDPOINTS OWED: GET /clis,
// POST /clis/:id/test, POST /clis). Rendered as a clearly-disabled preview of the real shape — a list
// with install/auth status + a per-CLI Test, and an add form — never a broken/live control.
import { Card, Pending } from '../components.tsx'

const PREVIEW = ['claude', 'codex', 'cursor-agent', 'grok', 'gemini']

export function CLIs(): JSX.Element {
  return (
    <div className="section">
      <h2>CLIs</h2>
      <p className="muted">Coding-agent CLIs personas run on. This is a disabled preview until the endpoints land.</p>
      <div className="list">
        {PREVIEW.map((id) => (
          <Card key={id} title={<>{id} <span className="chip">status unknown</span></>}>
            <div className="cli-row">
              <span className="muted">Install + auth status will show here.</span>
              <button className="btn btn-ghost" disabled title="needs POST /clis/:id/test">Test</button>
            </div>
          </Card>
        ))}
      </div>
      <Pending
        label="Add a CLI + per-CLI Test"
        note="Register a CLI and run a check that returns Success or the exact error (not installed / not authenticated). Needs GET /clis, POST /clis/:id/test, POST /clis."
      />
    </div>
  )
}
