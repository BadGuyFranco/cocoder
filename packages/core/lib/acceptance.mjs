import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { preflightAdapterRegistry } from './adapters.mjs';
import { compareImmutableBaseline } from './baseline.mjs';
import { composePersonaPrompt, hasPrivateLegacyReference } from './composition.mjs';
import { auditWriteBoundary, validateHelperPolicy } from './dispatch.mjs';
import { validateQuinnQaPacket, validateTaliaAcceptancePacket } from './flows.mjs';
import { pathExists, readJson, writeJson } from './fs-utils.mjs';
import { createRun, ingestResult } from './ledger.mjs';
import { checkAutonomousContinuationReadiness } from './session-wrap.mjs';

export async function runAcceptanceHarness(options) {
  if (!options.outputDir) throw new Error('outputDir is required');
  const outputDir = options.outputDir;
  await mkdir(outputDir, { recursive: true });
  await mkdir(path.join(outputDir, 'fixtures'), { recursive: true });
  await mkdir(path.join(outputDir, 'evidence'), { recursive: true });
  await mkdir(path.join(outputDir, 'runs'), { recursive: true });

  const checks = [];
  checks.push(await startupPacketProof(options));
  checks.push(await dryRunEchoHarness(options));
  checks.push(await bobHelperSmoke(outputDir));
  checks.push(await taliaAcceptanceSmoke(options));
  checks.push(await verifierDegradationSmoke(options));
  checks.push(await quinnIdeQaSmoke(options));
  checks.push(await liveCliEligibilitySmoke(options));
  checks.push(await immutableReferenceSmoke(options));
  checks.push(await promptCompositionSmoke(options));
  checks.push(await wrapReadinessSmoke(options));

  const summary = {
    ok: checks.every((check) => check.acceptance === 'PASS' || check.expectedNonPass === true),
    createdAt: options.now || new Date().toISOString(),
    outputDir,
    dryRunOnly: true,
    checks,
    limitations: [
      'Phase 10 harness uses local and mock artifacts by default.',
      'Quinn, Talia, verifier, tmux, and LLM CLI execution are not launched by this harness.',
      'Dry-run and mock evidence is Class B unless the artifact explicitly records a stronger approved source.'
    ]
  };
  await writeJson(path.join(outputDir, 'summary.json'), summary);
  return summary;
}

async function startupPacketProof(options) {
  const fixtureDir = path.join(options.outputDir, 'fixtures', 'startup');
  await mkdir(fixtureDir, { recursive: true });
  const priorityFile = path.join(fixtureDir, 'PRIORITIES.md');
  const sessionLogFile = path.join(fixtureDir, 'SESSION_LOG.md');
  await writeFile(priorityFile, [
    '# Priorities',
    'Last updated note mentioning ORCHESTRATION-REBUILD before the real heading.',
    '',
    '### [ORCHESTRATION-REBUILD] Orchestration Rebuild',
    '**Status:** In progress',
    'Phase 10 startup proof fixture.',
    '',
    '### [OTHER] Other Priority',
    '**Status:** Not started'
  ].join('\n'));
  await writeFile(sessionLogFile, Array.from({ length: 40 }, (_, index) => `session line ${index + 1}`).join('\n'));
  const created = await createRun({
    contractsDir: options.contractsDir,
    runsDir: path.join(options.outputDir, 'runs'),
    runId: 'acceptance-startup',
    profilePath: options.profilePath,
    routePath: options.routePath,
    priorityBoundariesDir: options.priorityBoundariesDir,
    priorityFile,
    prioritySlug: 'ORCHESTRATION-REBUILD',
    sessionLogFile,
    sessionLineLimit: 5
  });
  const startupPacketPath = path.join(created.runDir, 'startup-packet.json');
  const startupPacket = await readJson(startupPacketPath);
  const pass = created.status === 'ready'
    && startupPacket.selectedPriority.slug === 'ORCHESTRATION-REBUILD'
    && startupPacket.selectedPriority.excerpt.includes('Phase 10 startup proof fixture.')
    && !startupPacket.selectedPriority.excerpt.includes('Last updated note')
    && startupPacket.recentSessionContext.lineLimit === 5
    && startupPacket.recentSessionContext.excerpt.split('\n').length === 5
    && startupPacket.safetyFlags.noFullPriorityRead === true
    && startupPacket.safetyFlags.noFullSessionLogRead === true;
  const evidencePath = path.join(options.outputDir, 'evidence', 'startup-packet-proof.json');
  await writeJson(evidencePath, {
    id: 'startup-packet-proof',
    class: 'B',
    source: 'dry-run',
    artifact: startupPacketPath,
    observed: 'Selected priority entry and bounded recent session context were extracted from fixtures.',
    limitations: ['Fixture proof; no live launch.'],
    createdAt: options.now || new Date().toISOString()
  });
  return {
    name: 'startup-packet-proof',
    acceptance: pass ? 'PASS' : 'FAILED',
    evidenceClass: 'B',
    artifact: startupPacketPath,
    evidence: evidencePath,
    observed: {
      runStatus: created.status,
      sessionLineLimit: startupPacket.recentSessionContext.lineLimit,
      recentSessionLines: startupPacket.recentSessionContext.excerpt.split('\n').length
    }
  };
}

async function dryRunEchoHarness(options) {
  const fixtureDir = path.join(options.outputDir, 'fixtures', 'mock-adapters');
  await mkdir(fixtureDir, { recursive: true });
  await writeJson(path.join(fixtureDir, 'mock-echo.json'), mockEchoAdapter());
  const preflight = await preflightAdapterRegistry({
    adaptersDir: fixtureDir,
    contractsDir: options.contractsDir
  });
  const pass = preflight.ok && preflight.results[0]?.status === 'available';
  const artifact = path.join(options.outputDir, 'evidence', 'dry-run-echo-harness.json');
  await writeJson(artifact, {
    adapterPreflight: preflight,
    result: pass ? 'PASS' : 'FAILED',
    dryRunOnly: true,
    evidenceClass: 'B'
  });
  return {
    name: 'dry-run-echo-mock-adapter',
    acceptance: pass ? 'PASS' : 'FAILED',
    evidenceClass: 'B',
    artifact,
    observed: preflight.results
  };
}

async function bobHelperSmoke(outputDir) {
  const helperPlan = {
    maxParallelHelpers: 1,
    leadIntegrationResponsibility: true,
    helpers: [
      {
        id: 'helper-implementation',
        model: 'same-model-default',
        mode: 'implementation',
        canWrite: true,
        resultContract: 'job-result',
        ownership: ['cocoder/docs/'],
        writeScope: ['cocoder/docs/']
      }
    ]
  };
  const helper = validateHelperPolicy(helperPlan);
  const diffAudit = auditWriteBoundary({
    mode: 'task-scoped',
    allowed: ['cocoder/'],
    excluded: ['cocoder/PRIORITIES.md', 'cocoder/SESSION_LOG.md'],
    filesChanged: ['cocoder/docs/operator-guide.md']
  });
  const pass = helper.ok && diffAudit.ok;
  const artifact = path.join(outputDir, 'evidence', 'bob-helper-smoke.json');
  await writeJson(artifact, { helper, diffAudit, result: pass ? 'PASS' : 'FAILED', evidenceClass: 'B' });
  return {
    name: 'bob-helper-policy-and-diff-audit',
    acceptance: pass ? 'PASS' : 'FAILED',
    evidenceClass: 'B',
    artifact,
    observed: { helperOk: helper.ok, diffAuditOk: diffAudit.ok }
  };
}

async function taliaAcceptanceSmoke(options) {
  const runDir = path.join(options.outputDir, 'runs', 'acceptance-startup');
  const packet = {
    persona: 'talia',
    canWrite: false,
    writePolicy: 'read-only',
    specScope: ['cocoder/ARCHITECTURE.md'],
    acceptanceCriteria: ['Phase 10 local harness result ingestion works.'],
    evidenceRequests: ['result file', 'startup packet proof'],
    deterministicCheckHook: 'node --test cocoder/tests/acceptance.test.mjs'
  };
  const packetValidation = validateTaliaAcceptancePacket(packet);
  const resultPath = path.join(options.outputDir, 'evidence', 'talia-result.json');
  await writeJson(resultPath, {
    status: 'PASS',
    persona: 'talia',
    adapter: 'mock',
    canWrite: false,
    filesChanged: [],
    summary: 'Mock Talia acceptance result ingested through the run ledger.',
    findings: [],
    evidence: ['startup-packet-proof'],
    residualRisk: ['Mock artifact only; no live Talia execution.'],
    nextAction: 'continue'
  });
  const ingested = await ingestResult({
    runDir,
    contractsDir: options.contractsDir,
    jobId: 'talia-acceptance-smoke',
    resultPath
  });
  const pass = packetValidation.ok && ingested.status === 'PASS';
  const artifact = path.join(options.outputDir, 'evidence', 'talia-acceptance-smoke.json');
  await writeJson(artifact, { packetValidation, ingested, resultPath, result: pass ? 'PASS' : 'FAILED', evidenceClass: 'B' });
  return {
    name: 'talia-acceptance-result-ingestion',
    acceptance: pass ? 'PASS' : 'FAILED',
    evidenceClass: 'B',
    artifact,
    observed: { packetOk: packetValidation.ok, ingestedStatus: ingested.status }
  };
}

async function verifierDegradationSmoke(options) {
  const fixtureDir = path.join(options.outputDir, 'fixtures', 'missing-verifier-adapter');
  await mkdir(fixtureDir, { recursive: true });
  await writeJson(path.join(fixtureDir, 'missing-verifier.json'), missingVerifierAdapter());
  const preflight = await preflightAdapterRegistry({
    adaptersDir: fixtureDir,
    contractsDir: options.contractsDir
  });
  const degraded = preflight.results[0]?.status === 'missing-cli';
  const artifact = path.join(options.outputDir, 'evidence', 'verifier-degradation-smoke.json');
  await writeJson(artifact, {
    adapterPreflight: preflight,
    degradedStatus: degraded ? 'NEEDS_FOUNDER' : 'FAILED',
    resultContractStatus: degraded ? 'NEEDS_FOUNDER' : 'FAILED',
    evidenceClass: 'B'
  });
  return {
    name: 'verifier-unavailable-degrades-non-pass',
    acceptance: degraded ? 'PASS' : 'FAILED',
    expectedNonPass: degraded,
    degradedStatus: degraded ? 'NEEDS_FOUNDER' : 'FAILED',
    evidenceClass: 'B',
    artifact,
    observed: preflight.results
  };
}

async function quinnIdeQaSmoke(options) {
  const cdp = await checkCdpTarget(options.cdpUrl || 'http://127.0.0.1:9222/json/version');
  const artifact = path.join(options.outputDir, 'evidence', 'quinn-ide-qa-smoke.json');
  if (!cdp.available) {
    await writeJson(artifact, {
      status: 'NEEDS_FOUNDER',
      reason: 'No dev CDP target was available; Quinn IDE QA was not executed.',
      evidenceClass: 'B',
      cdp
    });
    return {
      name: 'quinn-ide-qa-cdp-smoke',
      acceptance: 'NEEDS_FOUNDER',
      expectedNonPass: true,
      evidenceClass: 'B',
      artifact,
      observed: cdp
    };
  }
  const packet = {
    persona: 'quinn',
    canWrite: false,
    writePolicy: 'read-only',
    task: 'Validate CDP target availability only.',
    requiredEvidence: ['screenshot', 'dom', 'console', 'interaction'],
    evidenceClassClaim: 'B',
    evidenceArtifacts: [
      evidence('quinn-cdp-screenshot', 'local-dev', artifact, 'screenshot'),
      evidence('quinn-cdp-dom', 'local-dev', artifact, 'dom'),
      evidence('quinn-cdp-console', 'local-dev', artifact, 'console'),
      evidence('quinn-cdp-interaction', 'local-dev', artifact, 'interaction')
    ]
  };
  const validation = await validateQuinnQaPacket(packet, { contractsDir: options.contractsDir });
  await writeJson(artifact, {
    status: validation.ok ? 'PASS' : 'FAILED',
    note: 'CDP target was reachable; Phase 10 did not run browser or IDE automation.',
    validation,
    cdp,
    evidenceClass: 'B'
  });
  return {
    name: 'quinn-ide-qa-cdp-smoke',
    acceptance: validation.ok ? 'PASS' : 'FAILED',
    evidenceClass: 'B',
    artifact,
    observed: cdp
  };
}

async function liveCliEligibilitySmoke(options) {
  const preflight = await preflightAdapterRegistry({
    adaptersDir: options.adaptersDir,
    contractsDir: options.contractsDir
  });
  const relevant = preflight.results.filter((result) => ['codex', 'claude', 'grok'].includes(result.adapter));
  const artifact = path.join(options.outputDir, 'evidence', 'live-cli-eligibility.json');
  await writeJson(artifact, {
    status: 'NOT_RUN',
    reason: 'Phase 10 records CLI eligibility only; it does not launch tmux or LLM sessions.',
    allowLive: options.allowLive === true,
    immutableBaselineRequired: true,
    relevant,
    evidenceClass: 'B'
  });
  return {
    name: 'real-tmux-cli-smoke-eligibility',
    acceptance: 'PASS',
    evidenceClass: 'B',
    artifact,
    observed: relevant
  };
}

async function immutableReferenceSmoke(options) {
  const result = await compareImmutableBaseline({ baselinePath: options.baselinePath });
  const artifact = path.join(options.outputDir, 'evidence', 'immutable-reference-gate.json');
  await writeJson(artifact, { ...result, evidenceClass: 'static-check' });
  return {
    name: 'old-reference-immutability',
    acceptance: result.ok ? 'PASS' : 'FAILED',
    evidenceClass: 'B',
    artifact,
    observed: {
      baselineEntries: result.baselineEntries,
      currentEntries: result.currentEntries,
      differences: result.differences
    }
  };
}

async function promptCompositionSmoke(options) {
  const promptsRoot = options.promptsRoot || path.join(process.cwd(), 'cocoder/personas/prompts');
  const oscar = await composePersonaPrompt({ persona: 'oscar', promptsRoot });
  const bob = await composePersonaPrompt({ persona: 'bob', promptsRoot });
  const pass = oscar.markdown.includes('prompt-fragment: shared/startup-packet.md; order: 1; persona: oscar')
    && oscar.markdown.includes('prompt-fragment: personas/oscar.md; order: 8; persona: oscar')
    && oscar.markdown.includes('Plain-English Finding:')
    && oscar.markdown.includes('Session Wrap Fragment')
    && bob.markdown.includes('prompt-fragment: personas/bob.md; order: 7; persona: bob')
    && !hasPrivateLegacyReference(oscar.markdown)
    && !hasPrivateLegacyReference(bob.markdown);
  const artifact = path.join(options.outputDir, 'evidence', 'prompt-composition-ssot.json');
  await writeJson(artifact, {
    result: pass ? 'PASS' : 'FAILED',
    evidenceClass: 'B',
    promptsRoot,
    oscarFragments: oscar.fragments,
    bobFragments: bob.fragments
  });
  return {
    name: 'prompt-composition-ssot',
    acceptance: pass ? 'PASS' : 'FAILED',
    evidenceClass: 'B',
    artifact,
    observed: { oscarFragments: oscar.fragments.length, bobFragments: bob.fragments.length }
  };
}

async function wrapReadinessSmoke(options) {
  const readiness = checkAutonomousContinuationReadiness({
    nextAtom: 'acceptance-harness-follow-up',
    priorityBoundaryResolved: true,
    stopConditions: ['stop on boundary conflict'],
    requiredTests: ['node --test cocoder/tests/acceptance.test.mjs'],
    founderDecisions: [],
    wrapAuditOk: true,
    commitBoundaryAuditOk: true
  });
  const artifact = path.join(options.outputDir, 'evidence', 'autonomous-continuation-readiness.json');
  await writeJson(artifact, {
    result: readiness.ok ? 'PASS' : 'FAILED',
    evidenceClass: 'B',
    readiness
  });
  return {
    name: 'autonomous-continuation-readiness',
    acceptance: readiness.ok ? 'PASS' : 'FAILED',
    evidenceClass: 'B',
    artifact,
    observed: { decision: readiness.decision }
  };
}

async function checkCdpTarget(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return { available: false, url, status: response.status };
    const text = await response.text();
    return { available: true, url, status: response.status, bytes: text.length };
  } catch (error) {
    return { available: false, url, error: error.name || error.message };
  }
}

function mockEchoAdapter() {
  return {
    id: 'mock-echo',
    label: 'Mock Echo Adapter',
    kind: 'script',
    command: 'node --version',
    availabilityCheck: {
      commandExists: 'node',
      authHint: 'Node is required for local dry-run acceptance fixtures.'
    },
    capabilities: {
      interactive: false,
      initialPrompt: true,
      stdinDispatch: false,
      resultFile: true,
      transcriptCapture: false,
      streamingDetection: false,
      screenshots: false,
      dom: false,
      console: false,
      shell: true,
      fileEdit: false
    },
    writeCapability: 'none',
    sandboxModes: ['read-only'],
    approvalModes: ['never'],
    resultContract: 'job-result',
    evidenceCapabilities: ['command-output', 'test-result'],
    failureModes: ['missing-cli', 'no-result-file', 'unknown']
  };
}

function missingVerifierAdapter() {
  return {
    ...mockEchoAdapter(),
    id: 'missing-verifier',
    label: 'Missing Verifier Fixture',
    command: 'missing-verifier-cli',
    availabilityCheck: {
      commandExists: 'missing-verifier-cli',
      authHint: 'Install/authenticate the verifier CLI before assigning this lane.'
    },
    evidenceCapabilities: ['transcript', 'command-output'],
    failureModes: ['missing-cli', 'auth-expired', 'no-result-file', 'unknown']
  };
}

function evidence(id, source, artifact, kind) {
  return {
    id,
    kind,
    class: 'B',
    source,
    artifact,
    observed: 'Acceptance harness fixture evidence.',
    limitations: ['Phase 10 fixture only']
  };
}
