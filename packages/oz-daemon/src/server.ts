import Fastify, { type FastifyInstance } from "fastify";
import { assertLoopbackHost } from "./bind.js";
import { DEFAULT_OZ_PORT, resolveOzPort } from "./port.js";
import { ensureOzToken } from "./token.js";

export type OzServerOptions = {
  cocoderHome: string;
  host?: string;
  port?: number;
  token?: string;
  env?: NodeJS.ProcessEnv;
};

export type OzServer = {
  app: FastifyInstance;
  host: string;
  port: number;
  token: string;
};

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE"]);

export async function createOzServer(options: OzServerOptions): Promise<OzServer> {
  const host = options.host ?? "127.0.0.1";
  assertLoopbackHost(host);

  const port = options.port ?? resolveOzPort({ env: options.env, configPort: DEFAULT_OZ_PORT });
  const token = options.token ?? await ensureOzToken(options.cocoderHome);

  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

  app.addHook("onRequest", async (request, reply) => {
    if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) return;

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      await reply.code(401).send({ error: "missing bearer token" });
      return;
    }

    const provided = authHeader.slice("Bearer ".length).trim();
    if (provided !== token) {
      await reply.code(401).send({ error: "invalid bearer token" });
      return;
    }
  });

  // Solve-phase stub for state-changing auth probes (Expand replaces with real launch).
  app.post("/runs", async () => ({ ok: true, stub: true }));

  await app.ready();
  return { app, host, port, token };
}

export async function startOzDaemon(options: OzServerOptions): Promise<FastifyInstance> {
  const { app, host, port } = await createOzServer(options);
  await app.listen({ host, port });
  return app;
}
