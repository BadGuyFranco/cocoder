import { createRequire } from "node:module";
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
  };
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
      jobsDir: `${location.runDir}/jobs`
    },
    collectedAt: bundle.collectedAt
  };
}
