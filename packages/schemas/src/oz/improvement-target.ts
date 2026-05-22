import { z } from "zod";

export const ozImprovementTargetSchema = z.enum([
  "cocoder-product",
  "workspace-shared",
  "workspace-local",
  "install-local",
  "upstream-candidate"
]);

export const ozImprovementGeneralitySchema = z.enum([
  "local-only",
  "workspace-specific",
  "generalizable"
]);

export const ozImprovementRoutingSchema = z.object({
  target: ozImprovementTargetSchema,
  generality: ozImprovementGeneralitySchema,
  workspaceId: z.string().min(1).optional(),
  developerModeRequired: z.boolean().default(false),
  rationale: z.string().min(1),
  proposedPaths: z.array(z.string().min(1)).default([])
});

export type OzImprovementRouting = z.infer<typeof ozImprovementRoutingSchema>;
