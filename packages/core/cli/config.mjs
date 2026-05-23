import path from 'node:path';
import { getConfigValue, resolveConfig, setInstallConfigValue, setWorkspaceConfigValue } from '../lib/config.mjs';
import { resolveInstallRoot } from '../lib/paths.mjs';
import { parseArgsAllowPositionals } from './shared.mjs';

export async function handleConfig(tokens) {
  const [subcommand, key, value, ...rest] = tokens;
  const args = parseArgsAllowPositionals(rest);
  const cocoderHome = args.cocoderHome
    ? path.resolve(args.cocoderHome)
    : await resolveInstallRoot(process.cwd());
  if (subcommand === 'get') {
    const revealSecrets = args.revealSecrets === 'true' || args.revealSecrets === true;
    const resolveOptions = {
      cocoderHome,
      workspaceRoot: args.workspaceRoot,
      resolveSecrets: revealSecrets
    };
    const result = key
      ? await getConfigValue(key, resolveOptions)
      : (await resolveConfig(resolveOptions)).config;
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (subcommand === 'set') {
    if (!key || value === undefined) {
      throw new Error('Usage: cocoder config set <key> <value> [--workspace-root <path>]');
    }
    if (args.workspaceRoot) {
      const result = await setWorkspaceConfigValue(key, value, {
        workspaceRoot: args.workspaceRoot
      });
      console.log(JSON.stringify({ ok: true, file: result.filePath, zone: result.zone }, null, 2));
      return;
    }
    const result = await setInstallConfigValue(key, value, { cocoderHome });
    console.log(JSON.stringify({ ok: true, file: result.filePath, zone: result.zone }, null, 2));
    return;
  }
  throw new Error('Usage: cocoder config get [key] [--workspace-root <path>] | config set <key> <value> [--workspace-root <path>]');
}
