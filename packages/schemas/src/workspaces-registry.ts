import { z } from "zod";

const tokenizedPathSchema = z.string().regex(/^(\$\{COCODER_HOME\}|\$\{root:[A-Za-z0-9_-]+\}|\/|~)/, {
  message: "Path must be absolute, home-relative, ${COCODER_HOME}-relative, or ${root:name}-relative"
});

export const workspaceRegistryEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  path: tokenizedPathSchema,
  tmuxSocket: z.string().min(1).optional(),
  lastSeenAt: z.string().datetime().optional()
}).passthrough();

export const workspacesRegistrySchema = z.object({
  $schema: z.string().optional(),
  version: z.string().default("0.1").optional(),
  workspaces: z.array(workspaceRegistryEntrySchema).default([])
});

export type WorkspacesRegistry = z.infer<typeof workspacesRegistrySchema>;
