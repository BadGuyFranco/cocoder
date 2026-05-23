import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { getRunState, observeWorkspaceMultiplexer } from "./multiplexer-observer.js";
import { resolveWorkspaceRegistry, type ResolvedWorkspaceEntry } from "./registry.js";

const require = createRequire(import.meta.url);
const { workspaceRunsRoot } = require("../../core/lib/paths.mjs") as {
  workspaceRunsRoot: (opts: { cocoderHome: string; workspaceSlug: string }) => string;
};

export type RunListEntry = {
  runId: string;
  workspaceId: string;
  runDir: string;
  status: string | null;
  prioritySlug: string | null;
  profile: string | null;
  route: string | null;
  tmuxSocket: string;
  laneCount: number;
  sessionsAttached: number;
};

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function listRunsForWorkspace(
  cocoderHome: string,
  workspace: ResolvedWorkspaceEntry
): Promise<RunListEntry[]> {
  const runsDir = workspaceRunsRoot({ cocoderHome, workspaceSlug: workspace.id });
  const tmuxSocket = workspace.tmuxSocket ?? "cocoder-orchestration";
  let observation;
  try {
    observation = await observeWorkspaceMultiplexer({
      repoRoot: workspace.resolvedPath,
      runsDir,
      tmuxSocket
    });
  } catch {
    observation = {
      tmuxSocket,
      sessions: [],
      panes: [],
      listSessionsOk: false,
      listPanesOk: false
    };
  }

  let entries: string[] = [];
  try {
    entries = (await readdir(runsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const runs: RunListEntry[] = [];
  for (const dirName of entries) {
    const runDir = path.join(runsDir, dirName);
    const launch = await readJsonIfExists(path.join(runDir, "launch.json"));
    const statusDoc = await readJsonIfExists(path.join(runDir, "status.json"));
    const runId = String(launch?.runId ?? dirName);
    const sessions = Array.isArray(launch?.sessions) ? launch.sessions : [];
    const attachedCount = observation.sessions.filter(
      (session) => (session.runId === runId || session.runDir === runDir) && session.attached
    ).length;

    runs.push({
      runId,
      workspaceId: workspace.id,
      runDir,
      status: typeof statusDoc?.status === "string" ? statusDoc.status : null,
      prioritySlug: typeof launch?.prioritySlug === "string" ? launch.prioritySlug : null,
      profile: typeof launch?.profile === "string" ? launch.profile : null,
      route: typeof launch?.route === "string" ? launch.route : null,
      tmuxSocket,
      laneCount: sessions.length,
      sessionsAttached: attachedCount
    });
  }

  return runs.sort((left, right) => right.runId.localeCompare(left.runId));
}

export async function listAllRuns(cocoderHome: string): Promise<RunListEntry[]> {
  const workspaces = await resolveWorkspaceRegistry(cocoderHome);
  const runs: RunListEntry[] = [];
  for (const workspace of workspaces) {
    runs.push(...await listRunsForWorkspace(cocoderHome, workspace));
  }
  return runs;
}

export type ResolvedRunLocation = {
  workspace: ResolvedWorkspaceEntry;
  runDir: string;
  runId: string;
  runsDir: string;
};

export async function resolveRunLocation(
  cocoderHome: string,
  runIdQuery: string
): Promise<ResolvedRunLocation | null> {
  const normalized = runIdQuery.trim();
  if (!normalized) return null;

  const workspaces = await resolveWorkspaceRegistry(cocoderHome);
  const matches: ResolvedRunLocation[] = [];

  for (const workspace of workspaces) {
    const runsDir = workspaceRunsRoot({ cocoderHome, workspaceSlug: workspace.id });
    let entries: string[] = [];
    try {
      entries = (await readdir(runsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    for (const dirName of entries) {
      const runDir = path.join(runsDir, dirName);
      const launch = await readJsonIfExists(path.join(runDir, "launch.json"));
      const runId = String(launch?.runId ?? dirName);
      if (
        runId === normalized
        || dirName === normalized
        || runId.includes(normalized)
        || dirName.includes(normalized)
      ) {
        matches.push({ workspace, runDir, runId, runsDir });
      }
    }
  }

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    const exact = matches.filter(
      (match) => match.runId === normalized || path.basename(match.runDir) === normalized
    );
    if (exact.length === 1) return exact[0];
    throw new Error(`Multiple runs match ${normalized}`);
  }
  return matches[0];
}

export { getRunState };
