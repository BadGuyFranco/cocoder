import { z } from "zod";

const secretReferencePattern = /^\$\{(env:[A-Z0-9_]+|file:[^}]+|keychain:[^/}]+\/[^}]+)\}$/;

export const secretReferenceSchema = z
  .string()
  .regex(secretReferencePattern, "Expected ${env:NAME}, ${file:relative/path}, or ${keychain:service/account}");

export const mergeDirectiveSchema = z.object({
  __merge: z.enum(["append", "replace"])
}).passthrough();

export const adapterPreferenceSchema = z.object({
  id: z.string().min(1),
  command: z.string().min(1).optional(),
  account: z.string().min(1).optional(),
  enabled: z.boolean().optional()
}).passthrough();

export const cocoderConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.string().default("0.1"),
  defaults: z.object({
    adapter: z.string().min(1).optional(),
    profile: z.string().min(1).optional(),
    route: z.string().min(1).optional()
  }).passthrough().optional(),
  adapters: z.record(adapterPreferenceSchema).optional(),
  modelRoles: z.record(z.string().min(1)).optional(),
  oz: z.object({
    host: z.literal("127.0.0.1").default("127.0.0.1").optional(),
    port: z.number().int().min(1024).max(65535).default(7878).optional()
  }).passthrough().optional(),
  theme: z.object({
    mode: z.enum(["system", "light", "dark"]).default("system").optional(),
    accent: z.string().min(1).optional()
  }).passthrough().optional(),
  secrets: z.record(secretReferenceSchema).optional()
}).passthrough();

export type CocoderConfig = z.infer<typeof cocoderConfigSchema>;
