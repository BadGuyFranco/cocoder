export const OZ_CSRF_HEADER = "x-oz-csrf-token";
export const SESSION_BEARER_KEY = "oz-bearer-token";
export const SESSION_CSRF_KEY = "oz-csrf-token";

export type OzSession = {
  bearerToken: string;
  csrfToken: string;
};

export function readStoredSession(): OzSession | null {
  const bearerToken = sessionStorage.getItem(SESSION_BEARER_KEY);
  const csrfToken = sessionStorage.getItem(SESSION_CSRF_KEY);
  if (!bearerToken || !csrfToken) return null;
  return { bearerToken, csrfToken };
}

export function storeSession(session: OzSession): void {
  sessionStorage.setItem(SESSION_BEARER_KEY, session.bearerToken);
  sessionStorage.setItem(SESSION_CSRF_KEY, session.csrfToken);
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_BEARER_KEY);
  sessionStorage.removeItem(SESSION_CSRF_KEY);
}

export async function bootstrapSession(fetchImpl: typeof fetch = fetch): Promise<OzSession> {
  const response = await fetchImpl("/auth/session", {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`auth bootstrap failed (${response.status})`);
  }
  const body = (await response.json()) as { bearerToken?: string; csrfToken?: string };
  if (!body.bearerToken || !body.csrfToken) {
    throw new Error("auth bootstrap response missing tokens");
  }
  const session = { bearerToken: body.bearerToken, csrfToken: body.csrfToken };
  storeSession(session);
  return session;
}

export function getOrBootstrapSession(fetchImpl?: typeof fetch): Promise<OzSession> {
  const existing = readStoredSession();
  if (existing) return Promise.resolve(existing);
  return bootstrapSession(fetchImpl);
}
