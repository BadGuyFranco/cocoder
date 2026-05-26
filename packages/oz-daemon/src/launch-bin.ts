import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolve the `cocoder` CLI bin the daemon spawns for `launch` / `stop-run`.
 * Order: explicit COCODER_LAUNCH_BIN override, then the monorepo-relative bin
 * under cocoderHome (the dogfood / source-checkout layout). Returns undefined
 * if neither exists — the daemon then stays in stub mode (records audit rows,
 * spawns nothing) rather than failing every launch.
 *
 * Extracted from the daemon entrypoint so it is unit-testable without starting
 * the server. Regression guard: before 2026-05-26 the entrypoint never passed a
 * launch executable, so every dashboard launch was a silent stub.
 */
export function resolveLaunchBin(
  cocoderHome: string,
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (p: string) => boolean = existsSync
): string | undefined {
  const override = env.COCODER_LAUNCH_BIN;
  if (override && fileExists(override)) return override;
  const candidate = path.join(cocoderHome, "packages/cocoder-cli/bin/cocoder");
  return fileExists(candidate) ? candidate : undefined;
}
