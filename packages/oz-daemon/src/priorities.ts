import { readFile } from "node:fs/promises";
import path from "node:path";

export type WorkspacePriorityEntry = {
  slug: string;
  description: string;
  status: string;
  section: "Active" | "Draft";
  readmePath: string | null;
};

const TABLE_ROW_RE = /^\|\s*\[`([^`]+)`\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/;

function parseTableSection(lines: string[], sectionName: "Active" | "Draft"): WorkspacePriorityEntry[] {
  const entries: WorkspacePriorityEntry[] = [];
  let inSection = false;
  let inTable = false;

  for (const line of lines) {
    if (/^##\s+Active\b/.test(line)) {
      inSection = sectionName === "Active";
      inTable = false;
      continue;
    }
    if (/^##\s+Draft\b/.test(line)) {
      inSection = sectionName === "Draft";
      inTable = false;
      continue;
    }
    if (!inSection) continue;
    if (/^##\s+/.test(line) && !/^##\s+(Active|Draft)\b/.test(line)) break;

    if (/^\|\s*Slug\s*\|/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (!line.trim().startsWith("|")) {
      inTable = false;
      continue;
    }
    if (/^\|\s*-/.test(line)) continue;

    const match = line.match(TABLE_ROW_RE);
    if (!match) continue;
    entries.push({
      slug: match[1],
      description: match[3].trim(),
      status: match[4].trim(),
      section: sectionName,
      readmePath: match[2].trim()
    });
  }

  return entries;
}

export async function listWorkspacePriorities(workspaceRoot: string): Promise<WorkspacePriorityEntry[]> {
  const prioritiesPath = path.join(workspaceRoot, "cocoder/PRIORITIES.md");
  const raw = await readFile(prioritiesPath, "utf8");
  const lines = raw.split(/\r?\n/);
  return [
    ...parseTableSection(lines, "Active"),
    ...parseTableSection(lines, "Draft")
  ];
}

export function workspacePrioritiesPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "cocoder/PRIORITIES.md");
}
