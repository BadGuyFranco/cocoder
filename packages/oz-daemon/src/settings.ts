import type { FastifyInstance } from "fastify";
// @ts-expect-error Runtime import of extracted core .mjs module (ADR-0004 boundary).
import { resolveConfig, setInstallConfigValue } from "../../core/lib/config.mjs";

export type SettingsPutBody = {
  key: string;
  value: unknown;
};

export async function registerSettingsRoutes(app: FastifyInstance, cocoderHome: string): Promise<void> {
  app.get("/settings", async () => {
    const { config } = await resolveConfig({ cocoderHome, resolveSecrets: false });
    return { config };
  });

  app.put("/settings", async (request, reply) => {
    const body = request.body as SettingsPutBody | undefined;
    if (!body?.key || body.value === undefined) {
      await reply.code(400).send({ error: "key and value are required" });
      return;
    }

    const result = await setInstallConfigValue(body.key, body.value, { cocoderHome });
    return { ok: true, file: result.filePath, zone: result.zone };
  });
}
