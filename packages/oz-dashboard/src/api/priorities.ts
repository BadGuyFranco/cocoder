import type { OzWorkspacePriority } from "schemas";
import { ozFetch } from "./client.js";

export type WorkspacePriorityListResponse = {
  workspaceId: string;
  prioritiesPath: string;
  priorities: OzWorkspacePriority[];
};

export async function listWorkspacePriorities(workspaceId: string): Promise<WorkspacePriorityListResponse> {
  return ozFetch<WorkspacePriorityListResponse>(`/workspaces/${encodeURIComponent(workspaceId)}/priorities`);
}

export type LaunchRunRequest = {
  workspaceId: string;
  profile: string;
  route: string;
  prioritySlug: string;
};

export type LaunchRunResponse = {
  ok: boolean;
  runId: string;
  outcome: string;
  stub: boolean;
};

export async function launchRun(input: LaunchRunRequest): Promise<LaunchRunResponse> {
  return ozFetch<LaunchRunResponse>("/runs", { method: "POST", body: input });
}
