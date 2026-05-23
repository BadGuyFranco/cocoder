import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { OzAuditRecord } from "schemas";
import {
  appendOzAuditRecord,
  buildLaunchAuditRecord,
  buildStopAuditRecord
} from "./audit.js";
import { listAllRuns, resolveRunLocation } from "./run-catalog.js";
import { collectRunEvidenceSummary } from "./run-evidence.js";
import {
  readWorkspacesRegistry,
  resolveWorkspaceEntry
} from "./registry.js";
import { launchCocoderSubprocess, runCocoderSubprocess } from "./spawn-launcher.js";

export type LaunchRunsBody = {
  workspaceId: string;
  persona?: string;
  runId?: string;
  outcome?: string;
  routing?: OzAuditRecord["routing"];
  workspaceRoot?: string;
  workspaceSlug?: string;
  profile?: string;
  route?: string;
  prioritySlug?: string;
};

export type StopRunsBody = {
  workspaceId: string;
  persona?: string;
  outcome?: string;
  routing?: OzAuditRecord["routing"];
  runDir?: string;
};

export type RegisterRunsRoutesOptions = {
  cocoderHome: string;
  launchExecutable?: string;
  launchArgvPrefix?: string[];
  stopExecutable?: string;
  stopArgvPrefix?: string[];
};

function makeRunId(): string {
  const suffix = randomBytes(4).toString("hex");
  return `run-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z-${suffix}`;
}

function buildLaunchArgv(
  body: LaunchRunsBody,
  options: RegisterRunsRoutesOptions,
  workspaceRoot: string,
  workspaceSlug: string,
  tmuxSocket?: string
): string[] {
  const launchArgs = [...(options.launchArgvPrefix ?? []), "launch"];
  launchArgs.push("--profile", body.profile!);
  launchArgs.push("--route", body.route!);
  launchArgs.push("--priority-slug", body.prioritySlug!);
  launchArgs.push("--workspace-root", workspaceRoot);
  launchArgs.push("--workspace-slug", workspaceSlug);
  launchArgs.push("--execute", "true");
  if (tmuxSocket) launchArgs.push("--socket-name", tmuxSocket);
  return launchArgs;
}

function buildStopArgv(
  runDir: string,
  runId: string,
  options: RegisterRunsRoutesOptions
): string[] {
  return [
    ...(options.stopArgvPrefix ?? []),
    "stop-run",
    "--run-dir",
    runDir,
    "--confirm-run-id",
    runId,
    "--execute",
    "true"
  ];
}

async function resolveWorkspaceForLaunch(
  cocoderHome: string,
  body: LaunchRunsBody
): Promise<{ workspaceRoot: string; workspaceSlug: string; tmuxSocket?: string }> {
  const registry = await readWorkspacesRegistry(cocoderHome);
  const entry = registry.workspaces.find((candidate) => candidate.id === body.workspaceId);
  if (body.workspaceRoot) {
    return {
      workspaceRoot: body.workspaceRoot,
      workspaceSlug: body.workspaceSlug ?? body.workspaceId,
      tmuxSocket: entry?.tmuxSocket
    };
  }
  if (!entry) {
    throw new Error(`workspace not found: ${body.workspaceId}`);
  }
  const resolved = await resolveWorkspaceEntry(entry, { cocoderHome });
  return {
    workspaceRoot: resolved.resolvedPath,
    workspaceSlug: body.workspaceSlug ?? body.workspaceId,
    tmuxSocket: entry.tmuxSocket
  };
}

export async function registerRunsRoutes(app: FastifyInstance, options: RegisterRunsRoutesOptions): Promise<void> {
  app.get("/runs", async () => {
    const runs = await listAllRuns(options.cocoderHome);
    return { runs };
  });

  app.get("/runs/:id/evidence", async (request, reply) => {
    const runId = (request.params as { id: string }).id;
    try {
      const location = await resolveRunLocation(options.cocoderHome, runId);
      if (!location) {
        await reply.code(404).send({ error: `run not found: ${runId}` });
        return;
      }
      const evidence = await collectRunEvidenceSummary(location);
      return evidence;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Multiple runs match")) {
        await reply.code(409).send({ error: message });
        return;
      }
      throw error;
    }
  });

  app.post("/runs", async (request, reply) => {
    const body = request.body as LaunchRunsBody | undefined;
    if (!body?.workspaceId) {
      throw new Error("workspaceId is required");
    }

    const runId = body.runId ?? makeRunId();
    let outcome = body.outcome ?? "accepted";
    let stub = !options.launchExecutable;

    if (options.launchExecutable) {
      if (!body.profile || !body.route || !body.prioritySlug) {
        throw new Error("profile, route, and prioritySlug are required when launch subprocess is configured");
      }
      const workspace = await resolveWorkspaceForLaunch(options.cocoderHome, body);
      const launchArgs = buildLaunchArgv(body, options, workspace.workspaceRoot, workspace.workspaceSlug, workspace.tmuxSocket);
      stub = false;

      try {
        const usesArgvCapture = Boolean(options.launchArgvPrefix?.length);
        if (usesArgvCapture) {
          await launchCocoderSubprocess({
            cocoderBin: options.launchExecutable,
            args: launchArgs
          });
        } else {
          const result = await runCocoderSubprocess({
            cocoderBin: options.launchExecutable,
            args: launchArgs
          });
          if (!result.ok) {
            outcome = "spawn-failed";
          }
        }
        if (outcome !== "spawn-failed") {
          outcome = body.outcome ?? "launched";
        }
      } catch {
        outcome = "spawn-failed";
      }
    }

    const record = buildLaunchAuditRecord({
      workspaceId: body.workspaceId,
      runId,
      outcome,
      persona: body.persona,
      routing: body.routing
    });
    await appendOzAuditRecord(options.cocoderHome, record);

    const ok = outcome !== "spawn-failed";
    await reply.code(ok ? 200 : 502).send({ ok, runId, outcome, stub });
  });

  app.delete("/runs/:runId", async (request, reply) => {
    const runId = (request.params as { runId: string }).runId;
    const body = request.body as StopRunsBody | undefined;
    if (!body?.workspaceId) {
      throw new Error("workspaceId is required");
    }

    let outcome = body.outcome ?? "stopped";
    let stub = !options.stopExecutable;

    if (options.stopExecutable) {
      let runDir = body.runDir;
      if (!runDir) {
        const location = await resolveRunLocation(options.cocoderHome, runId);
        if (!location) {
          throw new Error(`run not found: ${runId}`);
        }
        runDir = location.runDir;
      }

      const stopArgs = buildStopArgv(runDir, runId, options);
      stub = false;

      try {
        const usesArgvCapture = Boolean(options.stopArgvPrefix?.length);
        if (usesArgvCapture) {
          await launchCocoderSubprocess({
            cocoderBin: options.stopExecutable,
            args: stopArgs
          });
          outcome = "stopped";
        } else {
          const result = await runCocoderSubprocess({
            cocoderBin: options.stopExecutable,
            args: stopArgs
          });
          outcome = result.ok ? "stopped" : "spawn-failed";
        }
      } catch {
        outcome = "spawn-failed";
      }
    } else if (!body.outcome) {
      throw new Error("outcome is required when stop subprocess is not configured");
    }

    const record = buildStopAuditRecord({
      workspaceId: body.workspaceId,
      runId,
      outcome,
      persona: body.persona,
      routing: body.routing
    });
    await appendOzAuditRecord(options.cocoderHome, record);

    const ok = outcome !== "spawn-failed";
    await reply.code(ok ? 200 : 502).send({ ok, runId, outcome, stub });
  });
}
