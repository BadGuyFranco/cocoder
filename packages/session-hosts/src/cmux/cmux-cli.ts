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

/** Extract the first `<kind>:<n>` ref from a command's text output (e.g. `OK workspace:4` →
 *  workspace; `OK surface:5 workspace:4` → surface). Throws if absent. */
export function parseOkRef(output: string, kind: 'workspace' | 'surface' | 'pane'): string {
  const m = output.match(new RegExp(`\\b${kind}:\\d+\\b`))
  if (!m) throw new Error(`cmux: expected a ${kind} ref in output: ${output.slice(0, 120)}`)
  return m[0]
}

/** All `pane:<n>` refs in `list-panes` output (used to diff the new pane after a split). */
export function parsePaneRefs(text: string): string[] {
  return [...text.matchAll(/\bpane:\d+\b/g)].map((m) => m[0])
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
