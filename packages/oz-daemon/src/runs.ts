import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { FastifyInstance } from "fastify";
import type { OzAuditRecord } from "schemas";
import {
  appendOzAuditRecord,
  buildLaunchAuditRecord,
  buildStopAuditRecord
} from "./audit.js";
import { listAllRuns, resolveRunLocation } from "./run-catalog.js";
import { collectRunEvidenceSummary } from "./run-evidence.js";
import {
  readWorkspacesRegistry,
  resolveWorkspaceEntry
} from "./registry.js";
import { launchCocoderSubprocess, runCocoderSubprocess } from "./spawn-launcher.js";

const require = createRequire(import.meta.url);
const { isTerminalRunStatus } = require("../../core/lib/run-status.mjs") as {
  isTerminalRunStatus: (status: unknown) => boolean;
};
const { prepareDebuggerSession } = require("../../core/lib/debugger.mjs") as {
  prepareDebuggerSession: (options: {
    sessionId: string;
    noSession?: boolean;
    runsDir: string;
    debuggerRunsDir: string;
    tmuxBin?: string;
    repoRoot: string;
    mode?: string;
  }) => Promise<{
    ok: boolean;
    status: string;
    sessionId: string;
    noSession?: boolean;
    runDir: string | null;
    debugDir: string;
    promptPath: string;
    wrapperPath: string;
    reportPath: string;
    resultPath: string;
    issues: Array<{ severity?: string; code?: string; detail?: string }>;
  }>;
};

/**
 * Terminal-state command guard (improvement `debugger-terminalized-pane-mutation`,
 * 2026-05-26). The core CLI already refuses run-bound mutating actions on a
 * terminal run (commit, lead-support-commit, send-message, add-lanes,
 * continuation). This is the daemon-side mirror: a `POST /runs` that explicitly
 * targets an existing terminal run is refused so new atom work cannot be bound
 * to a closed run over HTTP. Stop (`DELETE`) and observation (`GET .../evidence`)
 * stay available — teardown and read-only audit are allowed on terminal runs.
 */
async function resolveTerminalRunStatus(
  cocoderHome: string,
  runId: string
): Promise<{ terminal: boolean; status: string | null } | null> {
  const location = await resolveRunLocation(cocoderHome, runId);
  if (!location) return null;
  try {
    const raw = await readFile(path.join(location.runDir, "status.json"), "utf8");
    const parsed = JSON.parse(raw) as { status?: string };
    const status = parsed.status ?? null;
    return { terminal: isTerminalRunStatus(status), status };
  } catch {
    return { terminal: false, status: null };
  }
}

export type LaunchRunsBody = {
  workspaceId: string;
  persona?: string;
  runId?: string;
  outcome?: string;
  routing?: OzAuditRecord["routing"];
  workspaceRoot?: string;
  workspaceSlug?: string;
  profile?: string;
  route?: string;
  prioritySlug?: string;
};

export type StopRunsBody = {
  workspaceId: string;
  persona?: string;
  outcome?: string;
  routing?: OzAuditRecord["routing"];
  runDir?: string;
};

export type LaunchDebuggerBody = {
  workspaceId?: string;
  mode?: "repo-audit" | "launch-failure" | "preflight";
  openTerminal?: boolean;
};

export type RegisterRunsRoutesOptions = {
  cocoderHome: string;
  launchExecutable?: string;
  launchArgvPrefix?: string[];
  stopExecutable?: string;
  stopArgvPrefix?: string[];
};

function makeRunId(): string {
  const suffix = randomBytes(4).toString("hex");
  return `run-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z-${suffix}`;
}

function buildLaunchArgv(
  body: LaunchRunsBody,
  options: RegisterRunsRoutesOptions,
  workspaceRoot: string,
  workspaceSlug: string,
  tmuxSocket?: string
): string[] {
  const launchArgs = [...(options.launchArgvPrefix ?? []), "launch"];
  launchArgs.push("--profile", body.profile!);
  launchArgs.push("--route", body.route!);
  launchArgs.push("--priority-slug", body.prioritySlug!);
  launchArgs.push("--workspace-root", workspaceRoot);
  launchArgs.push("--workspace-slug", workspaceSlug);
  launchArgs.push("--execute", "true");
  // For-now visible-launch: open the run in an iTerm2/Terminal split pane on the
  // operator's desktop. Best-effort in the CLI layer; if no GUI terminal is
  // available the sessions still run headless. To be superseded by the planned
  // Electron terminal harness + Oz window.
  launchArgs.push("--attach", "iterm");
  if (tmuxSocket) launchArgs.push("--socket-name", tmuxSocket);
  return launchArgs;
}

function buildStopArgv(
  runDir: string,
  runId: string,
  options: RegisterRunsRoutesOptions
): string[] {
  return [
    ...(options.stopArgvPrefix ?? []),
    "stop-run",
    "--run-dir",
    runDir,
    "--confirm-run-id",
    runId,
    "--execute",
    "true"
  ];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function appleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

async function runCommand(command: string, args: string[]): Promise<void> {
  const child = spawn(command, args, { shell: false, stdio: "ignore" });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`${command} exited ${exitCode}`);
  }
}

async function openDebuggerWrapperTerminal(input: { wrapperPath: string; repoRoot: string }): Promise<boolean> {
  try {
    const command = `cd ${shellQuote(input.repoRoot)} && ${shellQuote(input.wrapperPath)}`;
    await runCommand("osascript", [
      "-e",
      "tell application \"Terminal\"",
      "-e",
      "activate",
      "-e",
      `do script "${appleScriptString(command)}"`,
      "-e",
      "end tell"
    ]);
    return true;
  } catch {
    return false;
  }
}

async function resolveWorkspaceForLaunch(
  cocoderHome: string,
  body: LaunchRunsBody
): Promise<{ workspaceRoot: string; workspaceSlug: string; tmuxSocket?: string }> {
  const registry = await readWorkspacesRegistry(cocoderHome);
  const entry = registry.workspaces.find((candidate) => candidate.id === body.workspaceId);
  if (body.workspaceRoot) {
    return {
      workspaceRoot: body.workspaceRoot,
      workspaceSlug: body.workspaceSlug ?? body.workspaceId,
      tmuxSocket: entry?.tmuxSocket
    };
  }
  if (!entry) {
    throw new Error(`workspace not found: ${body.workspaceId}`);
  }
  const resolved = await resolveWorkspaceEntry(entry, { cocoderHome });
  return {
    workspaceRoot: resolved.resolvedPath,
    workspaceSlug: body.workspaceSlug ?? body.workspaceId,
    tmuxSocket: entry.tmuxSocket
  };
}

async function resolveWorkspaceForDebugger(cocoderHome: string, workspaceId?: string): Promise<{
  workspaceId: string;
  workspaceRoot: string;
  runsDir: string;
  debuggerRunsDir: string;
}> {
  const registry = await readWorkspacesRegistry(cocoderHome);
  const entry = workspaceId
    ? registry.workspaces.find((candidate) => candidate.id === workspaceId)
    : registry.workspaces[0];
  if (!entry) {
    throw new Error(workspaceId ? `workspace not found: ${workspaceId}` : "no registered workspace found");
  }
  const resolved = await resolveWorkspaceEntry(entry, { cocoderHome });
  const workspaceLocalRoot = path.join(cocoderHome, "local", "workspaces", resolved.id);
  return {
    workspaceId: resolved.id,
    workspaceRoot: resolved.resolvedPath,
    runsDir: path.join(workspaceLocalRoot, "runs"),
    debuggerRunsDir: path.join(workspaceLocalRoot, "debug-runs")
  };
}

export async function registerRunsRoutes(app: FastifyInstance, options: RegisterRunsRoutesOptions): Promise<void> {
  app.get("/runs", async () => {
    const runs = await listAllRuns(options.cocoderHome);
    return { runs };
  });

  app.post("/runs/debugger", async (request, reply) => {
    const body = request.body as LaunchDebuggerBody | undefined;
    const workspace = await resolveWorkspaceForDebugger(options.cocoderHome, body?.workspaceId);

    const debugResult = await prepareDebuggerSession({
      sessionId: "NO-SESSION",
      noSession: true,
      runsDir: workspace.runsDir,
      debuggerRunsDir: workspace.debuggerRunsDir,
      tmuxBin: process.env.TMUX_BIN || "/opt/homebrew/bin/tmux",
      repoRoot: workspace.workspaceRoot,
      mode: body?.mode ?? "repo-audit"
    });
    const terminalOpened = body?.openTerminal === false
      ? false
      : await openDebuggerWrapperTerminal({
        wrapperPath: debugResult.wrapperPath,
        repoRoot: workspace.workspaceRoot
      });

    return {
      ok: true,
      workspaceId: workspace.workspaceId,
      sessionId: debugResult.sessionId,
      noSession: true,
      runDir: debugResult.runDir,
      debugDir: debugResult.debugDir,
      promptPath: debugResult.promptPath,
      wrapperPath: debugResult.wrapperPath,
      reportPath: debugResult.reportPath,
      resultPath: debugResult.resultPath,
      terminalOpened,
      issues: debugResult.issues
    };
  });

  app.get("/runs/:id/evidence", async (request, reply) => {
    const runId = (request.params as { id: string }).id;
    try {
      const location = await resolveRunLocation(options.cocoderHome, runId);
      if (!location) {
        await reply.code(404).send({ error: `run not found: ${runId}` });
        return;
      }
      const evidence = await collectRunEvidenceSummary(location);
      return evidence;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Multiple runs match")) {
        await reply.code(409).send({ error: message });
        return;
      }
      throw error;
    }
  });

  app.post("/runs", async (request, reply) => {
    const body = request.body as LaunchRunsBody | undefined;
    if (!body?.workspaceId) {
      throw new Error("workspaceId is required");
    }

    // Terminal-state command guard: refuse new atom work bound to an existing
    // terminal run. A fresh run (no runId, or a runId that resolves to nothing
    // yet) is allowed; stop/observe remain on their own endpoints.
    if (body.runId) {
      const existing = await resolveTerminalRunStatus(options.cocoderHome, body.runId);
      if (existing?.terminal) {
        await reply.code(409).send({
          ok: false,
          error: "terminal-run-locked",
          runId: body.runId,
          status: existing.status,
          detail:
            "Run is terminal; new atom work must launch a fresh run. Stop and evidence endpoints remain available."
        });
        return;
      }
    }

    const runId = body.runId ?? makeRunId();
    let outcome = body.outcome ?? "accepted";
    let stub = !options.launchExecutable;

    if (options.launchExecutable) {
      if (!body.profile || !body.route || !body.prioritySlug) {
        throw new Error("profile, route, and prioritySlug are required when launch subprocess is configured");
      }
      const workspace = await resolveWorkspaceForLaunch(options.cocoderHome, body);
      const launchArgs = buildLaunchArgv(body, options, workspace.workspaceRoot, workspace.workspaceSlug, workspace.tmuxSocket);
      stub = false;

      try {
        const usesArgvCapture = Boolean(options.launchArgvPrefix?.length);
        if (usesArgvCapture) {
          await launchCocoderSubprocess({
            cocoderBin: options.launchExecutable,
            args: launchArgs
          });
        } else {
          const result = await runCocoderSubprocess({
            cocoderBin: options.launchExecutable,
            args: launchArgs
          });
          if (!result.ok) {
            outcome = "spawn-failed";
          }
        }
        if (outcome !== "spawn-failed") {
          outcome = body.outcome ?? "launched";
        }
      } catch {
        outcome = "spawn-failed";
      }
    }

    const record = buildLaunchAuditRecord({
      workspaceId: body.workspaceId,
      runId,
      outcome,
      persona: body.persona,
      routing: body.routing
    });
    await appendOzAuditRecord(options.cocoderHome, record);

    const ok = outcome !== "spawn-failed";
    await reply.code(ok ? 200 : 502).send({ ok, runId, outcome, stub });
  });

  app.delete("/runs/:runId", async (request, reply) => {
    const runId = (request.params as { runId: string }).runId;
    const body = request.body as StopRunsBody | undefined;
    if (!body?.workspaceId) {
      throw new Error("workspaceId is required");
    }

    let outcome = body.outcome ?? "stopped";
    let stub = !options.stopExecutable;

    if (options.stopExecutable) {
      let runDir = body.runDir;
      if (!runDir) {
        const location = await resolveRunLocation(options.cocoderHome, runId);
        if (!location) {
          throw new Error(`run not found: ${runId}`);
        }
        runDir = location.runDir;
      }

      const stopArgs = buildStopArgv(runDir, runId, options);
      stub = false;

      try {
        const usesArgvCapture = Boolean(options.stopArgvPrefix?.length);
        if (usesArgvCapture) {
          await launchCocoderSubprocess({
            cocoderBin: options.stopExecutable,
            args: stopArgs
          });
          outcome = "stopped";
        } else {
          const result = await runCocoderSubprocess({
            cocoderBin: options.stopExecutable,
            args: stopArgs
          });
          outcome = result.ok ? "stopped" : "spawn-failed";
        }
      } catch {
        outcome = "spawn-failed";
      }
    } else if (!body.outcome) {
      throw new Error("outcome is required when stop subprocess is not configured");
    }

    const record = buildStopAuditRecord({
      workspaceId: body.workspaceId,
      runId,
      outcome,
      persona: body.persona,
      routing: body.routing
    });
    await appendOzAuditRecord(options.cocoderHome, record);

    const ok = outcome !== "spawn-failed";
    await reply.code(ok ? 200 : 502).send({ ok, runId, outcome, stub });
  });
}
