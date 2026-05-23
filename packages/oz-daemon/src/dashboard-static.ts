import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

export function resolveDashboardDistRoot(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const packageRoot = path.dirname(require.resolve("oz-dashboard/package.json"));
    const distRoot = path.join(packageRoot, "dist");
    if (!existsSync(path.join(distRoot, "index.html"))) return null;
    return distRoot;
  } catch {
    return null;
  }
}

/** Serve built dashboard assets when `packages/oz-dashboard/dist/` exists (production). */
export async function registerDashboardStatic(app: FastifyInstance): Promise<boolean> {
  const distRoot = resolveDashboardDistRoot();
  if (!distRoot) return false;

  await app.register(fastifyStatic, {
    root: distRoot,
    prefix: "/"
  });

  return true;
}
