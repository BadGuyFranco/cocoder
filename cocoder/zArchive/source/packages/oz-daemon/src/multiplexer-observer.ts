import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { collectConcurrencyMap } = require("../../core/lib/debugger.mjs") as {
  collectConcurrencyMap: (options: Record<string, unknown>) => Promise<{
    sessions: MultiplexerSessionSummary[];
    panes: MultiplexerPaneSummary[];
    listSessions: { ok: boolean };
    listPanes: { ok: boolean };
  }>;
};

export type MultiplexerObserverOptions = {
  repoRoot: string;
  runsDir: string;
  tmuxSocket?: string;
  tmuxBin?: string;
  currentRunDir?: string;
};

export type MultiplexerSessionSummary = {
  sessionName: string;
  created: string;
  attached: boolean;
  runId: string | null;
  runDir: string | null;
  isCurrentRun: boolean;
};

export type MultiplexerPaneSummary = {
  sessionName: string;
  command: string;
  currentPath: string;
  dead: boolean;
};

export type MultiplexerObservation = {
  tmuxSocket: string;
  sessions: MultiplexerSessionSummary[];
  panes: MultiplexerPaneSummary[];
  listSessionsOk: boolean;
  listPanesOk: boolean;
};

const DEFAULT_TMUX_SOCKET = "cocoder-orchestration";

export async function observeWorkspaceMultiplexer(
  options: MultiplexerObserverOptions
): Promise<MultiplexerObservation> {
  const tmuxSocket = options.tmuxSocket ?? DEFAULT_TMUX_SOCKET;
  const map = await collectConcurrencyMap({
    repoRoot: options.repoRoot,
    runsDir: options.runsDir,
    tmuxBin: options.tmuxBin,
    currentRunDir: options.currentRunDir,
    tmuxSocket
  });

  return {
    tmuxSocket,
    sessions: map.sessions,
    panes: map.panes,
    listSessionsOk: map.listSessions.ok,
    listPanesOk: map.listPanes.ok
  };
}

export async function listSessions(options: MultiplexerObserverOptions): Promise<MultiplexerSessionSummary[]> {
  const observation = await observeWorkspaceMultiplexer(options);
  return observation.sessions;
}

export async function listPanes(options: MultiplexerObserverOptions): Promise<MultiplexerPaneSummary[]> {
  const observation = await observeWorkspaceMultiplexer(options);
  return observation.panes;
}

export type RunStateSummary = {
  runId: string;
  workspaceId: string;
  runDir: string;
  repoRoot: string;
  tmuxSocket: string;
  status: string | null;
  sessions: MultiplexerSessionSummary[];
};

export async function getRunState(input: {
  cocoderHome: string;
  workspaceId: string;
  repoRoot: string;
  runsDir: string;
  runDir: string;
  runId: string;
  tmuxSocket?: string;
  tmuxBin?: string;
}): Promise<RunStateSummary> {
  const observation = await observeWorkspaceMultiplexer({
    repoRoot: input.repoRoot,
    runsDir: input.runsDir,
    tmuxSocket: input.tmuxSocket,
    tmuxBin: input.tmuxBin,
    currentRunDir: input.runDir
  });

  let status: string | null = null;
  try {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const statusPath = path.join(input.runDir, "status.json");
    const raw = await readFile(statusPath, "utf8");
    const parsed = JSON.parse(raw) as { status?: string };
    status = parsed.status ?? null;
  } catch {
    status = null;
  }

  const runSessions = observation.sessions.filter(
    (session) => session.runId === input.runId || session.runDir === input.runDir
  );

  return {
    runId: input.runId,
    workspaceId: input.workspaceId,
    runDir: input.runDir,
    repoRoot: input.repoRoot,
    tmuxSocket: input.tmuxSocket ?? DEFAULT_TMUX_SOCKET,
    status,
    sessions: runSessions
  };
}
