// Quinn-owned IDE lifecycle.
//
// Spawns `pnpm dev` inside cocoder-ide with the env vars Quinn needs:
//   - COCODER_CDP_PORT: predictable CDP port (default 19222)
//   - VITE_AUTH_ENABLED:  forces BetterAuth (otherwise the renderer runs in
//                         dev-bypass and there is no SignInForm to drive)
//
// Two operating modes:
//   spawn(): start a fresh IDE, wait for CDP, return { cdpUrl, child, stop() }
//   attach(): assume IDE is already running; just resolve the CDP URL.
//
// Stop is best-effort: SIGTERM the wrapper, fall back to SIGKILL after a grace
// period. Electron child processes get cleaned up by the wrapper exit.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CDP_PORT = 19222;
const DEFAULT_READY_TIMEOUT_MS = 90000;
const POLL_INTERVAL_MS = 500;
const STOP_GRACE_MS = 4000;

export function quinnIdeCdpUrl(port = DEFAULT_CDP_PORT) {
  return `http://127.0.0.1:${port}/json/version`;
}

export async function attachToRunningIde({ port = DEFAULT_CDP_PORT, timeoutMs = 5000 } = {}) {
  const cdpUrl = quinnIdeCdpUrl(port);
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(cdpUrl);
      if (response.ok) {
        const meta = await response.json();
        return { cdpUrl, meta, ownsLifecycle: false };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Could not reach IDE CDP at ${cdpUrl} within ${timeoutMs}ms: ${lastError?.message ?? 'unknown'}`);
}

export async function spawnIde({
  ideDir,
  port = DEFAULT_CDP_PORT,
  authEnabled = true,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  logDir,
  extraEnv = {}
} = {}) {
  if (!ideDir) throw new Error('ideDir is required');
  if (!existsSync(path.join(ideDir, 'package.json'))) {
    throw new Error(`ideDir does not look like a Node package: ${ideDir}`);
  }
  if (logDir) await mkdir(logDir, { recursive: true });
  const logPath = logDir ? path.join(logDir, `ide-dev.${Date.now()}.log`) : null;
  const logFile = logPath ? await open(logPath, 'w') : null;

  const env = {
    ...process.env,
    COCODER_CDP_PORT: String(port),
    ...(authEnabled ? { VITE_AUTH_ENABLED: '1' } : {}),
    ...extraEnv
  };

  const child = spawn('pnpm', ['dev'], {
    cwd: ideDir,
    env,
    stdio: ['ignore', logFile ? logFile.fd : 'ignore', logFile ? logFile.fd : 'ignore'],
    detached: false
  });

  let exited = false;
  let exitInfo = null;
  child.on('exit', (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
  });

  const cdpUrl = quinnIdeCdpUrl(port);
  const readyDeadline = Date.now() + readyTimeoutMs;
  while (Date.now() < readyDeadline) {
    if (exited) {
      throw new Error(`IDE process exited before CDP came up (code=${exitInfo?.code}, signal=${exitInfo?.signal}). See log: ${logPath ?? '(no log dir)'}`);
    }
    try {
      const response = await fetch(cdpUrl);
      if (response.ok) {
        const meta = await response.json();
        return {
          cdpUrl,
          meta,
          child,
          logPath,
          ownsLifecycle: true,
          stop: () => stopIde(child)
        };
      }
    } catch { /* not ready yet */ }
    await sleep(POLL_INTERVAL_MS);
  }
  await stopIde(child);
  throw new Error(`IDE CDP did not become reachable at ${cdpUrl} within ${readyTimeoutMs}ms. See log: ${logPath ?? '(no log dir)'}`);
}

async function stopIde(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  const start = Date.now();
  while (Date.now() - start < STOP_GRACE_MS) {
    if (child.killed || child.exitCode !== null) return;
    await sleep(150);
  }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
