export const DEFAULT_OZ_PORT = 7878;

export function resolveOzPort(options: {
  env?: NodeJS.ProcessEnv;
  configPort?: number;
} = {}): number {
  const envPort = options.env?.COCODER_OZ_PORT;
  if (envPort !== undefined && envPort !== "") {
    const parsed = Number(envPort);
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      throw new Error(`Invalid COCODER_OZ_PORT: ${envPort}`);
    }
    return parsed;
  }
  return options.configPort ?? DEFAULT_OZ_PORT;
}
