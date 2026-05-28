import path from 'node:path';
import { runAcceptanceHarness } from '../lib/acceptance.mjs';
import { loadAdapterDeclarations, preflightAdapterRegistry } from '../lib/adapters.mjs';
import { compareImmutableBaseline } from '../lib/baseline.mjs';
import { checkAdrStatusConsistency, summarizeAdrStatusReport } from '../checks/check-adr-status-consistency.mjs';
import { checkDocFreshness, summarizeDocFreshnessReport } from '../checks/check-doc-freshness.mjs';
import { checkDocRefs, summarizeDocRefReport } from '../checks/check-doc-refs.mjs';
import { checkPersonaSourceBoundaries, summarizePersonaSourceBoundaryReport } from '../checks/check-persona-source-boundaries.mjs';
import { checkPrioritiesLastUpdated, summarizePrioritiesLastUpdatedReport } from '../checks/check-priorities-last-updated.mjs';
import { checkSessionLogHygiene, summarizeSessionLogHygieneReport } from '../checks/check-session-log-hygiene.mjs';
import { checkWriteAuthority, summarizeWriteAuthorityReport } from '../checks/check-write-authority.mjs';
import { checkRouteProfileCompatibility, composeLaunchDryRun, validateProfileDirectory, validateRouteDirectory } from '../lib/composition.mjs';
import { processRunContinuation } from '../lib/continuation.mjs';
import { loadContracts, validateContractFiles, validateInstance } from '../lib/contracts.mjs';
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
} from '../lib/dispatch.mjs';
import {
  buildRecoveryArtifact,
  evaluateCloseoutFlow,
  evaluatePhaseTransitionFlow,
  validateQuinnQaPacket,
  validateSessionStartFlow,
  validateTaliaAcceptancePacket
} from '../lib/flows.mjs';
import { readJson, repoPath } from '../lib/fs-utils.mjs';
import { advanceLanePacket } from '../lib/lane-packets.mjs';
import { addLanesToRun, launchRun, sendMessageToLane, stopRunSessions } from '../lib/launch.mjs';
import { recordSupersession } from '../lib/lead-rescue.mjs';
import { abortRun, addEvidence, cleanupRuns, closeoutRun, createRun, finalizeRunStatusFromResults, ingestResult, setRunStatus } from '../lib/ledger.mjs';
import { compactTimestamp, parseBooleanFlag } from '../lib/lib-utils.mjs';
import { commitAcceptedResult, commitLeadSupportChange, evaluateLaneGitPolicy } from '../lib/orchestrator-commit.mjs';
import { checkPersonaRouteCoverage, scanPersonaPrivateReferenceLeakage, validatePersonaDirectory } from '../lib/personas.mjs';
import { validatePriorityBoundaryDirectory } from '../lib/priority-boundaries.mjs';
import { checkHandoffConsistencyFromFiles } from '../lib/session-wrap.mjs';
import {
  buildAutonomyReport,
  buildImprovementArtifact,
  evaluateStaleDocs,
  validateImprovementArtifact,
  validateImprovementDirectory
} from '../lib/self-healing.mjs';
import { followDebuggerEvidence, prepareDebuggerSession } from '../lib/debugger.mjs';
import {
  buildOrchestrationServicePacket,
  executeOrchestrationServicePacket,
  listOrchestrationServices,
  runOrchestrationServiceForRun,
  validateOrchestrationServicePacket
} from '../lib/services.mjs';
import { applyWorkspaceInit } from '../lib/init-merge.mjs';
import { auditWorkspace, refreshWorkspaceMemory } from '../lib/workspace-audit.mjs';
import { ozSubcommandHandlers } from './oz.mjs';
import { assertExplicitWorkspaceContextWhenInsideInstall, resolveInstallRoot } from '../lib/paths.mjs';
import {
  DEFAULT_ADAPTERS_DIR,
  DEFAULT_BASELINE,
  DEFAULT_CONTRACTS_DIR,
  DEFAULT_SERVICES_DIR,
  DEFAULT_IMPROVEMENTS_DIR,
  DEFAULT_PERSONAS_DIR,
  DEFAULT_PRIORITY_BOUNDARIES_DIR,
  DEFAULT_PROFILES_DIR,
  DEFAULT_ROUTES_DIR,
  readStdin,
  requireArgs,
  resolveDefaultRunPaths,
  safeListDirectories,
  splitCliList,
  splitCsv,
  trimCompatibility
} from './shared.mjs';

async function handle_validate_contracts(args) {
    const result = await validateContractFiles(args.contractsDir || DEFAULT_CONTRACTS_DIR);
    if (result.failures.length > 0) {
      console.log(JSON.stringify({ ok: false, failures: result.failures }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ ok: true, contracts: result.contracts.map((contract) => contract.contract) }, null, 2));
    return;
}

async function handle_validate_file(args) {
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

async function handle_check_immutable_baseline(args) {
    const result = await compareImmutableBaseline({ baselinePath: args.baseline || DEFAULT_BASELINE });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_validate_adapters(args) {
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

async function handle_preflight_adapters(args) {
    const result = await preflightAdapterRegistry({
      adaptersDir: args.adaptersDir || DEFAULT_ADAPTERS_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_validate_profiles(args) {
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

async function handle_validate_routes(args) {
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

async function handle_validate_priority_boundaries(args) {
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

async function handle_validate_personas(args) {
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

async function handle_check_persona_route_coverage(args) {
    const result = await checkPersonaRouteCoverage({
      personasDir: args.personasDir || DEFAULT_PERSONAS_DIR,
      routesDir: args.routesDir || DEFAULT_ROUTES_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_check_persona_leakage(args) {
    const result = await scanPersonaPrivateReferenceLeakage({
      personasDir: args.personasDir || DEFAULT_PERSONAS_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_check_route_profile(args) {
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

async function handle_compose_launch(args) {
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

async function handle_classify_teammate(args) {
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

async function handle_acquire_dispatch_lock(args) {
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

async function handle_release_dispatch_lock(args) {
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

async function handle_check_dispatch_lock(args) {
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

async function handle_check_helper_policy(args) {
    requireArgs(args, ['helperPlan']);
    const result = validateHelperPolicy(await readJson(args.helperPlan));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_audit_write_boundary(args) {
    requireArgs(args, ['boundary', 'files']);
    const boundary = await readJson(args.boundary);
    const filesChanged = await readJsonList(args.files);
    const result = auditWriteBoundary({ ...boundary, filesChanged });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_validate_verifier_packet(args) {
    requireArgs(args, ['packet']);
    const result = validateVerifierPacket(await readJson(args.packet));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_gate_result(args) {
    requireArgs(args, ['result']);
    const result = await evaluateResultGate({
      resultPath: args.result,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.accepting) process.exitCode = 1;
    return;
}

async function handle_validate_session_start_flow(args) {
    requireArgs(args, ['flow']);
    const result = await validateSessionStartFlow(await readJson(args.flow), { contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_evaluate_phase_transition_flow(args) {
    requireArgs(args, ['flow']);
    const result = await evaluatePhaseTransitionFlow(await readJson(args.flow), { contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_validate_talia_packet(args) {
    requireArgs(args, ['packet']);
    const result = validateTaliaAcceptancePacket(await readJson(args.packet));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_validate_quinn_packet(args) {
    requireArgs(args, ['packet']);
    const result = await validateQuinnQaPacket(await readJson(args.packet), { contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_evaluate_closeout_flow(args) {
    requireArgs(args, ['flow']);
    const result = await evaluateCloseoutFlow(await readJson(args.flow), { contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_build_rollback_artifact(args) {
    requireArgs(args, ['input']);
    const result = await buildRecoveryArtifact(await readJson(args.input), { type: 'rollback', outputPath: args.output });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_build_abort_artifact(args) {
    requireArgs(args, ['input']);
    const result = await buildRecoveryArtifact(await readJson(args.input), { type: 'abort', outputPath: args.output });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_validate_improvement_artifact(args) {
    requireArgs(args, ['artifact']);
    const result = await validateImprovementArtifact(args.artifact, { contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_validate_improvements(args) {
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

async function handle_build_improvement_artifact(args) {
    requireArgs(args, ['input']);
    const result = await buildImprovementArtifact(await readJson(args.input), {
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      outputPath: args.output
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_check_stale_docs(args) {
    requireArgs(args, ['docs']);
    const result = await evaluateStaleDocs(await readJson(args.docs), {
      now: args.now || new Date().toISOString(),
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_build_autonomy_report(args) {
    requireArgs(args, ['input']);
    const result = await buildAutonomyReport(await readJson(args.input), {
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      outputPath: args.output
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_run_acceptance_harness(args) {
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

async function handle_launch(args) {
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
      attach: args.attach === 'iterm' ? 'iterm' : 'none',
      allowConcurrentPriorityRun: args.allowConcurrentPriorityRun === 'true'
    });
    console.log(JSON.stringify(result, null, 2));
    // Best-effort visible attach: open the iTerm2/Terminal split-pane window for
    // this run. Detached so it never blocks; the tmux sessions are already live,
    // so if no GUI terminal is available the run still proceeds (attach manually
    // via result.attachCommands). Edge-layer side effect kept out of core.
    if (result.ok && result.attachLaunchScript) {
      try {
        const { spawn } = await import('node:child_process');
        const child = spawn('bash', [result.attachLaunchScript], { detached: true, stdio: 'ignore' });
        child.unref();
      } catch {
        // ignore — sessions are up; operator can attach manually.
      }
    }
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_send_message(args) {
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

async function handle_advance_lane_packet(args) {
    requireArgs(args, ['runDir', 'lane']);
    const result = await advanceLanePacket({
      runDir: args.runDir,
      lane: args.lane,
      reason: args.reason || ''
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_add_lanes(args) {
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

async function handle_stop_run(args) {
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

async function handle_create_run(args) {
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

async function handle_set_status(args) {
    requireArgs(args, ['runDir', 'status']);
    const result = await setRunStatus(args.runDir, args.status, args.reason);
    console.log(JSON.stringify(result, null, 2));
    return;
}

async function handle_add_evidence(args) {
    requireArgs(args, ['runDir', 'evidence']);
    const result = await addEvidence({ runDir: args.runDir, contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR, evidencePath: args.evidence });
    console.log(JSON.stringify(result, null, 2));
    return;
}

async function handle_ingest_result(args) {
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

async function handle_closeout(args) {
    requireArgs(args, ['runDir']);
    const result = await closeoutRun(args.runDir, args.summary || 'closed out by orchestration core CLI');
    console.log(JSON.stringify(result, null, 2));
    return;
}

async function handle_finalize_run_status(args) {
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

async function handle_orchestrator_commit(args) {
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

async function handle_lead_support_commit(args) {
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

async function handle_check_lane_git_policy(args) {
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

async function handle_check_doc_refs(args) {
    requireArgs(args, ['root']);
    const runPaths = await resolveDefaultRunPaths(args);
    const reportPath = args.report || runPaths.checkReportFor('check-doc-refs', compactTimestamp(new Date().toISOString()));
    const result = await checkDocRefs({
      root: args.root,
      reportPath,
      personaPaths: args.personaPaths ? args.personaPaths.split(',').map((item) => path.resolve(item.trim())).filter(Boolean) : undefined,
      decisionsDir: args.decisionsDir || repoPath('cocoder/decisions')
    });
    console.log(`${summarizeDocRefReport(result)} report=${reportPath}`);
    return;
}

async function handle_check_adr_status_consistency(args) {
    requireArgs(args, ['root']);
    const runPaths = await resolveDefaultRunPaths(args);
    const reportPath = args.report || runPaths.checkReportFor('check-adr-status-consistency', compactTimestamp(new Date().toISOString()));
    const result = await checkAdrStatusConsistency({
      root: args.root,
      reportPath,
      decisionsDirs: [args.decisionsDir || repoPath('cocoder/decisions')]
    });
    console.log(`${summarizeAdrStatusReport(result)} report=${reportPath}`);
    return;
}

async function handle_check_doc_freshness(args) {
    requireArgs(args, ['root']);
    const runPaths = await resolveDefaultRunPaths(args);
    const reportPath = args.report || runPaths.checkReportFor('check-doc-freshness', compactTimestamp(new Date().toISOString()));
    const result = await checkDocFreshness({
      root: args.root,
      reportPath,
      decisionsDirs: [args.decisionsDir || repoPath('cocoder/decisions')],
      thresholdDays: Number(args.thresholdDays || 30),
      now: args.now || new Date().toISOString()
    });
    console.log(`${summarizeDocFreshnessReport(result)} report=${reportPath}`);
    return;
}

async function handle_check_write_authority(args) {
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

async function handle_check_priorities_last_updated(args) {
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

async function handle_check_session_log_hygiene(args) {
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

async function handle_check_persona_source_boundaries(args) {
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

async function handle_check_handoff_consistency(args) {
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

async function handle_record_supersession(args) {
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

async function handle_abort(args) {
    requireArgs(args, ['runDir']);
    const result = await abortRun(args.runDir, args.reason || 'aborted by orchestration core CLI');
    console.log(JSON.stringify(result, null, 2));
    return;
}

async function handle_cleanup(args) {
    const runPaths = await resolveDefaultRunPaths(args);
    const result = await cleanupRuns({ runsDir: args.runsDir || runPaths.runsDir, dryRun: args.execute !== 'true' });
    console.log(JSON.stringify(result, null, 2));
    return;
}

async function handle_list_runs(args) {
    const runPaths = await resolveDefaultRunPaths(args);
    const runsDir = args.runsDir || runPaths.runsDir;
    const runs = await safeListDirectories(runsDir);
    console.log(JSON.stringify({ ok: true, runsDir, runs }, null, 2));
    return;
}

async function handle_prepare_debugger(args) {
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

async function handle_init(args) {
    requireArgs(args, ['workspaceRoot']);
    const cocoderHome = args.cocoderHome
      ? path.resolve(args.cocoderHome)
      : await resolveInstallRoot(process.cwd());
    const templateDir = path.resolve(args.templateDir || path.join(cocoderHome, 'templates/workspace-cocoder'));
    const workspaceRoot = path.resolve(args.workspaceRoot);
    const merge = args.merge === 'true';
    const result = await applyWorkspaceInit({ templateDir, workspaceRoot, merge });
    console.log(JSON.stringify({
      ok: true,
      cocoderHome,
      templateDir,
      workspaceRoot,
      merge,
      ...result
    }, null, 2));
    return;
}

async function handle_audit_workspace(args) {
    requireArgs(args, ['workspaceRoot']);
    const result = await auditWorkspace({ workspaceRoot: path.resolve(args.workspaceRoot) });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_refresh_memory(args) {
    requireArgs(args, ['workspaceRoot']);
    const result = await refreshWorkspaceMemory({ workspaceRoot: path.resolve(args.workspaceRoot) });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_watch_debugger_evidence(args) {
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

async function handle_oz() {
  throw new Error('Use: cocoder oz start|stop|status|register [--cocoder-home PATH]');
}

async function handle_list_orchestration_services(args) {
    const result = await listOrchestrationServices({
      servicesDir: args.servicesDir || DEFAULT_SERVICES_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_validate_orchestration_services(args) {
    const result = await listOrchestrationServices({
      servicesDir: args.servicesDir || DEFAULT_SERVICES_DIR,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR
    });
    console.log(JSON.stringify({ ok: result.ok, services: result.services.map((service) => service.id), issues: result.issues }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_build_service_packet(args) {
    requireArgs(args, ['service', 'runDir', 'request']);
    const result = await buildOrchestrationServicePacket({
      serviceId: args.service,
      runDir: args.runDir,
      request: args.request,
      outputPath: args.output,
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      servicesDir: args.servicesDir || DEFAULT_SERVICES_DIR,
      now: args.now || new Date().toISOString()
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_validate_service_packet(args) {
    requireArgs(args, ['packet']);
    const result = await validateOrchestrationServicePacket(args.packet, {
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      servicesDir: args.servicesDir || DEFAULT_SERVICES_DIR
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_execute_service_packet(args) {
    requireArgs(args, ['packet']);
    const result = await executeOrchestrationServicePacket({
      packetPath: args.packet,
      repoRoot: args.repoRoot || process.cwd(),
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      servicesDir: args.servicesDir || DEFAULT_SERVICES_DIR,
      executorCommand: args.executorCommand || 'cursor-agent',
      model: args.model,
      resultPath: args.result,
      transcriptPath: args.transcript,
      now: args.now || new Date().toISOString()
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

async function handle_run_orchestration_service(args) {
    requireArgs(args, ['service', 'runDir', 'request']);
    const result = await runOrchestrationServiceForRun({
      serviceId: args.service,
      runDir: args.runDir,
      request: args.request,
      repoRoot: args.repoRoot || process.cwd(),
      contractsDir: args.contractsDir || DEFAULT_CONTRACTS_DIR,
      servicesDir: args.servicesDir || DEFAULT_SERVICES_DIR,
      executorCommand: args.executorCommand || 'cursor-agent',
      model: args.model,
      execute: args.executeService === true || args.executeService === 'true',
      now: args.now || new Date().toISOString()
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
}

export { ozSubcommandHandlers };

export const commandRegistry = new Map([
  ['validate-contracts', handle_validate_contracts],
  ['validate-file', handle_validate_file],
  ['check-immutable-baseline', handle_check_immutable_baseline],
  ['validate-adapters', handle_validate_adapters],
  ['preflight-adapters', handle_preflight_adapters],
  ['validate-profiles', handle_validate_profiles],
  ['validate-routes', handle_validate_routes],
  ['validate-priority-boundaries', handle_validate_priority_boundaries],
  ['validate-personas', handle_validate_personas],
  ['check-persona-route-coverage', handle_check_persona_route_coverage],
  ['check-persona-leakage', handle_check_persona_leakage],
  ['check-route-profile', handle_check_route_profile],
  ['compose-launch', handle_compose_launch],
  ['classify-teammate', handle_classify_teammate],
  ['acquire-dispatch-lock', handle_acquire_dispatch_lock],
  ['release-dispatch-lock', handle_release_dispatch_lock],
  ['check-dispatch-lock', handle_check_dispatch_lock],
  ['check-helper-policy', handle_check_helper_policy],
  ['audit-write-boundary', handle_audit_write_boundary],
  ['validate-verifier-packet', handle_validate_verifier_packet],
  ['gate-result', handle_gate_result],
  ['validate-session-start-flow', handle_validate_session_start_flow],
  ['evaluate-phase-transition-flow', handle_evaluate_phase_transition_flow],
  ['validate-talia-packet', handle_validate_talia_packet],
  ['validate-quinn-packet', handle_validate_quinn_packet],
  ['evaluate-closeout-flow', handle_evaluate_closeout_flow],
  ['build-rollback-artifact', handle_build_rollback_artifact],
  ['build-abort-artifact', handle_build_abort_artifact],
  ['validate-improvement-artifact', handle_validate_improvement_artifact],
  ['validate-improvements', handle_validate_improvements],
  ['build-improvement-artifact', handle_build_improvement_artifact],
  ['check-stale-docs', handle_check_stale_docs],
  ['build-autonomy-report', handle_build_autonomy_report],
  ['run-acceptance-harness', handle_run_acceptance_harness],
  ['launch', handle_launch],
  ['send-message', handle_send_message],
  ['advance-lane-packet', handle_advance_lane_packet],
  ['add-lanes', handle_add_lanes],
  ['stop-run', handle_stop_run],
  ['create-run', handle_create_run],
  ['set-status', handle_set_status],
  ['add-evidence', handle_add_evidence],
  ['ingest-result', handle_ingest_result],
  ['init', handle_init],
  ['oz', handle_oz],
  ['audit-workspace', handle_audit_workspace],
  ['refresh-memory', handle_refresh_memory],
  ['closeout', handle_closeout],
  ['finalize-run-status', handle_finalize_run_status],
  ['orchestrator-commit', handle_orchestrator_commit],
  ['lead-support-commit', handle_lead_support_commit],
  ['check-lane-git-policy', handle_check_lane_git_policy],
  ['check-doc-refs', handle_check_doc_refs],
  ['check-adr-status-consistency', handle_check_adr_status_consistency],
  ['check-doc-freshness', handle_check_doc_freshness],
  ['check-write-authority', handle_check_write_authority],
  ['check-priorities-last-updated', handle_check_priorities_last_updated],
  ['check-session-log-hygiene', handle_check_session_log_hygiene],
  ['check-persona-source-boundaries', handle_check_persona_source_boundaries],
  ['check-handoff-consistency', handle_check_handoff_consistency],
  ['record-supersession', handle_record_supersession],
  ['abort', handle_abort],
  ['cleanup', handle_cleanup],
  ['list-runs', handle_list_runs],
  ['prepare-debugger', handle_prepare_debugger],
  ['prepare-debug', handle_prepare_debugger],
  ['watch-debugger-evidence', handle_watch_debugger_evidence],
  ['list-orchestration-services', handle_list_orchestration_services],
  ['validate-orchestration-services', handle_validate_orchestration_services],
  ['build-service-packet', handle_build_service_packet],
  ['validate-service-packet', handle_validate_service_packet],
  ['execute-service-packet', handle_execute_service_packet],
  ['run-orchestration-service', handle_run_orchestration_service],
]);

export const registeredCommandNames = [...commandRegistry.keys()].sort((a, b) => a.localeCompare(b));

export async function dispatchCommand(command, args) {
  const handler = commandRegistry.get(command);
  if (!handler) throw new Error(`Unknown command ${command}`);
  await handler(args);
}
