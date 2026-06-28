import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function writeInventoryManifest({ manifestPath, generatedAt, repoRoot, localRoot, dbPath, runsRoot, summary, entries }) {
  const manifest = {
    kind: 'legacy-local-runs-cleanup-inventory',
    mode: 'dry-run-report-only',
    generatedAt,
    repoRoot,
    localRoot,
    dbPath,
    runsRoot,
    safety: {
      destructiveAction: false,
      dbOpenMode: 'read-only',
      writes: [manifestPath],
      liveExcludedCount: summary.liveExcluded.count,
      liveExcludedRunIds: summary.liveExcluded.runIds,
    },
    summary,
    entries,
  }
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  printSummary(manifestPath, summary)
}

function printSummary(manifestPath, summary) {
  console.log('Legacy local runs cleanup inventory (dry-run/report only)')
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Current local runs: entries=${summary.current.localRunEntries} storeRows=${summary.current.storeRunRows} runDirs=${summary.current.localRunDirs}`)
  console.log(`Projected cocoder/runs: storeRowsProjected=${summary.current.projectedStoreRuns} portableRunDirs=${summary.current.portableRunDirRecords}`)
  console.log(`Residue: pre-projection=${summary.residue['pre-projection'].count} orphan-workspace=${summary.residue['orphan-workspace'].count} both=${summary.residue.both.count}`)
  console.log(`Live/non-terminal excluded: ${summary.liveExcluded.count}`)
  console.log(`Live/non-terminal excluded IDs: ${summary.liveExcluded.runIds.length > 0 ? summary.liveExcluded.runIds.join(', ') : '(none)'}`)
  console.log('Post-cleanup dry-run footprints:')
  for (const [name, data] of Object.entries(summary.postCleanupFootprints)) console.log(`  ${name}: selected=${data.selectedRuns} storeRows=${data.postStoreRunRows} runDirs=${data.postLocalRunDirs}`)
  console.log('No deletion, DB mutation, or backfill performed.')
}
