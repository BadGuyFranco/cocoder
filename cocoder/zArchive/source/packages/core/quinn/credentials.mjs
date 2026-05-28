// Quinn credentials loader.
//
// Looks up email/password by (environment, email). Credentials live in an
// untracked JSON file. Default location is
//   cocoder/local/.quinn-credentials.json
// which sits in the workspace-private zone (`cocoder/local/` is gitignored
// except for its own `.gitignore` + `README.md`, so the credentials file is
// hidden from git without any additional rule). An explicit `--credentials`
// path can override. A tracked example template ships at
// `cocoder/.quinn-credentials.example.json` so adopters can copy + fill.
//
// File schema:
// {
//   "staging": {
//     "jake.owner@wingmaservides.us": { "password": "..." }
//   },
//   "production": { ... }
// }
//
// The loader never logs passwords. The returned object exposes a redact()
// helper so callers can stringify their state without leaking secrets.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

// M4.7 (audit §H12) — single canonical path. Previously the constant said
// `cocoder/orchestration/.quinn-credentials.json` while the comment + README
// pointed at `cocoder/.quinn-credentials.json` (neither path was gitignored
// for credentials). The path now lives in the workspace-private zone, which
// the inner `cocoder/local/.gitignore` keeps out of git automatically.
export const DEFAULT_CREDENTIALS_PATH = path.join(
  'cocoder', 'local', '.quinn-credentials.json'
);

export class CredentialsStore {
  constructor(rawByEnv, sourcePath) {
    this.rawByEnv = rawByEnv;
    this.sourcePath = sourcePath;
  }

  lookup(environment, email) {
    const envBlock = this.rawByEnv?.[environment];
    if (!envBlock) {
      throw new Error(`No credentials configured for environment '${environment}' in ${this.sourcePath}`);
    }
    const cred = envBlock[email];
    if (!cred || typeof cred.password !== 'string' || cred.password.length === 0) {
      throw new Error(`No credentials for ${email} in environment '${environment}' (file: ${this.sourcePath})`);
    }
    return { email, password: cred.password, environment };
  }

  listEmails(environment) {
    return Object.keys(this.rawByEnv?.[environment] ?? {});
  }

  redact() {
    const out = {};
    for (const [env, users] of Object.entries(this.rawByEnv ?? {})) {
      out[env] = {};
      for (const email of Object.keys(users)) out[env][email] = { password: '[REDACTED]' };
    }
    return out;
  }
}

export async function loadCredentials(credentialsPath) {
  const resolved = credentialsPath
    ? path.resolve(credentialsPath)
    : path.resolve(DEFAULT_CREDENTIALS_PATH);
  let raw;
  try {
    raw = await readFile(resolved, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Quinn credentials file not found at ${resolved}. ` +
        `Create it (gitignored) with the schema documented in core/quinn/README.md, ` +
        `or pass --credentials <path>.`
      );
    }
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Quinn credentials file at ${resolved} is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Quinn credentials file at ${resolved} must contain a JSON object keyed by environment.`);
  }
  return new CredentialsStore(parsed, resolved);
}

// Sentinel for tests / in-memory use cases.
export function inMemoryCredentials(rawByEnv) {
  return new CredentialsStore(rawByEnv, '<in-memory>');
}
