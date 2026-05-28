#!/usr/bin/env node
// Quinn case runner.
//
// Usage:
//   node packages/core/quinn/run-case.mjs \
//     --case <case-id-or-path> \
//     --output <dir> \
//     [--credentials <path>] \
//     [--cdp-url http://127.0.0.1:19222/json/version] \
//     [--ide-dir cocoder-ide] \
//     [--no-spawn]
//
// Behaviour:
//   * If --cdp-url is provided AND --no-spawn is set, attach to that CDP.
//   * Otherwise spawn a fresh IDE via packages/core/quinn/launch-ide.mjs
//     with VITE_AUTH_ENABLED=1 and COCODER_CDP_PORT=19222.
//   * Load the case module, invoke run(driver, ctx), capture evidence.
//   * Write run-result.json + actions.json + console.json in the output dir.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadCredentials } from './credentials.mjs';
import { attachToRunningIde, spawnIde, quinnIdeCdpUrl } from './launch-ide.mjs';
import { QuinnDriver } from './driver.mjs';

const DEFAULT_IDE_DIR = 'cocoder-ide';
const DEFAULT_CDP_PORT = 19222;
const BUILTIN_CASES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'cases');

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { ok: true, helpShown: true };
  }
  if (!args.case) throw new Error('Missing required --case <id-or-path>');
  if (!args.output) throw new Error('Missing required --output <dir>');

  await mkdir(args.output, { recursive: true });

  const casePath = resolveCasePath(args.case);
  const caseModule = await import(pathToFileURL(casePath).href);
  if (typeof caseModule.run !== 'function') {
    throw new Error(`Case at ${casePath} must export an async function 'run(driver, ctx)'`);
  }

  const credentialsRequired = caseModule.meta?.requires?.includes('staging-credentials')
    || caseModule.meta?.requires?.includes('credentials');
  const credentials = (args.credentials || credentialsRequired)
    ? await loadCredentials(args.credentials)
    : null;

  const ideStartedAt = Date.now();
  const ideLifecycle = await resolveIde(args);
  const cdpHttpUrl = ideLifecycle.cdpUrl;
  const driver = new QuinnDriver({
    cdpHttpUrl,
    evidenceDir: args.output,
    redactedSecrets: []
  });

  const result = {
    case: caseModule.meta?.id ?? path.basename(casePath, '.mjs'),
    caseFile: casePath,
    startedAt: new Date(ideStartedAt).toISOString(),
    cdpHttpUrl,
    ideOwnsLifecycle: ideLifecycle.ownsLifecycle,
    ideLogPath: ideLifecycle.logPath ?? null,
    status: 'running'
  };

  try {
    await driver.attach();
    const ctx = {
      output: args.output,
      credentials,
      args,
      logger: (message, extra) => console.log(`[quinn] ${message}`, extra ?? '')
    };
    const caseResult = await caseModule.run(driver, ctx);
    result.caseResult = caseResult ?? null;
    result.status = caseResult?.status ?? 'PASS';
  } catch (error) {
    result.status = 'FAILED';
    result.error = { message: driver.redactString(error?.message ?? String(error)), stack: driver.redactString(error?.stack ?? '') };
    try { await driver.captureScreenshot('error-final.png'); } catch { /* best effort */ }
    try { await driver.captureDom('error-final.json'); } catch { /* best effort */ }
  } finally {
    result.finishedAt = new Date().toISOString();
    result.driverSummary = driver.exportRunSummary();
    result.console = driver.redactObject(driver.consoleEntries);
    try { await driver.detach(); } catch { /* already closed */ }
    if (ideLifecycle.ownsLifecycle && typeof ideLifecycle.stop === 'function') {
      try { await ideLifecycle.stop(); } catch { /* best effort */ }
    }
    await writeFile(path.join(args.output, 'run-result.json'), JSON.stringify(driver.redactObject(result), null, 2));
    await writeFile(path.join(args.output, 'actions.json'), JSON.stringify(driver.redactObject(driver.actionsLog), null, 2));
    await writeFile(path.join(args.output, 'console.json'), JSON.stringify(driver.redactObject(driver.consoleEntries), null, 2));
  }
  return result;
}

async function resolveIde(args) {
  if (args.cdpUrl && args.noSpawn) {
    return attachToRunningIde({ port: portFromCdpUrl(args.cdpUrl) ?? DEFAULT_CDP_PORT });
  }
  if (args.cdpUrl && !args.noSpawn) {
    try { return await attachToRunningIde({ port: portFromCdpUrl(args.cdpUrl) ?? DEFAULT_CDP_PORT }); }
    catch { /* fall through to spawn */ }
  }
  const ideDir = path.resolve(args.ideDir ?? DEFAULT_IDE_DIR);
  return spawnIde({
    ideDir,
    port: args.port ?? DEFAULT_CDP_PORT,
    authEnabled: args.authEnabled !== false,
    logDir: args.output
  });
}

function portFromCdpUrl(url) {
  try { return Number(new URL(url).port) || null; } catch { return null; }
}

function resolveCasePath(value) {
  if (value.endsWith('.mjs') && existsSync(value)) return path.resolve(value);
  const candidate = path.join(BUILTIN_CASES_DIR, `${value}.mjs`);
  if (existsSync(candidate)) return candidate;
  if (existsSync(value)) return path.resolve(value);
  throw new Error(`Case not found: '${value}'. Looked at ${candidate} and current dir.`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case '--case': args.case = next; i++; break;
      case '--output': args.output = next; i++; break;
      case '--credentials': args.credentials = next; i++; break;
      case '--cdp-url': args.cdpUrl = next; i++; break;
      case '--ide-dir': args.ideDir = next; i++; break;
      case '--port': args.port = Number(next); i++; break;
      case '--no-spawn': args.noSpawn = true; break;
      case '--no-auth': args.authEnabled = false; break;
      case '--help':
      case '-h': args.help = true; break;
      default:
        if (flag.startsWith('--')) throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(`Quinn case runner

Usage:
  node cocoder/core/quinn/run-case.mjs --case <id-or-path> --output <dir> [opts]

Required:
  --case      Case id (resolved from core/quinn/cases/) or absolute .mjs path.
  --output    Directory for evidence artifacts.

Options:
  --credentials <path>   Override credentials file path.
  --cdp-url <url>        Attach to an already-running IDE instead of spawning.
  --no-spawn             Refuse to spawn an IDE; fail if --cdp-url unavailable.
  --ide-dir <dir>        Override IDE working dir (default: cocoder-ide).
  --port <n>             CDP port for spawned IDE (default 19222).
  --no-auth              Spawn IDE without VITE_AUTH_ENABLED (dev bypass mode).
\n`);
}

const isCli = (() => {
  if (!process.argv[1]) return false;
  try { return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();

// Exit code contract (matches the status taxonomy documented in README.md):
//   PASS           -> 0
//   FAILED         -> 1
//   NEEDS_FOUNDER  -> 2  (case ran but requires human attention; NOT a silent pass)
//   internal error -> 2
//   unknown status -> 2
if (isCli) {
  main().then(
    (res) => {
      const status = res?.status;
      if (status === 'PASS') process.exit(0);
      if (status === 'FAILED') process.exit(1);
      if (status === 'NEEDS_FOUNDER') process.exit(2);
      process.stderr.write(`[quinn] unrecognized final status: ${JSON.stringify(status)} — treating as needs review\n`);
      process.exit(2);
    },
    (err) => {
      process.stderr.write(`[quinn] ${err?.message ?? err}\n${err?.stack ?? ''}\n`);
      process.exit(2);
    }
  );
}
