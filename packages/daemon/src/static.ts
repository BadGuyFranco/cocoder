// Serve the vanilla dashboard assets (packages/ui/public). Resolved from THIS module's location
// (not process.cwd()), so `cocoder oz start` serves the dashboard regardless of the cwd the daemon
// subprocess inherits (review fix). Static assets are open (no Bearer) — the browser must load the
// page before it can bootstrap a token via /auth/session; the Host/Origin gate still applies.
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ServerResponse } from 'node:http'

// src/static.ts → ../../ui/public
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'ui', 'public')

const CONTENT_TYPE: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

/** Serve a dashboard asset for GET `pathname`. Returns false (not handled) for non-asset paths so
 *  the request falls through to the bearer-gated JSON routes. Path-traversal safe. */
export async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const type = CONTENT_TYPE[extname(rel)]
  if (!type) return false // not a known static asset → let JSON routing handle it

  const full = normalize(join(PUBLIC_DIR, rel))
  if (!full.startsWith(PUBLIC_DIR)) return false // traversal attempt — refuse

  try {
    const buf = await readFile(full)
    res.writeHead(200, { 'content-type': type })
    res.end(buf)
    return true
  } catch {
    return false // missing file → fall through to 404
  }
}
