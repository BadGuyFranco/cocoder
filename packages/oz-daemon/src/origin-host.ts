export const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE"]);

export function allowedHostValues(port: number): Set<string> {
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
}

export function allowedOriginValues(port: number): Set<string> {
  return new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
}

export function normalizeHostHeader(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(",")[0]?.trim();
  if (!host) return null;
  return host.toLowerCase();
}

export type OriginHostValidation = {
  ok: true;
} | {
  ok: false;
  error: "invalid host" | "invalid origin";
};

export function validateOriginHost(options: {
  method: string;
  hostHeader?: string;
  originHeader?: string;
  port: number;
}): OriginHostValidation {
  const method = options.method.toUpperCase();
  const stateChanging = STATE_CHANGING_METHODS.has(method);
  const allowedHosts = allowedHostValues(options.port);
  const allowedOrigins = allowedOriginValues(options.port);
  const host = normalizeHostHeader(options.hostHeader);
  const origin = options.originHeader?.trim();

  if (stateChanging) {
    if (!host || !allowedHosts.has(host)) {
      return { ok: false, error: "invalid host" };
    }
  } else if (host && !allowedHosts.has(host)) {
    return { ok: false, error: "invalid host" };
  }

  if (origin && !allowedOrigins.has(origin)) {
    return { ok: false, error: "invalid origin" };
  }

  return { ok: true };
}
