import type { FastifyInstance } from "fastify";
import {
  ozWorkspaceCreateRequestSchema,
  ozWorkspaceUpdateRequestSchema,
  type WorkspacesRegistry
} from "schemas";
import {
  assertRegistryPathToken,
  readWorkspacesRegistry,
  resolveWorkspaceEntry,
  resolveWorkspaceRegistry,
  writeWorkspacesRegistry
} from "./registry.js";

export type RegisterWorkspacesRoutesOptions = {
  cocoderHome: string;
};

function findWorkspaceIndex(registry: WorkspacesRegistry, id: string): number {
  return registry.workspaces.findIndex((entry) => entry.id === id);
}

export async function registerWorkspacesRoutes(
  app: FastifyInstance,
  options: RegisterWorkspacesRoutesOptions
): Promise<void> {
  app.get("/workspaces", async () => {
    const workspaces = await resolveWorkspaceRegistry(options.cocoderHome);
    return { workspaces };
  });

  app.get("/workspaces/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const registry = await readWorkspacesRegistry(options.cocoderHome);
    const entry = registry.workspaces.find((candidate) => candidate.id === id);
    if (!entry) {
      await reply.code(404).send({ error: `workspace not found: ${id}` });
      return;
    }
    const resolved = await resolveWorkspaceEntry(entry, { cocoderHome: options.cocoderHome });
    return resolved;
  });

  app.post("/workspaces", async (request, reply) => {
    const body = ozWorkspaceCreateRequestSchema.parse(request.body);
    assertRegistryPathToken(body.path);

    const registry = await readWorkspacesRegistry(options.cocoderHome);
    if (findWorkspaceIndex(registry, body.id) >= 0) {
      await reply.code(409).send({ error: `workspace already exists: ${body.id}` });
      return;
    }

    registry.workspaces.push({
      ...body,
      lastSeenAt: new Date().toISOString()
    });
    await writeWorkspacesRegistry(options.cocoderHome, registry);
    const resolved = await resolveWorkspaceEntry(body, { cocoderHome: options.cocoderHome });
    await reply.code(201).send(resolved);
  });

  app.put("/workspaces/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const patch = ozWorkspaceUpdateRequestSchema.parse(request.body);
    if (patch.path !== undefined) {
      assertRegistryPathToken(patch.path);
    }

    const registry = await readWorkspacesRegistry(options.cocoderHome);
    const index = findWorkspaceIndex(registry, id);
    if (index < 0) {
      await reply.code(404).send({ error: `workspace not found: ${id}` });
      return;
    }

    const updated = {
      ...registry.workspaces[index],
      ...patch,
      id,
      lastSeenAt: new Date().toISOString()
    };
    registry.workspaces[index] = updated;
    await writeWorkspacesRegistry(options.cocoderHome, registry);
    return resolveWorkspaceEntry(updated, { cocoderHome: options.cocoderHome });
  });

  app.delete("/workspaces/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const registry = await readWorkspacesRegistry(options.cocoderHome);
    const index = findWorkspaceIndex(registry, id);
    if (index < 0) {
      await reply.code(404).send({ error: `workspace not found: ${id}` });
      return;
    }

    registry.workspaces.splice(index, 1);
    await writeWorkspacesRegistry(options.cocoderHome, registry);
    return { ok: true, id };
  });
}
