import type { OzRunEvidenceSummary, OzRunListEntry } from "schemas";
import { ozFetch } from "./client.js";

export type RunListResponse = {
  runs: OzRunListEntry[];
};

export async function listRuns(): Promise<OzRunListEntry[]> {
  const body = await ozFetch<RunListResponse>("/runs");
  return body.runs;
}

export async function getRunEvidence(runId: string): Promise<OzRunEvidenceSummary> {
  return ozFetch<OzRunEvidenceSummary>(`/runs/${encodeURIComponent(runId)}/evidence`);
}

export type LaunchDebuggerRequest = {
  workspaceId?: string;
  mode?: "repo-audit" | "launch-failure" | "preflight";
  openTerminal?: boolean;
};

export type LaunchDebuggerResponse = {
  ok: boolean;
  workspaceId: string;
  sessionId: string;
  noSession: boolean;
  runDir: string | null;
  debugDir: string;
  promptPath: string;
  wrapperPath: string;
  reportPath: string;
  resultPath: string;
  terminalOpened: boolean;
  issues: Array<{ severity?: string; code?: string; detail?: string }>;
};

export async function launchDebugger(input: LaunchDebuggerRequest): Promise<LaunchDebuggerResponse> {
  return ozFetch<LaunchDebuggerResponse>("/runs/debugger", { method: "POST", body: input });
}

export type StopRunRequest = {
  workspaceId: string;
  runDir?: string;
};

export type StopRunResponse = {
  ok: boolean;
  runId: string;
  outcome: string;
  stub: boolean;
};

export async function stopRun(runId: string, input: StopRunRequest): Promise<StopRunResponse> {
  return ozFetch<StopRunResponse>(`/runs/${encodeURIComponent(runId)}`, { method: "DELETE", body: input });
}
