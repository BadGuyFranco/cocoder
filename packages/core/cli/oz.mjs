import { constants } from 'node:fs';
import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolveInstallRoot } from '../lib/paths.mjs';
import { parseArgsAllowPositionals } from './shared.mjs';

const require = createRequire(import.meta.url);

function ozPidPath(cocoderHome) {
  return path.join(cocoderHome, 'local/oz-daemon.pid');
}

function resolveOzDaemonCli() {
  const packageRoot = path.dirname(require.resolve('oz-daemon/package.json'));
  return path.join(packageRoot, 'dist/cli.js');
}

async function readPid(cocoderHome) {
  const pidPath = ozPidPath(cocoderHome);
  try {
    const raw = (await readFile(pidPath, 'utf8')).trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`Invalid Oz daemon pid file at ${pidPath}`);
    }
    return { pid, pidPath };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

export async function handleOzStart(args) {
  const cocoderHome = args.cocoderHome
    ? path.resolve(args.cocoderHome)
    : await resolveInstallRoot(process.cwd());
  const existing = await readPid(cocoderHome);
  if (existing && await isProcessAlive(existing.pid)) {
    throw new Error(`Oz daemon already running (pid ${existing.pid})`);
  }
  if (existing) {
    await unlink(existing.pidPath).catch(() => {});
  }

  const cliPath = resolveOzDaemonCli();
  await access(cliPath, constants.R_OK);
  const child = spawn(process.execPath, [cliPath, '--cocoder-home', cocoderHome], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      COCODER_HOME: cocoderHome
    }
  });
  child.unref();
  await writeFile(ozPidPath(cocoderHome), `${child.pid}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, pid: child.pid, cocoderHome }, null, 2));
}

export async function handleOzStop(args) {
  const cocoderHome = args.cocoderHome
    ? path.resolve(args.cocoderHome)
    : await resolveInstallRoot(process.cwd());
  const existing = await readPid(cocoderHome);
  if (!existing) {
    console.log(JSON.stringify({ ok: true, running: false, cocoderHome }, null, 2));
    return;
  }
  if (await isProcessAlive(existing.pid)) {
    process.kill(existing.pid, 'SIGTERM');
  }
  await unlink(existing.pidPath).catch(() => {});
  console.log(JSON.stringify({ ok: true, running: false, stoppedPid: existing.pid, cocoderHome }, null, 2));
}

export async function handleOzStatus(args) {
  const cocoderHome = args.cocoderHome
    ? path.resolve(args.cocoderHome)
    : await resolveInstallRoot(process.cwd());
  const existing = await readPid(cocoderHome);
  const running = existing ? await isProcessAlive(existing.pid) : false;
  if (existing && !running) {
    await unlink(existing.pidPath).catch(() => {});
  }
  console.log(JSON.stringify({
    ok: true,
    running,
    pid: running ? existing.pid : null,
    cocoderHome
  }, null, 2));
}

const ozSubcommandHandlers = new Map([
  ['start', handleOzStart],
  ['stop', handleOzStop],
  ['status', handleOzStatus]
]);

export { ozSubcommandHandlers };

export async function handleOz(tokens) {
  const [subcommand, ...rest] = tokens;
  if (!subcommand) {
    throw new Error('Usage: cocoder oz start|stop|status [--cocoder-home PATH]');
  }
  const handler = ozSubcommandHandlers.get(subcommand);
  if (!handler) {
    throw new Error(`Unknown oz subcommand: ${subcommand}`);
  }
  await handler(parseArgsAllowPositionals(rest));
}
