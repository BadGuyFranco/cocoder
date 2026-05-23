import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { workspacesRegistrySchema, type WorkspacesRegistry } from "schemas";

// @ts-expect-error Runtime import of extracted core .mjs module (ADR-0004 boundary).
import { loadRoots, resolvePathToken } from "../../core/lib/paths.mjs";

export function workspacesRegistryPath(cocoderHome: string): string {
  return path.join(cocoderHome, "local/workspaces.json");
}

const REGISTRY_PATH_TOKEN = /^(\$\{COCODER_HOME\}(?:\/[^$}]*)?|\$\{root:[A-Za-z0-9_-]+\}(?:\/[^$}]*)?|\/|~)/;

export function assertRegistryPathToken(pathValue: string): void {
  if (/\$\{env:/.test(pathValue)) {
    throw new Error(
      `Unsupported registry path token in "${pathValue}": env references are not allowed in workspace registry paths`
    );
  }
  if (!REGISTRY_PATH_TOKEN.test(pathValue)) {
    throw new Error(`Invalid workspace registry path token: ${pathValue}`);
  }
}

export async function readWorkspacesRegistry(cocoderHome: string): Promise<WorkspacesRegistry> {
  const filePath = workspacesRegistryPath(cocoderHome);
  try {
    const raw = await readFile(filePath, "utf8");
    return workspacesRegistrySchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { version: "0.1", workspaces: [] };
    }
    throw error;
  }
}

export async function writeWorkspacesRegistry(cocoderHome: string, registry: WorkspacesRegistry): Promise<string> {
  const parsed = workspacesRegistrySchema.parse(registry);
  const filePath = workspacesRegistryPath(cocoderHome);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return filePath;
}

export type ResolvedWorkspaceEntry = WorkspacesRegistry["workspaces"][number] & {
  resolvedPath: string;
};

export async function resolveWorkspaceEntry(
  entry: WorkspacesRegistry["workspaces"][number],
  options: { cocoderHome: string; roots?: Record<string, string> }
): Promise<ResolvedWorkspaceEntry> {
  assertRegistryPathToken(entry.path);
  const roots = options.roots ?? await loadRoots({ cocoderHome: options.cocoderHome });
  const resolvedPath = await resolvePathToken(entry.path, {
    cocoderHome: options.cocoderHome,
    roots
  });
  return { ...entry, resolvedPath };
}

export async function resolveWorkspaceRegistry(
  cocoderHome: string,
  options: { roots?: Record<string, string> } = {}
): Promise<ResolvedWorkspaceEntry[]> {
  const registry = await readWorkspacesRegistry(cocoderHome);
  const resolved: ResolvedWorkspaceEntry[] = [];
  for (const entry of registry.workspaces) {
    resolved.push(await resolveWorkspaceEntry(entry, { cocoderHome, roots: options.roots }));
  }
  return resolved;
}
