import { z } from "zod";
import { workspaceRegistryEntrySchema } from "../workspaces-registry.js";

export const ozWorkspaceResponseSchema = workspaceRegistryEntrySchema.extend({
  resolvedPath: z.string().min(1)
});

export const ozWorkspaceListResponseSchema = z.object({
  workspaces: z.array(ozWorkspaceResponseSchema)
});

export const ozWorkspaceCreateRequestSchema = workspaceRegistryEntrySchema.omit({
  lastSeenAt: true
});

export const ozWorkspaceUpdateRequestSchema = workspaceRegistryEntrySchema
  .omit({ id: true, lastSeenAt: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required"
  });

export const ozAuthSessionResponseSchema = z.object({
  csrfToken: z.string().min(1),
  bearerToken: z.string().min(1)
});

export type OzWorkspaceResponse = z.infer<typeof ozWorkspaceResponseSchema>;
export type OzWorkspaceCreateRequest = z.infer<typeof ozWorkspaceCreateRequestSchema>;
export type OzWorkspaceUpdateRequest = z.infer<typeof ozWorkspaceUpdateRequestSchema>;
export type OzAuthSessionResponse = z.infer<typeof ozAuthSessionResponseSchema>;
