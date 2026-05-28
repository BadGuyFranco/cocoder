import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedRunLocation } from "./run-catalog.js";

const require = createRequire(import.meta.url);
const { collectDebugEvidence } = require("../../core/lib/debugger.mjs") as {
  collectDebugEvidence: (options: Record<string, unknown>) => Promise<Record<string, any>>;
};

export type RunEvidenceSummary = {
  runId: string;
  workspaceId: string;
  status: string | null;
  topology: {
    laneCount: number;
    lanes: Array<{ lane: string; sessionName?: string; displayLabel?: string }>;
    socketName: string | null;
  };
  flags: {
    statusMismatches: Array<{ lane?: string; code: string; detail: string }>;
    blockedPicker: Array<{ lane?: string; code: string; detail: string }>;
    rootCheck: {
      ok: boolean;
      uniqueRoots: string[];
    };
    issueCount: number;
  };
  evidencePaths: {
    runDir: string;
    launchJson: string;
    statusJson: string;
    startupPacketJson: string;
    jobsDir: string;
    servicesDir: string;
  };
  services: Array<{
    packetId: string;
    serviceId: string | null;
    mode: string | null;
    status: string | null;
    paths: {
      packetJson: string;
      resultJson: string | null;
      transcriptTxt: string | null;
    };
  }>;
  collectedAt: string;
};

export async function collectRunEvidenceSummary(
  location: ResolvedRunLocation
): Promise<RunEvidenceSummary> {
  const bundle = await collectDebugEvidence({
    repoRoot: location.workspace.resolvedPath,
    runDir: location.runDir,
    sessionId: location.runId,
    mode: "snapshot"
  });

  const launch = bundle.run?.launch as Record<string, unknown> | undefined;
  const sessions = Array.isArray(launch?.sessions)
    ? launch.sessions as Array<{ lane?: string; sessionName?: string; displayLabel?: string }>
    : [];

  const mismatches = Array.isArray(bundle.resultConsistency?.mismatches)
    ? bundle.resultConsistency.mismatches
    : [];
  const issues = Array.isArray(bundle.issues) ? bundle.issues : [];
  const blockedPicker = issues.filter((issue: { code?: string }) => issue.code === "pane-interactive-picker");
  const servicesDir = path.join(location.runDir, "services");
  const services = await collectServiceArtifacts(servicesDir);

  return {
    runId: location.runId,
    workspaceId: location.workspace.id,
    status: bundle.run?.status?.status ?? bundle.targetRun?.status ?? null,
    topology: {
      laneCount: sessions.length,
      lanes: sessions.map((session) => ({
        lane: session.lane ?? "unknown",
        sessionName: session.sessionName,
        displayLabel: session.displayLabel
      })),
      socketName: typeof launch?.socketName === "string" ? launch.socketName : null
    },
    flags: {
      statusMismatches: mismatches,
      blockedPicker,
      rootCheck: {
        ok: Boolean(bundle.rootCheck?.ok),
        uniqueRoots: Array.isArray(bundle.rootCheck?.uniqueRoots) ? bundle.rootCheck.uniqueRoots : []
      },
      issueCount: issues.length
    },
    evidencePaths: {
      runDir: location.runDir,
      launchJson: bundle.run?.launchPath ?? `${location.runDir}/launch.json`,
      statusJson: bundle.run?.statusPath ?? `${location.runDir}/status.json`,
      startupPacketJson: bundle.run?.startupPacketPath ?? `${location.runDir}/startup-packet.json`,
      jobsDir: `${location.runDir}/jobs`,
      servicesDir
    },
    services,
    collectedAt: bundle.collectedAt
  };
}

async function collectServiceArtifacts(servicesDir: string): Promise<RunEvidenceSummary["services"]> {
  let entries;
  try {
    entries = await readdir(servicesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const artifacts: RunEvidenceSummary["services"] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const packetId = entry.name;
    const dir = path.join(servicesDir, packetId);
    const packetPath = path.join(dir, "packet.json");
    const resultPath = path.join(dir, "result.json");
    const transcriptPath = path.join(dir, "transcript.txt");
    const packet = await readJsonIfExists(packetPath);
    const result = await readJsonIfExists(resultPath);
    artifacts.push({
      packetId,
      serviceId: stringOrNull(result?.serviceId) ?? stringOrNull(packet?.serviceId),
      mode: stringOrNull(packet?.mode),
      status: stringOrNull(result?.status),
      paths: {
        packetJson: packetPath,
        resultJson: result ? resultPath : null,
        transcriptTxt: await fileExists(transcriptPath) ? transcriptPath : null
      }
    });
  }
  return artifacts;
}

async function readJsonIfExists(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
