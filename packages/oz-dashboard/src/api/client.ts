import { OZ_CSRF_HEADER, getOrBootstrapSession, type OzSession } from "./auth.js";

export class OzApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "OzApiError";
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  session?: OzSession;
  fetchImpl?: typeof fetch;
};

async function resolveSession(fetchImpl: typeof fetch, session?: OzSession): Promise<OzSession> {
  return session ?? getOrBootstrapSession(fetchImpl);
}

export async function ozFetch<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const session = await resolveSession(fetchImpl, options.session);
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  if (method !== "GET" && method !== "HEAD") {
    headers.Authorization = `Bearer ${session.bearerToken}`;
    headers[OZ_CSRF_HEADER] = session.csrfToken;
    headers["Content-Type"] = "application/json";
  }

  const response = await fetchImpl(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new OzApiError(text || `request failed (${response.status})`, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function buildMutatingHeaders(session: OzSession): Record<string, string> {
  return {
    Authorization: `Bearer ${session.bearerToken}`,
    [OZ_CSRF_HEADER]: session.csrfToken,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}
