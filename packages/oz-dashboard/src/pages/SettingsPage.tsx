import { FormEvent, useEffect, useMemo, useState } from "react";
import { getSettings, putSetting } from "../api/workspaces.js";

function isSecretRef(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.includes("${env:") || value.startsWith("ref:env:");
}

export function SettingsPage() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [key, setKey] = useState("modelRoles.lead");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const configPreview = useMemo(() => {
    if (!config) return "";
    return JSON.stringify(config, null, 2);
  }, [config]);

  async function refresh() {
    setError(null);
    try {
      const response = await getSettings();
      setConfig(response.config);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    let parsed: unknown = value;
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed === "true" || trimmed === "false") {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = value;
      }
    } else if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = value;
      }
    }

    if (typeof parsed === "string" && isSecretRef(parsed)) {
      // C-S5: store secret refs verbatim; never resolve before PUT.
      parsed = value;
    }

    try {
      await putSetting(key.trim(), parsed);
      setMessage(`Saved ${key.trim()}.`);
      setValue("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section>
      <h1>Settings</h1>
      <p className="muted">Install-global config only (PC-Q8=A). Secret refs stay literal; Oz never resolves them on GET or PUT.</p>

      <div className="panel">
        <h2>Update key</h2>
        <form onSubmit={onSubmit}>
          <label htmlFor="settings-key">Config key (dot path)</label>
          <input id="settings-key" value={key} onChange={(event) => setKey(event.target.value)} required />
          <label htmlFor="settings-value">Value (string or JSON; use ${"${env:NAME}"} for secret refs)</label>
          <input id="settings-value" value={value} onChange={(event) => setValue(event.target.value)} required />
          <button type="submit">Save setting</button>
        </form>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="success">{message}</p> : null}

      <div className="panel">
        <h2>Current config (redacted refs from daemon)</h2>
        <textarea readOnly value={configPreview} aria-label="Current install config" />
      </div>
    </section>
  );
}
