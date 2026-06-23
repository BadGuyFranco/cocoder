// @cocoder/session-hosts — SessionHost drivers (ADR-0002). Pure edge: imports only core.
// Phase 1 ships the cmux driver; a tmux driver can be added later without touching core.
export {
  CmuxSessionHost,
  type CmuxDriverOptions,
  type CmuxSpawnTiming,
  makeCmuxCli,
  type CmuxCli,
} from './cmux/index.js'
