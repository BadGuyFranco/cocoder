#!/usr/bin/env node
import path from "node:path";
import { startOzDaemon } from "./server.js";
import { resolveOzPort } from "./port.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let cocoderHome = process.env.COCODER_HOME ? path.resolve(process.env.COCODER_HOME) : process.cwd();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--cocoder-home" && args[index + 1]) {
      cocoderHome = path.resolve(args[index + 1]!);
      index += 1;
    }
  }

  const port = resolveOzPort({ env: process.env });
  const app = await startOzDaemon({ cocoderHome, port, env: process.env });
  process.stdout.write(`${JSON.stringify({ ok: true, host: "127.0.0.1", port, cocoderHome })}\n`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
