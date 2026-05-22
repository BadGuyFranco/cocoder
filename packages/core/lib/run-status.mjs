export const TERMINAL_RUN_STATUSES = new Set([
  'complete',
  'blocked',
  'failed',
  'aborted',
  'stale'
]);

export function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(String(status || ''));
}

export function isTerminalRunStatusRecord(record) {
  if (!record || typeof record !== 'object') return false;
  return record.terminal === true || isTerminalRunStatus(record.status);
}
