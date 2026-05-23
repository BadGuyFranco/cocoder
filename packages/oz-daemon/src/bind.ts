const FORBIDDEN_BIND_HOSTS = new Set(["0.0.0.0", "::", "::0"]);

export function assertLoopbackHost(host: string): void {
  if (FORBIDDEN_BIND_HOSTS.has(host)) {
    throw new Error(`Oz daemon must bind 127.0.0.1 only; got ${host}`);
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Oz daemon must bind loopback; got ${host}`);
  }
}
