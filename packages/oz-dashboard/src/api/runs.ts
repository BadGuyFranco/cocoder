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
