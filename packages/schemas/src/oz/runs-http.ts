import { z } from "zod";

export const ozRunListEntrySchema = z.object({
  runId: z.string().min(1),
  workspaceId: z.string().min(1),
  runDir: z.string().min(1),
  status: z.string().nullable(),
  prioritySlug: z.string().nullable(),
  profile: z.string().nullable(),
  route: z.string().nullable(),
  tmuxSocket: z.string().min(1),
  laneCount: z.number().int().nonnegative(),
  sessionsAttached: z.number().int().nonnegative()
});

export const ozRunListResponseSchema = z.object({
  runs: z.array(ozRunListEntrySchema)
});

export const ozRunEvidenceSummarySchema = z.object({
  runId: z.string().min(1),
  workspaceId: z.string().min(1),
  status: z.string().nullable(),
  topology: z.object({
    laneCount: z.number().int().nonnegative(),
    lanes: z.array(z.object({
      lane: z.string(),
      sessionName: z.string().optional(),
      displayLabel: z.string().optional()
    })),
    socketName: z.string().nullable()
  }),
  flags: z.object({
    statusMismatches: z.array(z.object({
      lane: z.string().optional(),
      code: z.string(),
      detail: z.string()
    })),
    blockedPicker: z.array(z.object({
      lane: z.string().optional(),
      code: z.string(),
      detail: z.string()
    })),
    rootCheck: z.object({
      ok: z.boolean(),
      uniqueRoots: z.array(z.string())
    }),
    issueCount: z.number().int().nonnegative()
  }),
  evidencePaths: z.object({
    runDir: z.string(),
    launchJson: z.string(),
    statusJson: z.string(),
    startupPacketJson: z.string(),
    jobsDir: z.string()
  }),
  collectedAt: z.string().datetime()
});

export type OzRunListEntry = z.infer<typeof ozRunListEntrySchema>;
export type OzRunEvidenceSummary = z.infer<typeof ozRunEvidenceSummarySchema>;
