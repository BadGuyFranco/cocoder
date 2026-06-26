import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('scripts/oz.sh daemon reaping', () => {
  test('stop targets oz.mjs daemon processes, not only the listening socket', async () => {
    const script = await readFile(join(here, '..', '..', '..', 'scripts', 'oz.sh'), 'utf8')

    expect(script).toContain('pgrep -f "${DAEMON_BIN} --port ${PORT}"')
    expect(script).toContain('kill_daemons TERM')
    expect(script).toContain('kill_daemons KILL')
    expect(script).not.toContain('lsof -ti ":${PORT}" -sTCP:LISTEN | xargs kill')
  })

  test('daemon bin has a hard self-kill fallback for wedged shutdown', async () => {
    const bin = await readFile(join(here, '..', 'bin', 'oz.mjs'), 'utf8')

    expect(bin).toContain("process.kill(process.pid, 'SIGKILL')")
    expect(bin).toContain('if (shuttingDown) return')
  })
})
