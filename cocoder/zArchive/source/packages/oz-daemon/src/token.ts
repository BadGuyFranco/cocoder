import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function ozTokenPath(cocoderHome: string): string {
  return path.join(cocoderHome, "local/secrets/oz-token");
}

export async function ensureOzToken(cocoderHome: string): Promise<string> {
  const tokenPath = ozTokenPath(cocoderHome);
  try {
    const existing = (await readFile(tokenPath, "utf8")).trim();
    if (existing) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }

  const secretsDir = path.dirname(tokenPath);
  await mkdir(secretsDir, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  await writeFile(tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tokenPath, 0o600);
  return token;
}
