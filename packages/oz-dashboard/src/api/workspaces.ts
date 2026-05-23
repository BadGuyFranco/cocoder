import type { OzWorkspaceCreateRequest, OzWorkspaceResponse, OzWorkspaceUpdateRequest } from "schemas";
import { ozFetch } from "./client.js";

export type WorkspaceListResponse = {
  workspaces: OzWorkspaceResponse[];
};

export async function listWorkspaces(): Promise<OzWorkspaceResponse[]> {
  const body = await ozFetch<WorkspaceListResponse>("/workspaces");
  return body.workspaces;
}

export async function createWorkspace(input: OzWorkspaceCreateRequest): Promise<OzWorkspaceResponse> {
  return ozFetch<OzWorkspaceResponse>("/workspaces", { method: "POST", body: input });
}

export async function updateWorkspace(id: string, input: OzWorkspaceUpdateRequest): Promise<OzWorkspaceResponse> {
  return ozFetch<OzWorkspaceResponse>(`/workspaces/${encodeURIComponent(id)}`, { method: "PUT", body: input });
}

export async function deleteWorkspace(id: string): Promise<void> {
  await ozFetch<{ ok: boolean }>(`/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type SettingsResponse = {
  config: Record<string, unknown>;
};

export async function getSettings(): Promise<SettingsResponse> {
  return ozFetch<SettingsResponse>("/settings");
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  await ozFetch("/settings", { method: "PUT", body: { key, value } });
}
