import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { OzRunEvidenceSummary } from "schemas";
import { getRunEvidence } from "../api/runs.js";

export function RunInspectorPage() {
  const { runId = "" } = useParams();
  const [evidence, setEvidence] = useState<OzRunEvidenceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        setEvidence(await getRunEvidence(runId));
      } catch (cause) {
        setEvidence(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, [runId]);

  if (!runId) {
    return <p className="error">Run ID is required.</p>;
  }

  return (
    <section>
      <header className="page-header">
        <p className="muted">
          <Link to="/runs">Runs</Link> / {runId}
        </p>
        <h1>Run Inspector</h1>
      </header>

      {loading ? <p className="muted">Loading evidence…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {evidence ? (
        <>
          <dl className="kv-list">
            <div>
              <dt>Status</dt>
              <dd>{evidence.status ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{evidence.workspaceId}</dd>
            </div>
            <div>
              <dt>Collected</dt>
              <dd>{evidence.collectedAt}</dd>
            </div>
            <div>
              <dt>Socket</dt>
              <dd>{evidence.topology.socketName ?? "—"}</dd>
            </div>
            <div>
              <dt>Lane count</dt>
              <dd>{evidence.topology.laneCount}</dd>
            </div>
            <div>
              <dt>Issue count</dt>
              <dd>{evidence.flags.issueCount}</dd>
            </div>
            <div>
              <dt>Root check</dt>
              <dd>{evidence.flags.rootCheck.ok ? "ok" : "failed"}</dd>
            </div>
          </dl>

          <h2>Topology</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Lane</th>
                <th>Session</th>
                <th>Label</th>
              </tr>
            </thead>
            <tbody>
              {evidence.topology.lanes.map((lane) => (
                <tr key={lane.lane}>
                  <td>{lane.lane}</td>
                  <td>{lane.sessionName ?? "—"}</td>
                  <td>{lane.displayLabel ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Debugger flags</h2>
          <ul className="plain-list">
            <li>Status mismatches: {evidence.flags.statusMismatches.length}</li>
            <li>Blocked picker: {evidence.flags.blockedPicker.length}</li>
            <li>Unique roots: {evidence.flags.rootCheck.uniqueRoots.join(", ") || "—"}</li>
          </ul>
          {evidence.flags.statusMismatches.map((item, index) => (
            <p key={`mismatch-${index}`} className="muted">
              mismatch [{item.lane ?? "lane?"}]: {item.code} — {item.detail}
            </p>
          ))}
          {evidence.flags.blockedPicker.map((item, index) => (
            <p key={`picker-${index}`} className="muted">
              blocked picker [{item.lane ?? "lane?"}]: {item.detail}
            </p>
          ))}

          <h2>Evidence paths</h2>
          <ul className="plain-list">
            <li>Run dir: {evidence.evidencePaths.runDir}</li>
            <li>launch.json: {evidence.evidencePaths.launchJson}</li>
            <li>status.json: {evidence.evidencePaths.statusJson}</li>
            <li>startup-packet.json: {evidence.evidencePaths.startupPacketJson}</li>
            <li>jobs/: {evidence.evidencePaths.jobsDir}</li>
          </ul>
        </>
      ) : null}
    </section>
  );
}
