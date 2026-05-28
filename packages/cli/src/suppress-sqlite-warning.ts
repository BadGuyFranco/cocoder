// Acknowledge + silence ONLY node:sqlite's ExperimentalWarning (ADR-0003 store) so it doesn't
// read as cryptic noise (the F10 lesson). Imported first in run.ts, before core loads node:sqlite.
// We accept the experimental API deliberately; better-sqlite3 is the named fallback behind the
// RunStore port. We do NOT blanket-suppress other warnings.
const original = process.emitWarning.bind(process)
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning?.message
  if (typeof message === 'string' && message.includes('SQLite is an experimental feature')) return
  return (original as (w: string | Error, ...a: unknown[]) => void)(warning, ...rest)
}) as typeof process.emitWarning
