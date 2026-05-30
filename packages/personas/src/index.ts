import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function basePersonasDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'base')
}
