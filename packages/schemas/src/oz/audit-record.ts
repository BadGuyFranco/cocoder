import { z } from "zod";
import { ozImprovementGeneralitySchema, ozImprovementTargetSchema } from "./improvement-target.js";

export const ozAuditActionSchema = z.enum(["launch", "stop"]);

export const ozAuditRoutingRecordSchema = z.object({
  target: ozImprovementTargetSchema,
  generality: ozImprovementGeneralitySchema
});

export const ozAuditRecordSchema = z.object({
  timestamp: z.string().datetime(),
  action: ozAuditActionSchema,
  workspaceId: z.string().min(1),
  runId: z.string().min(1),
  outcome: z.string().min(1),
  persona: z.string().min(1).optional(),
  routing: ozAuditRoutingRecordSchema
});

export type OzAuditRecord = z.infer<typeof ozAuditRecordSchema>;
