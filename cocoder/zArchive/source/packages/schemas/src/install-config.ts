import { cocoderConfigSchema } from "./config.js";
import { z } from "zod";

export const installConfigSchema = cocoderConfigSchema;
export type InstallConfig = z.infer<typeof installConfigSchema>;
