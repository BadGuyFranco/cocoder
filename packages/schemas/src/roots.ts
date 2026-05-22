import { z } from "zod";

export const rootsSchema = z.object({
  $schema: z.string().optional(),
  version: z.string().default("0.1").optional(),
  roots: z.record(z.string().min(1)).default({})
});

export type RootsConfig = z.infer<typeof rootsSchema>;
