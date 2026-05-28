import { z } from "zod";

export const ozWorkspacePrioritySchema = z.object({
  slug: z.string().min(1),
  description: z.string(),
  status: z.string(),
  section: z.enum(["Active", "Draft"]),
  readmePath: z.string().nullable()
});

export const ozWorkspacePriorityListResponseSchema = z.object({
  workspaceId: z.string().min(1),
  prioritiesPath: z.string().min(1),
  priorities: z.array(ozWorkspacePrioritySchema)
});

export type OzWorkspacePriority = z.infer<typeof ozWorkspacePrioritySchema>;
