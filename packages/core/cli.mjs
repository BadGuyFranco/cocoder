#!/usr/bin/env node
import { handleConfig } from './cli/config.mjs';
import { handleOz } from './cli/oz.mjs';
import { printHelp } from './cli/help.mjs';
import { dispatchCommand } from './cli/registry.mjs';
import { parseArgs } from './cli/shared.mjs';

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'config') {
    await handleConfig(rest);
    return;
  }
  if (command === 'oz') {
    await handleOz(rest);
    return;
  }
  const args = parseArgs(rest);

  if (!command || command === 'help' || command === '--help' || command === '-h' || args.help) {
    printHelp();
    return;
  }

  await dispatchCommand(command, args);
}
