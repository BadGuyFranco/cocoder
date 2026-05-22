import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { cocoderConfigSchema } from "../src/config.js";
import { installConfigSchema } from "../src/install-config.js";
import { rootsSchema } from "../src/roots.js";
import { workspacesRegistrySchema } from "../src/workspaces-registry.js";
import { ozImprovementRoutingSchema } from "../src/oz/improvement-target.js";

const outDir = path.resolve("dist");

const schemas = [
  ["config.schema.json", "cocoder-config", cocoderConfigSchema],
  ["install-config.schema.json", "cocoder-install-config", installConfigSchema],
  ["roots.schema.json", "cocoder-roots", rootsSchema],
  ["workspaces-registry.schema.json", "cocoder-workspaces-registry", workspacesRegistrySchema],
  ["oz-improvement-routing.schema.json", "cocoder-oz-improvement-routing", ozImprovementRoutingSchema]
] as const;

await mkdir(outDir, { recursive: true });

for (const [fileName, name, schema] of schemas) {
  const jsonSchema = zodToJsonSchema(schema, {
    name,
    $refStrategy: "none",
    target: "jsonSchema7"
  });
  await writeFile(path.join(outDir, fileName), `${JSON.stringify(jsonSchema, null, 2)}\n`);
}
