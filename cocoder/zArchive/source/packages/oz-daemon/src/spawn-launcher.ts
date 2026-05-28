import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export type SpawnCocoderArgvOptions = {
  cocoderBin: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: SpawnOptions["stdio"];
};

export function spawnCocoderArgv(options: SpawnCocoderArgvOptions): ChildProcess {
  return spawn(options.cocoderBin, options.args, {
    shell: false,
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"]
  });
}

export async function spawnCocoderArgvCaptured(options: SpawnCocoderArgvOptions): Promise<string[]> {
  const child = spawnCocoderArgv({ ...options, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`spawn exited ${exitCode}: ${stderr.trim() || stdout.trim()}`);
  }

  return JSON.parse(stdout.trim()) as string[];
}

export type LaunchCocoderSubprocessOptions = {
  cocoderBin: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
};

export type CocoderSubprocessResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** Spawn `cocoderBin` with argv array only — never shell-string interpolation (PC-Q4=A). */
export async function launchCocoderSubprocess(options: LaunchCocoderSubprocessOptions): Promise<string[]> {
  return spawnCocoderArgvCaptured({
    cocoderBin: options.cocoderBin,
    args: options.args,
    env: options.env
  });
}

/** Launch/stop helper: capture exit status without requiring JSON stdout (real cocoder CLI). */
export async function runCocoderSubprocess(options: LaunchCocoderSubprocessOptions): Promise<CocoderSubprocessResult> {
  const child = spawnCocoderArgv({ ...options, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";

  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });

  return {
    ok: exitCode === 0,
    exitCode,
    stdout,
    stderr
  };
}
