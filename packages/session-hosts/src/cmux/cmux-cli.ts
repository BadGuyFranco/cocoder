// Thin wrapper over the `cmux` CLI (its Unix-socket control surface). The only I/O the
// cmux driver does. cmux must be in `automation` socket mode (no password) — ADR-0002.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface CmuxCli {
  run(args: readonly string[]): Promise<string>
}

/** Real cmux CLI. `run` rejects on non-zero exit (execFile behaviour), surfacing cmux errors. */
export function makeCmuxCli(bin = 'cmux'): CmuxCli {
  return {
    async run(args) {
      const { stdout } = await execFileAsync(bin, [...args], {
        maxBuffer: 16 * 1024 * 1024,
      })
      return stdout
    },
  }
}

/** Parse `list-workspaces --json` → the list of workspace refs. */
export function parseWorkspaceRefs(json: string): string[] {
  const data = JSON.parse(json) as { workspaces?: Array<{ ref?: string }> }
  return (data.workspaces ?? []).map((w) => w.ref).filter((r): r is string => typeof r === 'string')
}

/** Parse `list-pane-surfaces --workspace <ws> --json` → { paneRef, surfaceRef }. */
export function parseSurface(json: string): { paneRef: string; surfaceRef: string } {
  const data = JSON.parse(json) as {
    pane_ref?: string
    surfaces?: Array<{ ref?: string; selected?: boolean }>
  }
  const surfaces = data.surfaces ?? []
  const chosen = surfaces.find((s) => s.selected) ?? surfaces[0]
  if (!data.pane_ref || !chosen?.ref) {
    throw new Error(`cmux: could not resolve a surface from list-pane-surfaces output: ${json.slice(0, 200)}`)
  }
  return { paneRef: data.pane_ref, surfaceRef: chosen.ref }
}
