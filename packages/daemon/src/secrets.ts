// Per-install Bearer token (v1 oz-security C-S2). Stored at <cocoderHome>/local/secrets/oz-token,
// owner-only (0600), gitignored (local/secrets/.gitignore = *). Read if present, minted otherwise.
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Canonical token path for an install rooted at `cocoderHome`. */
export function ozTokenPath(cocoderHome: string): string {
  return join(cocoderHome, 'local', 'secrets', 'oz-token')
}

/** Read the existing token, or mint a 256-bit one and persist it 0600. */
export async function readOrCreateToken(cocoderHome: string): Promise<string> {
  const path = ozTokenPath(cocoderHome)
  try {
    const existing = (await readFile(path, 'utf8')).trim()
    if (existing) return existing
  } catch {
    /* not created yet — fall through to mint */
  }
  const token = randomBytes(32).toString('base64url')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, token, { mode: 0o600 })
  await chmod(path, 0o600) // defeat umask so the C-S2 0600 invariant always holds
  return token
}
