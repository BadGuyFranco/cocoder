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

  it("re-bootstraps and retries once on a stale-CSRF 403 (daemon-restart self-heal)", async () => {
    storeSession({ bearerToken: "old", csrfToken: "stale" });
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), headers });
      if (String(url) === "/auth/session") {
        return new Response(JSON.stringify({ bearerToken: "fresh-b", csrfToken: "fresh-c" }), { status: 200 });
      }
      if (headers[OZ_CSRF_HEADER] === "stale") {
        return new Response("missing or invalid csrf token", { status: 403 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const result = await ozFetch<{ ok: boolean }>("/runs", { method: "POST", body: { x: 1 }, fetchImpl });
    expect(result).toEqual({ ok: true });
    expect(calls.some((c) => c.url === "/auth/session")).toBe(true);
    const finalRun = calls.filter((c) => c.url === "/runs").pop()!;
    expect(finalRun.headers[OZ_CSRF_HEADER]).toBe("fresh-c");
    // fresh token persisted for subsequent requests
    expect(sessionStorage.getItem(SESSION_CSRF_KEY)).toBe("fresh-c");
  });

  it("does not retry indefinitely if the 403 persists", async () => {
    storeSession({ bearerToken: "old", csrfToken: "stale" });
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/auth/session") {
        return new Response(JSON.stringify({ bearerToken: "b", csrfToken: "still-bad" }), { status: 200 });
      }
      return new Response("missing or invalid csrf token", { status: 403 });
    });
    await expect(ozFetch("/runs", { method: "POST", body: {}, fetchImpl })).rejects.toThrow(/csrf/i);
    // one original + one bootstrap + one retry = at most 3 calls (no infinite loop)
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("buildMutatingHeaders exposes the same auth surface", () => {
    const headers = buildMutatingHeaders({ bearerToken: "b", csrfToken: "c" });
    expect(headers.Authorization).toBe("Bearer b");
    expect(headers[OZ_CSRF_HEADER]).toBe("c");
  });
});
