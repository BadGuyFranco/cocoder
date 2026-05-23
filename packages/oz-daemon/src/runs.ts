import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { OzAuditRecord } from "schemas";
import {
  appendOzAuditRecord,
  buildLaunchAuditRecord,
  buildStopAuditRecord
} from "./audit.js";
import { launchCocoderSubprocess } from "./spawn-launcher.js";

export type LaunchRunsBody = {
  workspaceId: string;
  persona?: string;
  runId?: string;
  outcome?: string;
  routing?: OzAuditRecord["routing"];
  workspaceRoot?: string;
  prioritySlug?: string;
};

export type StopRunsBody = {
  workspaceId: string;
  persona?: string;
  outcome: string;
  routing?: OzAuditRecord["routing"];
};

export type RegisterRunsRoutesOptions = {
  cocoderHome: string;
  launchExecutable?: string;
  launchArgvPrefix?: string[];
};

function makeRunId(): string {
  const suffix = randomBytes(4).toString("hex");
  return `run-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z-${suffix}`;
}

export async function registerRunsRoutes(app: FastifyInstance, options: RegisterRunsRoutesOptions): Promise<void> {
  app.post("/runs", async (request) => {
    const body = request.body as LaunchRunsBody | undefined;
    if (!body?.workspaceId) {
      throw new Error("workspaceId is required");
    }

    const runId = body.runId ?? makeRunId();
    const outcome = body.outcome ?? "accepted";

    if (options.launchExecutable) {
      const launchArgs = [...(options.launchArgvPrefix ?? []), "launch"];
      if (body.workspaceRoot) launchArgs.push("--workspace-root", body.workspaceRoot);
      if (body.prioritySlug) launchArgs.push("--priority-slug", body.prioritySlug);
      await launchCocoderSubprocess({
        cocoderBin: options.launchExecutable,
        args: launchArgs
      });
    }

    const record = buildLaunchAuditRecord({
      workspaceId: body.workspaceId,
      runId,
      outcome,
      persona: body.persona,
      routing: body.routing
    });
    await appendOzAuditRecord(options.cocoderHome, record);

    return { ok: true, runId, stub: !options.launchExecutable };
  });

  app.delete("/runs/:runId", async (request) => {
    const runId = (request.params as { runId: string }).runId;
    const body = request.body as StopRunsBody | undefined;
    if (!body?.workspaceId || !body.outcome) {
      throw new Error("workspaceId and outcome are required");
    }

    const record = buildStopAuditRecord({
      workspaceId: body.workspaceId,
      runId,
      outcome: body.outcome,
      persona: body.persona,
      routing: body.routing
    });
    await appendOzAuditRecord(options.cocoderHome, record);

    return { ok: true, runId, stub: true };
  });
}
