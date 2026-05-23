#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { runAcceptanceHarness } from './lib/acceptance.mjs';
import { loadAdapterDeclarations, preflightAdapterRegistry } from './lib/adapters.mjs';
import { compareImmutableBaseline } from './lib/baseline.mjs';
import { checkAdrStatusConsistency, summarizeAdrStatusReport } from './checks/check-adr-status-consistency.mjs';
import { checkDocFreshness, summarizeDocFreshnessReport } from './checks/check-doc-freshness.mjs';
import { checkDocRefs, summarizeDocRefReport } from './checks/check-doc-refs.mjs';
import { checkPersonaSourceBoundaries, summarizePersonaSourceBoundaryReport } from './checks/check-persona-source-boundaries.mjs';
import { checkPrioritiesLastUpdated, summarizePrioritiesLastUpdatedReport } from './checks/check-priorities-last-updated.mjs';
import { checkSessionLogHygiene, summarizeSessionLogHygieneReport } from './checks/check-session-log-hygiene.mjs';
import { checkWriteAuthority, summarizeWriteAuthorityReport } from './checks/check-write-authority.mjs';
import { checkRouteProfileCompatibility, composeLaunchDryRun, validateProfileDirectory, validateRouteDirectory } from './lib/composition.mjs';
import { processRunContinuation } from './lib/continuation.mjs';
import { getConfigValue, resolveConfig, setInstallConfigValue, setWorkspaceConfigValue } from './lib/config.mjs';
import {
  DEFAULT_WORKSPACE_SLUG,
  assertExplicitWorkspaceContextWhenInsideInstall,
  resolveInstallRoot,
  workspaceCheckReportPath,
  workspaceDebuggerRunsRoot,
  workspaceRunsRoot
} from './lib/paths.mjs';
import { loadContracts, validateContractFiles, validateInstance } from './lib/contracts.mjs';
import { followDebuggerEvidence, prepareDebuggerSession } from './lib/debugger.mjs';
import {
  acquireDispatchLock,
  auditWriteBoundary,
  checkDispatchLock,
  classifyTeammateState,
  evaluateResultGate,
  readJsonList,
  releaseDispatchLock,
  validateHelperPolicy,
  validateVerifierPacket
} from './lib/dispatch.mjs';
import {
  buildRecoveryArtifact,
  evaluateCloseoutFlow,
  evaluatePhaseTransitionFlow,
  validateQuinnQaPacket,
  validateSessionStartFlow,
  validateTaliaAcceptancePacket
} from './lib/flows.mjs';
import { readJson, repoPath } from './lib/fs-utils.mjs';
import { addLanesToRun, launchRun, sendMessageToLane, stopRunSessions } from './lib/launch.mjs';
import { recordSupersession } from './lib/lead-rescue.mjs';
import { abortRun, addEvidence, cleanupRuns, closeoutRun, createRun, finalizeRunStatusFromResults, ingestResult, setRunStatus } from './lib/ledger.mjs';
import { commitAcceptedResult, commitLeadSupportChange, evaluateLaneGitPolicy } from './lib/orchestrator-commit.mjs';
import { checkPersonaRouteCoverage, scanPersonaPrivateReferenceLeakage, validatePersonaDirectory } from './lib/personas.mjs';
import { validatePriorityBoundaryDirectory } from './lib/priority-boundaries.mjs';
import { checkHandoffConsistencyFromFiles } from './lib/session-wrap.mjs';
import {
  buildAutonomyReport,
  buildImprovementArtifact,
  evaluateStaleDocs,
  validateImprovementArtifact,
  validateImprovementDirectory
} from './lib/self-healing.mjs';

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONTRACTS_DIR = path.join(CORE_DIR, 'contracts');
const DEFAULT_BASELINE = path.join(CORE_DIR, 'baselines', 'accepted-reference-baseline.md');
const DEFAULT_ADAPTERS_DIR = path.join(CORE_DIR, 'adapters');

// M4.25 / pending-decisions Q3=A — ephemeral run/debug/check-report artifacts
// live in the install-local zone at `<install>/local/workspaces/<slug>/...`.
// Resolution is deferred to call time because findCocoderHome / resolveInstallRoot
// must walk ancestors from cwd, which can change between handler invocations
// (e.g., when a CLI command is exec'd from a non-install cwd with --cocoder-home).
async function resolveDefaultRunPaths(args) {
  // M4.27 — surface the friendly "cwd inside install + workspace-scope intent + no
  // explicit context" error BEFORE doing any resolution that would silently bind
  // to the install dogfood. The check is a no-op when `--workspace-root` or
  // `--workspace-slug` is present or when cwd is outside any CoCoder install.
  await assertExplicitWorkspaceContextWhenInsideInstall({
    workspaceRoot: args.workspaceRoot,
    workspaceSlug: args.workspaceSlug,
    startDir: process.cwd()
  });
  const cocoderHome = args.cocoderHome
    ? path.resolve(args.cocoderHome)
    : await resolveInstallRoot(process.cwd());
  const workspaceSlug = args.workspaceSlug || DEFAULT_WORKSPACE_SLUG;
  return {
    cocoderHome,
    workspaceSlug,
    runsDir: workspaceRunsRoot({ cocoderHome, workspaceSlug }),
    debuggerRunsDir: workspaceDebuggerRunsRoot({ cocoderHome, workspaceSlug }),
    checkReportFor: (checkName, timestamp) =>
      workspaceCheckReportPath({ cocoderHome, workspaceSlug, checkName, timestamp })
  };
}
const DEFAULT_PROFILES_DIR = repoPath('cocoder/profiles');
const DEFAULT_ROUTES_DIR = repoPath('cocoder/routes');
const DEFAULT_PERSONAS_DIR = repoPath('cocoder/personas');
const DEFAULT_IMPROVEMENTS_DIR = repoPath('cocoder/improvements');
const DEFAULT_PRIORITY_BOUNDARIES_DIR = repoPath('cocoder/priority-boundaries');

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'config') {
    await handleConfig(rest);
    return;
  }
  const args = parseArgs(rest);

  if (!command || command === 'help' || command === '--help' || command === '-h' || args.help) {
    printHelp();
    return;
  }

  if (command === 'validate-contracts') {
    const result = await validateContractFiles(args.contractsDir || DEFAULT_CONTRACTS_DIR);
    if (result.failures.length > 0) {
      console.log(JSON.stringify({ ok: false, failures: result.failures }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ ok: true, contracts: result.contracts.map((contract) => contract.contract) }, null, 2));
    return;
  }

  if (command === 'validate-file') {
    requireArgs(args, ['contract', 'file']);
    const contracts = await loadContracts(args.contractsDir || DEFAULT_CONTRACTS_DIR);
    const contract = contracts.get(args.contract);
    if (!contract) throw new Error(`Unknown contract ${args.contract}`);
    const instance = await readJson(args.file);
    const errors = validateInstance(contract, instance);
    console.log(JSON.stringify({ ok: errors.length === 0, contract: args.contract, file: args.file, errors }, null, 2));
    if (errors.length > 0) process.exitCode = 1;
    return;
  }

  if (command === 'check-immutable-baseline') {
    const result = await compareImmutableBaseline({ baselinePath: args.baseline || DEFAULT_BASELINE });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'validate-adapters') {
    const result = await loadAdapterDeclarations({
      adaptersDir: args.adaptersDir || DEFAULT_ADAPTERS_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify({
      ok: result.failures.length === 0,
      adapters: result.adapters.map((adapter) => adapter.id),
      failures: result.failures
    }, null, 2));
    if (result.failures.length > 0) process.exitCode = 1;
    return;
  }

  if (command === 'preflight-adapters') {
    const result = await preflightAdapterRegistry({
      adaptersDir: args.adaptersDir || DEFAULT_ADAPTERS_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'validate-profiles') {
    const result = await validateProfileDirectory({
      profilesDir: args.profilesDir || DEFAULT_PROFILES_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify({
      ok: result.ok,
      profiles: result.values.map((profile) => profile.id),
      failures: result.failures
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'validate-routes') {
    const result = await validateRouteDirectory({
      routesDir: args.routesDir || DEFAULT_ROUTES_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify({
      ok: result.ok,
      routes: result.values.map((route) => route.id),
      failures: result.failures
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'validate-priority-boundaries') {
    const result = await validatePriorityBoundaryDirectory({
      boundariesDir: args.priorityBoundariesDir || DEFAULT_PRIORITY_BOUNDARIES_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify({
      ok: result.ok,
      boundaries: result.values.map((boundary) => boundary.id),
      failures: result.failures
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'validate-personas') {
    const result = await validatePersonaDirectory({
      personasDir: args.personasDir || DEFAULT_PERSONAS_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify({
      ok: result.ok,
      personas: result.personas.map((persona) => persona.id),
      failures: result.failures
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'check-persona-route-coverage') {
    const result = await checkPersonaRouteCoverage({
      personasDir: args.personasDir || DEFAULT_PERSONAS_DIR,
      routesDir: args.routesDir || DEFAULT_ROUTES_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'check-persona-leakage') {
    const result = await scanPersonaPrivateReferenceLeakage({
      personasDir: args.personasDir || DEFAULT_PERSONAS_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'check-route-profile') {
    requireArgs(args, ['profile', 'route']);
    const result = await checkRouteProfileCompatibility({
      profilePath: args.profile,
      routePath: args.route,
      adaptersDir: args.adaptersDir || DEFAULT_ADAPTERS_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify(trimCompatibility(result), null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'compose-launch') {
    requireArgs(args, ['profile', 'route', 'prioritySlug']);
    await assertExplicitWorkspaceContextWhenInsideInstall({
      workspaceRoot: args.workspaceRoot,
      workspaceSlug: args.workspaceSlug,
      startDir: process.cwd()
    });
    const result = await composeLaunchDryRun({
      profilePath: args.profile,
      routePath: args.route,
      adaptersDir: args.adaptersDir || DEFAULT_ADAPTERS_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      priorityFile: args.priorityFile || repoPath('cocoder/PRIORITIES.md'),
      prioritySlug: args.prioritySlug,
      priorityBoundariesDir: args.priorityBoundariesDir || DEFAULT_PRIORITY_BOUNDARIES_DIR,
      sessionLogFile: args.sessionLog || repoPath('cocoder/SESSION_LOG.md'),
      sessionLineLimit: Number(args.sessionLineLimit || 80),
      creationContext: {
        command: 'create-run',
        execute: false
      }
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'classify-teammate') {
    requireArgs(args, ['state']);
    const result = await classifyTeammateState({
      statePath: args.state,
      now: args.now || new Date().toISOString(),
      timeoutMs: Number(args.timeoutMs || 300000)
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'acquire-dispatch-lock') {
    requireArgs(args, ['lock', 'owner']);
    const result = await acquireDispatchLock({
      lockPath: args.lock,
      owner: args.owner,
      nonce: args.nonce,
      now: args.now || new Date().toISOString(),
      ttlMs: Number(args.ttlMs || 300000)
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'release-dispatch-lock') {
    requireArgs(args, ['lock', 'owner', 'nonce']);
    const result = await releaseDispatchLock({
      lockPath: args.lock,
      owner: args.owner,
      nonce: args.nonce
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'check-dispatch-lock') {
    requireArgs(args, ['lock']);
    const result = await checkDispatchLock({
      lockPath: args.lock,
      now: args.now || new Date().toISOString(),
      staleMs: Number(args.staleMs || 300000)
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'check-helper-policy') {
    requireArgs(args, ['helperPlan']);
    const result = validateHelperPolicy(await readJson(args.helperPlan));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'audit-write-boundary') {
    requireArgs(args, ['boundary', 'files']);
    const boundary = await readJson(args.boundary);
    const filesChanged = await readJsonList(args.files);
    const result = auditWriteBoundary({ ...boundary, filesChanged });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'validate-verifier-packet') {
    requireArgs(args, ['packet']);
    const result = validateVerifierPacket(await readJson(args.packet));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'gate-result') {
    requireArgs(args, ['result']);
    const result = await evaluateResultGate({
      resultPath: args.result,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.accepting) process.exitCode = 1;
    return;
  }

  if (command === 'validate-session-start-flow') {
    requireArgs(args, ['flow']);
    const result = await validateSessionStartFlow(await readJson(args.flow), { contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'evaluate-phase-transition-flow') {
    requireArgs(args, ['flow']);
    const result = await evaluatePhaseTransitionFlow(await readJson(args.flow), { contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'validate-talia-packet') {
    requireArgs(args, ['packet']);
    const result = validateTaliaAcceptancePacket(await readJson(args.packet));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'validate-quinn-packet') {
    requireArgs(args, ['packet']);
    const result = await validateQuinnQaPacket(await readJson(args.packet), { contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'evaluate-closeout-flow') {
    requireArgs(args, ['flow']);
    const result = await evaluateCloseoutFlow(await readJson(args.flow), { contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'build-rollback-artifact') {
    requireArgs(args, ['input']);
    const result = await buildRecoveryArtifact(await readJson(args.input), { type: 'rollback', outputPath: args.output });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'build-abort-artifact') {
    requireArgs(args, ['input']);
    const result = await buildRecoveryArtifact(await readJson(args.input), { type: 'abort', outputPath: args.output });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'validate-improvement-artifact') {
    requireArgs(args, ['artifact']);
    const result = await validateImprovementArtifact(args.artifact, { contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'validate-improvements') {
    const result = await validateImprovementDirectory({
      improvementsDir: args.improvementsDir || DEFAULT_IMPROVEMENTS_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify({
      ok: result.ok,
      artifacts: result.artifacts.map((artifact) => artifact.id),
      failures: result.failures
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'build-improvement-artifact') {
    requireArgs(args, ['input']);
    const result = await buildImprovementArtifact(await readJson(args.input), {
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      outputPath: args.output
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'check-stale-docs') {
    requireArgs(args, ['docs']);
    const result = await evaluateStaleDocs(await readJson(args.docs), {
      now: args.now || new Date().toISOString(),
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'build-autonomy-report') {
    requireArgs(args, ['input']);
    const result = await buildAutonomyReport(await readJson(args.input), {
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      outputPath: args.output
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'run-acceptance-harness') {
    requireArgs(args, ['output']);
    const result = await runAcceptanceHarness({
      outputDir: args.output,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      adaptersDir: args.adaptersDir || DEFAULT_ADAPTERS_DIR,
      profilePath: args.profile || repoPath('cocoder/profiles/active.profile.json'),
      routePath: args.route || repoPath('cocoder/routes/claude-oscar-codex-bob.json'),
      priorityBoundariesDir: args.priorityBoundariesDir || DEFAULT_PRIORITY_BOUNDARIES_DIR,
      baselinePath: args.baseline || DEFAULT_BASELINE,
      cdpUrl: args.cdpUrl || 'http://127.0.0.1:9222/json/version',
      allowLive: args.allowLive === 'true',
      now: args.now || new Date().toISOString()
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'launch') {
    requireArgs(args, ['profile', 'route', 'prioritySlug']);
    const runPaths = await resolveDefaultRunPaths(args);
    const result = await launchRun({
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      adaptersDir: args.adaptersDir || DEFAULT_ADAPTERS_DIR,
      runsDir: args.runsDir || runPaths.runsDir,
      runId: args.runId,
      profilePath: args.profile,
      routePath: args.route,
      priorityFile: args.priorityFile || repoPath('cocoder/PRIORITIES.md'),
      prioritySlug: args.prioritySlug,
      priorityBoundariesDir: args.priorityBoundariesDir || DEFAULT_PRIORITY_BOUNDARIES_DIR,
      sessionLogFile: args.sessionLog || repoPath('cocoder/SESSION_LOG.md'),
      sessionLineLimit: Number(args.sessionLineLimit || 80),
      socketName: args.socketName,
      socketPath: args.socketPath,
      tmuxBin: args.tmuxBin,
      deferStart: args.deferStart === 'true',
      execute: args.execute === 'true',
      allowConcurrentPriorityRun: args.allowConcurrentPriorityRun === 'true'
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'send-message') {
    requireArgs(args, ['runDir', 'lane']);
    if (args.stdin === 'true' && args.message !== undefined) {
      throw new Error('send-message accepts either --message TEXT or --stdin, not both');
    }
    if (args.stdin !== 'true') requireArgs(args, ['message']);
    const message = args.stdin === 'true' ? await readStdin() : args.message;
    const result = await sendMessageToLane({
      runDir: args.runDir,
      lane: args.lane,
      message,
      tmuxBin: args.tmuxBin
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'add-lanes') {
    requireArgs(args, ['runDir', 'lanes']);
    const result = await addLanesToRun({
      runDir: args.runDir,
      lanes: args.lanes,
      topologyOptionId: args.topologyOption,
      reason: args.reason,
      requiredPersonas: args.requiredPersonas ? args.requiredPersonas.split(',').map((item) => item.trim()).filter(Boolean) : [],
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      adaptersDir: args.adaptersDir || DEFAULT_ADAPTERS_DIR,
      priorityBoundariesDir: args.priorityBoundariesDir || DEFAULT_PRIORITY_BOUNDARIES_DIR,
      execute: args.execute === 'true',
      autoAttachAddedLanes: args.autoAttachAddedLanes !== 'false',
      tmuxBin: args.tmuxBin
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'stop-run') {
    requireArgs(args, ['runDir', 'confirmRunId']);
    const result = await stopRunSessions({
      runDir: args.runDir,
      confirmRunId: args.confirmRunId,
      execute: args.execute === 'true',
      tmuxBin: args.tmuxBin
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'create-run') {
    requireArgs(args, ['profile', 'route', 'prioritySlug']);
    const runPaths = await resolveDefaultRunPaths(args);
    const result = await createRun({
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      runsDir: args.runsDir || runPaths.runsDir,
      runId: args.runId,
      profilePath: args.profile,
      routePath: args.route,
      priorityFile: args.priorityFile || repoPath('cocoder/PRIORITIES.md'),
      prioritySlug: args.prioritySlug,
      priorityBoundariesDir: args.priorityBoundariesDir || DEFAULT_PRIORITY_BOUNDARIES_DIR,
      sessionLogFile: args.sessionLog || repoPath('cocoder/SESSION_LOG.md'),
      sessionLineLimit: Number(args.sessionLineLimit || 80)
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'set-status') {
    requireArgs(args, ['runDir', 'status']);
    const result = await setRunStatus(args.runDir, args.status, args.reason);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'add-evidence') {
    requireArgs(args, ['runDir', 'evidence']);
    const result = await addEvidence({ runDir: args.runDir, contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR, evidencePath: args.evidence });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'ingest-result') {
    requireArgs(args, ['runDir', 'jobId', 'result']);
    const result = await ingestResult({
      runDir: args.runDir,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      jobId: args.jobId,
      resultPath: args.result,
      promptPath: args.prompt,
      transcriptPath: args.transcript
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'closeout') {
    requireArgs(args, ['runDir']);
    const result = await closeoutRun(args.runDir, args.summary || 'closed out by orchestration core CLI');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'finalize-run-status') {
    requireArgs(args, ['runDir']);
    const result = await finalizeRunStatusFromResults({
      runDir: args.runDir,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      summary: args.summary,
      repoRoot: args.repoRoot || process.cwd()
    });
    if ((args.processContinuation === true || args.processContinuation === 'true') && result.terminal === true) {
      result.continuation = await processRunContinuation({
        runDir: args.runDir,
        contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
        adaptersDir: args.adaptersDir || DEFAULT_ADAPTERS_DIR,
        runsDir: args.runsDir || (await resolveDefaultRunPaths(args)).runsDir,
        profilesDir: args.profilesDir || DEFAULT_PROFILES_DIR,
        routesDir: args.routesDir || DEFAULT_ROUTES_DIR,
        priorityBoundariesDir: args.priorityBoundariesDir || DEFAULT_PRIORITY_BOUNDARIES_DIR,
        priorityFile: args.priorityFile || repoPath('cocoder/PRIORITIES.md'),
        sessionLogFile: args.sessionLog || repoPath('cocoder/SESSION_LOG.md'),
        repoRoot: args.repoRoot || process.cwd(),
        tmuxBin: args.tmuxBin,
        execute: args.executeContinuation !== 'false'
      });
    }
    if (
      (args.stopTerminalSessions === true || args.stopTerminalSessions === 'true')
      && result.terminal === true
      && result.continuation?.stopResult === undefined
      && (
        !result.continuation
        || result.continuation.status === 'skipped'
        || (result.continuation.status === 'blocked' && result.continuation.requested?.stopCurrentRunPanes !== false)
      )
    ) {
      if (args.founderApprovedTeardown === true || args.founderApprovedTeardown === 'true') {
        result.sessionStop = await stopRunSessions({
          runDir: args.runDir,
          confirmRunId: result.runId || path.basename(args.runDir),
          execute: true,
          tmuxBin: args.tmuxBin
        });
      } else {
        result.sessionStop = {
          ok: false,
          executed: false,
          status: 'blocked',
          reason: 'terminal session teardown requires explicit founder approval through a kill/teardown command'
        };
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'orchestrator-commit') {
    requireArgs(args, ['runDir', 'lane', 'message']);
    const result = await commitAcceptedResult({
      runDir: args.runDir,
      lane: args.lane,
      repoRoot: args.repoRoot || process.cwd(),
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      resultPath: args.result,
      message: args.message,
      developerMode: args.developerMode
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'lead-support-commit') {
    requireArgs(args, ['runDir', 'lane', 'message', 'files']);
    const result = await commitLeadSupportChange({
      runDir: args.runDir,
      lane: args.lane,
      repoRoot: args.repoRoot || process.cwd(),
      files: splitCsv(args.files),
      message: args.message,
      reason: args.reason || '',
      developerMode: args.developerMode
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'check-lane-git-policy') {
    requireArgs(args, ['route', 'lane', 'command']);
    const result = evaluateLaneGitPolicy({
      route: await readJson(args.route),
      lane: args.lane,
      command: args.command
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'check-doc-refs') {
    requireArgs(args, ['root']);
    const runPaths = await resolveDefaultRunPaths(args);
    const reportPath = args.report || runPaths.checkReportFor('check-doc-refs', compactTimestamp(new Date().toISOString()));
    const result = await checkDocRefs({
      root: args.root,
      reportPath,
      personaPaths: args.personaPaths ? args.personaPaths.split(',').map((item) => path.resolve(item.trim())).filter(Boolean) : undefined,
      decisionsDir: args.decisionsDir || repoPath('decisions')
    });
    console.log(`${summarizeDocRefReport(result)} report=${reportPath}`);
    return;
  }

  if (command === 'check-adr-status-consistency') {
    requireArgs(args, ['root']);
    const runPaths = await resolveDefaultRunPaths(args);
    const reportPath = args.report || runPaths.checkReportFor('check-adr-status-consistency', compactTimestamp(new Date().toISOString()));
    const result = await checkAdrStatusConsistency({
      root: args.root,
      reportPath,
      decisionsDirs: [args.decisionsDir || repoPath('decisions')]
    });
    console.log(`${summarizeAdrStatusReport(result)} report=${reportPath}`);
    return;
  }

  if (command === 'check-doc-freshness') {
    requireArgs(args, ['root']);
    const runPaths = await resolveDefaultRunPaths(args);
    const reportPath = args.report || runPaths.checkReportFor('check-doc-freshness', compactTimestamp(new Date().toISOString()));
    const result = await checkDocFreshness({
      root: args.root,
      reportPath,
      decisionsDirs: [args.decisionsDir || repoPath('decisions')],
      thresholdDays: Number(args.thresholdDays || 30),
      now: args.now || new Date().toISOString()
    });
    console.log(`${summarizeDocFreshnessReport(result)} report=${reportPath}`);
    return;
  }

  if (command === 'check-write-authority') {
    requireArgs(args, ['root']);
    const runPaths = await resolveDefaultRunPaths(args);
    const reportPath = args.report || runPaths.checkReportFor('check-write-authority', compactTimestamp(new Date().toISOString()));
    const result = await checkWriteAuthority({
      root: args.root,
      reportPath,
      raciPath: args.raci || repoPath('cocoder/standards/raci.json'),
      boundariesDir: args.boundariesDir || repoPath('cocoder/priority-boundaries'),
      routesDir: args.routesDir || repoPath('cocoder/routes'),
      personasDir: args.personasDir || repoPath('cocoder/personas')
    });
    console.log(`${summarizeWriteAuthorityReport(result)} report=${reportPath}`);
    return;
  }

  if (command === 'check-priorities-last-updated') {
    requireArgs(args, ['root']);
    const runPaths = await resolveDefaultRunPaths(args);
    const reportPath = args.report || runPaths.checkReportFor('check-priorities-last-updated', compactTimestamp(new Date().toISOString()));
    const result = await checkPrioritiesLastUpdated({
      root: args.root,
      reportPath,
      priorityFile: args.priorityFile || path.join(path.resolve(args.root), 'cocoder/PRIORITIES.md'),
      maxChars: Number(args.maxChars || 600),
      now: args.now || new Date().toISOString()
    });
    console.log(`${summarizePrioritiesLastUpdatedReport(result)} report=${reportPath}`);
    return;
  }

  if (command === 'check-session-log-hygiene') {
    requireArgs(args, ['root']);
    const runPaths = await resolveDefaultRunPaths(args);
    const reportPath = args.report || runPaths.checkReportFor('check-session-log-hygiene', compactTimestamp(new Date().toISOString()));
    const result = await checkSessionLogHygiene({
      root: args.root,
      reportPath,
      sessionLogFile: args.sessionLog || path.join(path.resolve(args.root), 'cocoder/SESSION_LOG.md'),
      maxEntries: Number(args.maxEntries || 10),
      maxEntryLines: Number(args.maxEntryLines || 20),
      maxEntryChars: Number(args.maxEntryChars || 2500),
      now: args.now || new Date().toISOString()
    });
    console.log(`${summarizeSessionLogHygieneReport(result)} report=${reportPath}`);
    return;
  }

  if (command === 'check-persona-source-boundaries') {
    requireArgs(args, ['root']);
    const runPaths = await resolveDefaultRunPaths(args);
    const reportPath = args.report || runPaths.checkReportFor('check-persona-source-boundaries', compactTimestamp(new Date().toISOString()));
    const result = await checkPersonaSourceBoundaries({
      root: args.root,
      reportPath,
      now: args.now || new Date().toISOString()
    });
    console.log(`${summarizePersonaSourceBoundaryReport(result)} report=${reportPath}`);
    return;
  }

  if (command === 'check-handoff-consistency') {
    requireArgs(args, ['prioritySlug', 'plan']);
    const result = await checkHandoffConsistencyFromFiles({
      prioritySlug: args.prioritySlug,
      priorityFile: args.priorityFile || repoPath('cocoder/PRIORITIES.md'),
      planFile: args.plan,
      sessionLogFile: args.sessionLog || repoPath('cocoder/SESSION_LOG.md'),
      runDir: args.runDir
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'record-supersession') {
    requireArgs(args, ['runDir', 'supersededLane', 'resolvingLane', 'basis', 'findings', 'evidence']);
    const result = await recordSupersession({
      runDir: args.runDir,
      supersededLane: args.supersededLane,
      resolvingLane: args.resolvingLane,
      authorizationBasis: args.basis,
      findingsAddressed: splitCliList(args.findings),
      supersessionEvidence: splitCliList(args.evidence),
      id: args.id,
      createdBy: args.createdBy,
      now: args.now || new Date().toISOString()
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'abort') {
    requireArgs(args, ['runDir']);
    const result = await abortRun(args.runDir, args.reason || 'aborted by orchestration core CLI');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'cleanup') {
    const runPaths = await resolveDefaultRunPaths(args);
    const result = await cleanupRuns({ runsDir: args.runsDir || runPaths.runsDir, dryRun: args.execute !== 'true' });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'list-runs') {
    const runPaths = await resolveDefaultRunPaths(args);
    const runsDir = args.runsDir || runPaths.runsDir;
    const runs = await safeListDirectories(runsDir);
    console.log(JSON.stringify({ ok: true, runsDir, runs }, null, 2));
    return;
  }

  if (command === 'prepare-debugger' || command === 'prepare-debug') {
    if (args.noSession !== 'true') requireArgs(args, ['sessionId']);
    const runPaths = await resolveDefaultRunPaths(args);
    const result = await prepareDebuggerSession({
      sessionId: args.sessionId,
      noSession: args.noSession === 'true',
      runsDir: args.runsDir || runPaths.runsDir,
      debuggerRunsDir: args.debuggerRunsDir || runPaths.debuggerRunsDir,
      tmuxBin: args.tmuxBin,
      repoRoot: process.cwd(),
      mode: args.mode || 'snapshot',
      followIntervalSeconds: args.followIntervalSeconds || 60
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'watch-debugger-evidence') {
    requireArgs(args, ['runDir', 'sessionId', 'debugDir']);
    const result = await followDebuggerEvidence({
      repoRoot: process.cwd(),
      runDir: args.runDir,
      sessionId: args.sessionId,
      debugDir: args.debugDir,
      tmuxBin: args.tmuxBin,
      followIntervalSeconds: Number(args.followIntervalSeconds || 60),
      maxCycles: Number(args.maxCycles || 0)
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command ${command}`);
}

async function safeListDirectories(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function handleConfig(tokens) {
  const [subcommand, key, value, ...rest] = tokens;
  const args = parseArgsAllowPositionals(rest);
  // M4.23 / Q2=A — install-root resolved via findCocoderHome ancestor walk (fail-closed)
  // instead of the legacy process.cwd() fallback. Explicit --cocoder-home wins.
  const cocoderHome = args.cocoderHome
    ? path.resolve(args.cocoderHome)
    : await resolveInstallRoot(process.cwd());
  if (subcommand === 'get') {
    // M4.5 (audit §H1): `config get` defaults to UNRESOLVED secret references so
    // `${env:OPENAI_API_KEY}` does not leak to stdout / JSON output. Pass
    // `--reveal-secrets true` to materialize values (useful when diagnosing
    // resolver issues).
    const revealSecrets = args.revealSecrets === 'true' || args.revealSecrets === true;
    const resolveOptions = {
      cocoderHome,
      workspaceRoot: args.workspaceRoot,
      resolveSecrets: revealSecrets
    };
    const result = key
      ? await getConfigValue(key, resolveOptions)
      : (await resolveConfig(resolveOptions)).config;
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (subcommand === 'set') {
    if (!key || value === undefined) {
      throw new Error('Usage: cocoder config set <key> <value> [--workspace-root <path>]');
    }
    // Q2=A — bare `config set` always writes install-local. --workspace-root opts into
    // the workspace-private zone (<workspace>/cocoder/local/config.yaml). --install is
    // accepted as a no-op alias for clarity.
    if (args.workspaceRoot) {
      const result = await setWorkspaceConfigValue(key, value, {
        workspaceRoot: args.workspaceRoot
      });
      console.log(JSON.stringify({ ok: true, file: result.filePath, zone: result.zone }, null, 2));
      return;
    }
    const result = await setInstallConfigValue(key, value, { cocoderHome });
    console.log(JSON.stringify({ ok: true, file: result.filePath, zone: result.zone }, null, 2));
    return;
  }
  throw new Error('Usage: cocoder config get [key] [--workspace-root <path>] | config set <key> <value> [--workspace-root <path>]');
}

function trimCompatibility(result) {
  return {
    ok: result.ok,
    status: result.status,
    profile: result.profile.id,
    route: result.route.id,
    lanes: result.lanes,
    issues: result.issues
  };
}

function parseArgs(tokens) {
  const args = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument ${token}`);
    const key = toCamel(token.slice(2));
    const next = tokens[index + 1];
    if (!next || next.startsWith('--')) args[key] = 'true';
    else {
      args[key] = path.resolve(next);
      if (['contract', 'prioritySlug', 'status', 'reason', 'summary', 'runId', 'jobId', 'sessionId', 'confirmRunId', 'mode', 'followIntervalSeconds', 'maxCycles', 'execute', 'deferStart', 'stopTerminalSessions', 'founderApprovedTeardown', 'sessionLineLimit', 'owner', 'nonce', 'now', 'ttlMs', 'staleMs', 'timeoutMs', 'thresholdDays', 'maxChars', 'maxEntries', 'maxEntryLines', 'maxEntryChars', 'allowLive', 'cdpUrl', 'socketName', 'socketPath', 'lane', 'lanes', 'message', 'command', 'tmuxBin', 'noSession', 'supersededLane', 'resolvingLane', 'basis', 'findings', 'evidence', 'id', 'createdBy', 'personaPaths', 'sessionLog', 'topologyOption', 'requiredPersonas', 'autoAttachAddedLanes', 'workspaceSlug', 'developerMode', 'allowConcurrentPriorityRun', 'revealSecrets'].includes(key)) args[key] = next;
      index += 1;
    }
  }
  return args;
}

function parseArgsAllowPositionals(tokens) {
  const flags = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) continue;
    flags.push(token);
    if (tokens[index + 1] && !tokens[index + 1].startsWith('--')) {
      flags.push(tokens[index + 1]);
      index += 1;
    }
  }
  return parseArgs(flags);
}

function splitCliList(value) {
  if (!value) return [];
  return String(value).split(';').map((item) => item.trim()).filter(Boolean);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', reject);
  });
}

function compactTimestamp(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function requireArgs(args, required) {
  const missing = required.filter((key) => args[key] === undefined);
  if (missing.length > 0) throw new Error(`Missing required argument(s): ${missing.map((key) => `--${key}`).join(', ')}`);
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`CoCoder orchestration core CLI

Commands:
  config get [key] [--workspace-root PATH] [--cocoder-home PATH] [--reveal-secrets true]
  config set <key> <value> [--cocoder-home PATH]
  validate-contracts [--contracts-dir PATH]
  validate-file --contract ID --file PATH [--contracts-dir PATH]
  check-immutable-baseline [--baseline PATH]
  validate-adapters [--adapters-dir PATH] [--contracts-dir PATH]
  preflight-adapters [--adapters-dir PATH] [--contracts-dir PATH]
  validate-profiles [--profiles-dir PATH] [--contracts-dir PATH]
  validate-priority-boundaries [--priority-boundaries-dir PATH] [--contracts-dir PATH]
  validate-routes [--routes-dir PATH] [--contracts-dir PATH]
  validate-personas [--personas-dir PATH] [--contracts-dir PATH]
  check-persona-route-coverage [--personas-dir PATH] [--routes-dir PATH] [--contracts-dir PATH]
  check-persona-leakage [--personas-dir PATH]
  check-route-profile --profile PATH --route PATH [--adapters-dir PATH] [--contracts-dir PATH]
  compose-launch --profile PATH --route PATH --priority-slug SLUG [--priority-boundaries-dir PATH] [--priority-file PATH] [--session-log PATH]
  classify-teammate --state PATH [--now ISO] [--timeout-ms N]
  acquire-dispatch-lock --lock PATH --owner ID [--nonce VALUE] [--now ISO] [--ttl-ms N]
  release-dispatch-lock --lock PATH --owner ID --nonce VALUE
  check-dispatch-lock --lock PATH [--now ISO] [--stale-ms N]
  check-helper-policy --helper-plan PATH
  audit-write-boundary --boundary PATH --files PATH
  validate-verifier-packet --packet PATH
  gate-result --result PATH [--contracts-dir PATH]
  validate-session-start-flow --flow PATH [--contracts-dir PATH]
  evaluate-phase-transition-flow --flow PATH [--contracts-dir PATH]
  validate-talia-packet --packet PATH
  validate-quinn-packet --packet PATH [--contracts-dir PATH]
  evaluate-closeout-flow --flow PATH [--contracts-dir PATH]
  build-rollback-artifact --input PATH [--output PATH]
  build-abort-artifact --input PATH [--output PATH]
  validate-improvement-artifact --artifact PATH [--contracts-dir PATH]
  validate-improvements [--improvements-dir PATH] [--contracts-dir PATH]
  build-improvement-artifact --input PATH [--output PATH] [--contracts-dir PATH]
  check-stale-docs --docs PATH [--now ISO] [--contracts-dir PATH]
  build-autonomy-report --input PATH [--output PATH] [--contracts-dir PATH]
  run-acceptance-harness --output PATH [--profile PATH] [--route PATH] [--priority-boundaries-dir PATH] [--baseline PATH] [--cdp-url URL] [--allow-live true]
  launch --profile PATH --route PATH --priority-slug SLUG [--priority-boundaries-dir PATH] [--execute true] [--defer-start true] [--runs-dir PATH] [--socket-name NAME] [--socket-path PATH] [--tmux-bin PATH]
  list-runs [--runs-dir PATH]
  send-message --run-dir PATH --lane LANE (--message TEXT | --stdin) [--tmux-bin PATH]
  add-lanes --run-dir PATH --lanes LANE[,LANE] [--topology-option ID] [--required-personas Persona[,Persona]] [--reason TEXT] [--execute true] [--auto-attach-added-lanes false] [--tmux-bin PATH]
  stop-run --run-dir PATH --confirm-run-id RUN_ID [--execute true] [--tmux-bin PATH]
  create-run --profile PATH --route PATH --priority-slug SLUG [--priority-boundaries-dir PATH] [--runs-dir PATH] [--priority-file PATH] [--session-log PATH]
  set-status --run-dir PATH --status STATUS [--reason TEXT]
  add-evidence --run-dir PATH --evidence PATH
  ingest-result --run-dir PATH --job-id ID --result PATH [--prompt PATH] [--transcript PATH]
  closeout --run-dir PATH [--summary TEXT]
  finalize-run-status --run-dir PATH [--summary TEXT] [--contracts-dir PATH] [--process-continuation true] [--stop-terminal-sessions true --founder-approved-teardown true]
  orchestrator-commit --run-dir PATH --lane LANE --message TEXT [--result PATH] [--repo-root PATH] [--contracts-dir PATH]
  lead-support-commit --run-dir PATH --lane LANE --files PATH[,PATH...] --message TEXT [--reason TEXT] [--repo-root PATH]
  check-lane-git-policy --route PATH --lane LANE --command TEXT
  check-doc-refs --root PATH [--report PATH] [--persona-paths PATH[,PATH...]] [--decisions-dir PATH]
  check-adr-status-consistency --root PATH [--report PATH] [--decisions-dir PATH]
  check-doc-freshness --root PATH [--report PATH] [--decisions-dir PATH] [--threshold-days N] [--now ISO]
  check-write-authority --root PATH [--report PATH] [--raci PATH] [--boundaries-dir PATH] [--routes-dir PATH] [--personas-dir PATH]
  check-priorities-last-updated --root PATH [--report PATH] [--priority-file PATH] [--max-chars N] [--now ISO]
  check-session-log-hygiene --root PATH [--report PATH] [--session-log PATH] [--max-entries N] [--max-entry-lines N] [--max-entry-chars N] [--now ISO]
  check-persona-source-boundaries --root PATH [--report PATH] [--now ISO]
  check-handoff-consistency --priority-slug SLUG --plan PATH [--priority-file PATH] [--session-log PATH] [--run-dir PATH]
  record-supersession --run-dir PATH --superseded-lane LANE --resolving-lane LANE --basis route-policy|founder-authorization --findings "TEXT;TEXT" --evidence "TEXT;TEXT" [--id ID] [--created-by LANE]
  abort --run-dir PATH [--reason TEXT]
  cleanup [--runs-dir PATH] [--execute true]
  prepare-debugger --session-id ID [--mode snapshot|follow] [--follow-interval-seconds N] [--runs-dir PATH] [--debugger-runs-dir PATH] [--tmux-bin PATH]
  prepare-debugger --no-session true [--mode launch-failure|preflight|repo-audit] [--runs-dir PATH] [--debugger-runs-dir PATH] [--tmux-bin PATH]
  prepare-debug (alias for prepare-debugger)
  watch-debugger-evidence --run-dir PATH --session-id ID --debug-dir PATH [--follow-interval-seconds N] [--tmux-bin PATH] [--max-cycles N]
`);
}
