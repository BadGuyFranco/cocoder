import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ozAuditRecordSchema, type OzAuditRecord } from "schemas";
import { ZodError } from "zod";

export function ozAuditLogPath(cocoderHome: string): string {
  return path.join(cocoderHome, "local/audit/oz-actions.jsonl");
}

export function parseOzAuditRecord(record: unknown): OzAuditRecord {
  return ozAuditRecordSchema.parse(record);
}

export async function appendOzAuditRecord(cocoderHome: string, record: unknown): Promise<OzAuditRecord> {
  let parsed: OzAuditRecord;
  try {
    parsed = parseOzAuditRecord(record);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Invalid Oz audit record: ${error.message}`);
    }
    throw error;
  }

  const auditDir = path.dirname(ozAuditLogPath(cocoderHome));
  await mkdir(auditDir, { recursive: true });
  await appendFile(ozAuditLogPath(cocoderHome), `${JSON.stringify(parsed)}\n`, "utf8");
  return parsed;
}

export function buildLaunchAuditRecord(input: {
  workspaceId: string;
  runId: string;
  outcome: string;
  persona?: string;
  routing?: OzAuditRecord["routing"];
}): OzAuditRecord {
  return {
    timestamp: new Date().toISOString(),
    action: "launch",
    workspaceId: input.workspaceId,
    runId: input.runId,
    outcome: input.outcome,
    persona: input.persona,
    routing: input.routing ?? {
      target: "workspace-shared",
      generality: "workspace-specific"
    }
  };
}

export function buildStopAuditRecord(input: {
  workspaceId: string;
  runId: string;
  outcome: string;
  persona?: string;
  routing?: OzAuditRecord["routing"];
}): OzAuditRecord {
  return {
    timestamp: new Date().toISOString(),
    action: "stop",
    workspaceId: input.workspaceId,
    runId: input.runId,
    outcome: input.outcome,
    persona: input.persona,
    routing: input.routing ?? {
      target: "workspace-shared",
      generality: "workspace-specific"
    }
  };
}
