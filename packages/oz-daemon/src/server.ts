import Fastify, { type FastifyInstance } from "fastify";
import { assertLoopbackHost } from "./bind.js";
import { createCsrfToken, OZ_CSRF_HEADER, validateCsrfToken } from "./csrf.js";
import { STATE_CHANGING_METHODS, validateAuthSessionOriginHost, validateOriginHost } from "./origin-host.js";
import { registerWorkspacesRoutes } from "./workspaces.js";
import { DEFAULT_OZ_PORT, resolveOzPort } from "./port.js";
import { registerRunsRoutes } from "./runs.js";
import { registerSettingsRoutes } from "./settings.js";
import { ensureOzToken } from "./token.js";

export type OzServerOptions = {
  cocoderHome: string;
  host?: string;
  port?: number;
  token?: string;
  csrfToken?: string;
  env?: NodeJS.ProcessEnv;
  launchExecutable?: string;
  launchArgvPrefix?: string[];
};

export type OzServer = {
  app: FastifyInstance;
  host: string;
  port: number;
  token: string;
  csrfToken: string;
};

export { OZ_CSRF_HEADER } from "./csrf.js";

export async function createOzServer(options: OzServerOptions): Promise<OzServer> {
  const host = options.host ?? "127.0.0.1";
  assertLoopbackHost(host);

  const port = options.port ?? resolveOzPort({ env: options.env, configPort: DEFAULT_OZ_PORT });
  const token = options.token ?? await ensureOzToken(options.cocoderHome);
  const csrfToken = options.csrfToken ?? createCsrfToken();

  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

  app.get("/auth/session", async (request, reply) => {
    const authSessionOrigin = validateAuthSessionOriginHost({
      hostHeader: request.headers.host,
      originHeader: request.headers.origin,
      port
    });
    if (!authSessionOrigin.ok) {
      await reply.code(403).send({ error: authSessionOrigin.error });
      return;
    }
    return { csrfToken, bearerToken: token };
  });

  app.addHook("onRequest", async (request, reply) => {
    const originHost = validateOriginHost({
      method: request.method,
      hostHeader: request.headers.host,
      originHeader: request.headers.origin,
      port
    });
    if (!originHost.ok) {
      await reply.code(403).send({ error: originHost.error });
      return;
    }

    if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) return;

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      await reply.code(401).send({ error: "missing bearer token" });
      return;
    }

    const providedBearer = authHeader.slice("Bearer ".length).trim();
    if (providedBearer !== token) {
      await reply.code(401).send({ error: "invalid bearer token" });
      return;
    }

    const providedCsrf = request.headers[OZ_CSRF_HEADER];
    const csrfValue = Array.isArray(providedCsrf) ? providedCsrf[0] : providedCsrf;
    if (!validateCsrfToken(csrfValue, csrfToken)) {
      await reply.code(403).send({ error: "missing or invalid csrf token" });
      return;
    }
  });

  app.setErrorHandler(async (error, _request, reply) => {
    const message = error instanceof Error ? error.message : String(error);
    await reply.code(400).send({ error: message });
  });

  await registerSettingsRoutes(app, options.cocoderHome);
  await registerWorkspacesRoutes(app, { cocoderHome: options.cocoderHome });
  await registerRunsRoutes(app, {
    cocoderHome: options.cocoderHome,
    launchExecutable: options.launchExecutable,
    launchArgvPrefix: options.launchArgvPrefix
  });

  await app.ready();
  return { app, host, port, token, csrfToken };
}

export async function startOzDaemon(options: OzServerOptions): Promise<FastifyInstance> {
  const { app, host, port } = await createOzServer(options);
  await app.listen({ host, port });
  return app;
}
