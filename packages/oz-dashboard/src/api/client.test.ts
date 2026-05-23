import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_BEARER_KEY,
  SESSION_CSRF_KEY,
  OZ_CSRF_HEADER,
  bootstrapSession,
  clearSession,
  readStoredSession,
  storeSession
} from "./auth.js";
import { buildMutatingHeaders, ozFetch } from "./client.js";

describe("auth bootstrap", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("stores bearer + csrf in sessionStorage", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ bearerToken: "b", csrfToken: "c" }), { status: 200 })
    );
    const session = await bootstrapSession(fetchImpl);
    expect(session).toEqual({ bearerToken: "b", csrfToken: "c" });
    expect(sessionStorage.getItem(SESSION_BEARER_KEY)).toBe("b");
    expect(sessionStorage.getItem(SESSION_CSRF_KEY)).toBe("c");
  });

  it("readStoredSession returns null when incomplete", () => {
    storeSession({ bearerToken: "only", csrfToken: "c" });
    clearSession();
    sessionStorage.setItem(SESSION_BEARER_KEY, "only");
    expect(readStoredSession()).toBeNull();
  });
});

describe("ozFetch mutating headers", () => {
  beforeEach(() => {
    sessionStorage.clear();
    storeSession({ bearerToken: "bear", csrfToken: "csrf" });
  });

  it("sends Bearer and CSRF on PUT", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await ozFetch("/settings", {
      method: "PUT",
      body: { key: "modelRoles.lead", value: "codex" },
      fetchImpl
    });
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const init = call![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer bear");
    expect(headers[OZ_CSRF_HEADER]).toBe("csrf");
  });

  it("buildMutatingHeaders exposes the same auth surface", () => {
    const headers = buildMutatingHeaders({ bearerToken: "b", csrfToken: "c" });
    expect(headers.Authorization).toBe("Bearer b");
    expect(headers[OZ_CSRF_HEADER]).toBe("c");
  });
});
