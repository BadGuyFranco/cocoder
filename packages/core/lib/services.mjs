import path from 'node:path';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadContracts, validateInstance } from './contracts.mjs';
import { pathExists, readJson, writeJson } from './fs-utils.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_SERVICES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../services');
const FORBIDDEN_DECISIONS = [
  'Do not decide priority order.',
  'Do not decide architecture direction.',
  'Do not decide founder-gated scope.',
  'Do not declare an atom complete unless Oscar supplied that decision.',
  'Do not expand write scope beyond allowedWrites.',
  'Do not dispatch personas, launch lanes, or substitute model roles.'
];

export async function listOrchestrationServices({ servicesDir = DEFAULT_SERVICES_DIR, contractsDir } = {}) {
  return loadOrchestrationServiceDeclarations({ servicesDir, contractsDir });
}

export async function loadOrchestrationServiceDeclarations({ servicesDir = DEFAULT_SERVICES_DIR, contractsDir } = {}) {
  const issues = [];
  const services = [];
  const seen = new Set();
  const files = (await readdir(servicesDir))
    .filter((fileName) => fileName.endsWith('.json'))
    .sort();
  const declarationContract = contractsDir ? await readDeclarationContract(contractsDir, issues) : null;

  for (const fileName of files) {
    const filePath = path.join(servicesDir, fileName);
    let service = null;
    try {
      service = await readJson(filePath);
    } catch (error) {
      issues.push(issue('invalid-service-json', `${filePath}: ${error.message}`));
      continue;
    }
    if (declarationContract) {
      issues.push(...validateInstance(declarationContract, service).map((detail) => issue('service-declaration-contract-invalid', `${filePath}: ${detail}`)));
    }
    issues.push(...validateServiceDeclaration(service, fileName, seen));
    if (service?.id) seen.add(service.id);
    services.push(service);
  }
  return { ok: issues.length === 0, services, issues };
}

export async function buildOrchestrationServicePacket({
  serviceId,
  runDir,
  request,
  outputPath,
  contractsDir,
  servicesDir = DEFAULT_SERVICES_DIR,
  now = new Date().toISOString()
} = {}) {
  const catalog = await loadOrchestrationServiceDeclarations({ servicesDir, contractsDir });
  if (!catalog.ok) return failedPacketResult(catalog.issues);
  const service = serviceById(catalog.services, serviceId);
  if (!service) return failedPacketResult([issue('unknown-service', `unknown orchestration service: ${serviceId || ''}`)]);
  const normalizedRequest = typeof request === 'string' ? await readJson(request) : (request || {});
  const runContext = await readRunContext(runDir);
  const requestedWrites = normalizeStringArray(normalizedRequest.allowedWrites || normalizedRequest.filesAllowed || []);
  const allowedWrites = normalizeAllowedWrites(service, requestedWrites);
  const issues = [
    ...validateServiceRequest({ service, request: normalizedRequest, requestedWrites, allowedWrites }),
    ...runContext.issues
  ];
  const packet = {
    version: 1,
    id: normalizedRequest.id || `${service.id}-${safeId(runContext.run.runId || 'no-run')}-${compactTimestamp(now)}`,
    createdAt: now,
    serviceId: service.id,
    serviceLabel: service.label,
    mode: service.mode,
    execution: service.execution,
    requestedBy: normalizedRequest.requestedBy || 'oscar',
    decisionAuthority: 'oscar-only',
    executionAuthority: 'orchestration-service',
    run: runContext.run,
    objective: normalizedRequest.objective || service.purpose,
    oscarDecision: normalizedRequest.oscarDecision || {},
    allowedWrites,
    forbiddenDecisions: FORBIDDEN_DECISIONS,
    requiredChecks: service.requiredChecks,
    evidence: normalizeStringArray(normalizedRequest.evidence),
    constraints: [
      ...(service.mode === 'read-only' ? ['read-only service: do not edit files'] : ['bounded-write service: edit allowedWrites only']),
      ...normalizeStringArray(normalizedRequest.constraints)
    ],
    resultContract: {
      statusValues: ['PASS', 'BLOCK', 'NEEDS_FOUNDER', 'FAILED'],
      mustReport: ['filesChanged', 'checksRun', 'evidence', 'residualRisk', 'nextAction'],
      mayEditOnlyAllowedWrites: service.mode !== 'read-only'
    }
  };

  const contractIssues = contractsDir ? await validatePacketContract(packet, contractsDir) : [];
  issues.push(...contractIssues);
  const result = { ok: issues.length === 0, packet, issues };
  if (result.ok && outputPath) await writeJson(outputPath, packet);
  return result;
}

export async function validateOrchestrationServicePacket(packetOrPath, { contractsDir, servicesDir = DEFAULT_SERVICES_DIR } = {}) {
  const packet = typeof packetOrPath === 'string' ? await readJson(packetOrPath) : packetOrPath;
  const catalog = await loadOrchestrationServiceDeclarations({ servicesDir, contractsDir });
  const issues = [...catalog.issues];
  const service = catalog.ok ? serviceById(catalog.services, packet?.serviceId) : null;
  if (!service) issues.push(issue('unknown-service', `unknown orchestration service: ${packet?.serviceId || ''}`));
  if (service && packet.mode !== service.mode) issues.push(issue('service-mode-mismatch', `packet mode ${packet.mode || ''} does not match service ${service.mode}`));
  if (packet?.decisionAuthority !== 'oscar-only') issues.push(issue('invalid-decision-authority', 'decisionAuthority must be oscar-only'));
  if (packet?.executionAuthority !== 'orchestration-service') issues.push(issue('invalid-execution-authority', 'executionAuthority must be orchestration-service'));
  if (service) {
    const allowedWrites = normalizeStringArray(packet.allowedWrites);
    issues.push(...validateAllowedWrites(service, allowedWrites));
  }
  if (contractsDir) issues.push(...await validatePacketContract(packet, contractsDir));
  return { ok: issues.length === 0, packet, issues };
}

export async function executeOrchestrationServicePacket({
  packetPath,
  packet,
  repoRoot = process.cwd(),
  contractsDir,
  servicesDir = DEFAULT_SERVICES_DIR,
  executorCommand = 'cursor-agent',
  model,
  resultPath,
  transcriptPath,
  now = new Date().toISOString()
} = {}) {
  const loadedPacket = packet || await readJson(packetPath);
  const validation = await validateOrchestrationServicePacket(loadedPacket, { contractsDir, servicesDir });
  if (!validation.ok) {
    return serviceExecutionResult({
      ok: false,
      status: 'BLOCK',
      packet: loadedPacket,
      issues: validation.issues,
      diagnosis: 'Service packet validation failed.',
      proposedFix: 'Fix the service packet fields or ask Oscar to revise the service request.'
    });
  }

  const service = serviceById((await loadOrchestrationServiceDeclarations({ servicesDir, contractsDir })).services, loadedPacket.serviceId);
  const outputDir = path.join(loadedPacket.run.runDir, 'services', loadedPacket.id);
  await mkdir(outputDir, { recursive: true });
  const resolvedResultPath = resultPath || path.join(outputDir, 'result.json');
  const resolvedTranscriptPath = transcriptPath || path.join(outputDir, 'transcript.txt');
  const beforeState = await gitStatusMap(repoRoot);
  const prompt = renderServicePrompt({
    packet: loadedPacket,
    resultPath: resolvedResultPath,
    repoRoot
  });

  let stdout = '';
  let stderr = '';
  let executorError = null;
  try {
    const executed = await runServiceExecutor({
      executorCommand,
      prompt,
      repoRoot,
      resultPath: resolvedResultPath,
      packetPath,
      model
    });
    stdout = executed.stdout;
    stderr = executed.stderr;
  } catch (error) {
    executorError = error;
    stdout = error.stdout || '';
    stderr = error.stderr || error.message;
  }
  await writeFile(resolvedTranscriptPath, [
    `# Orchestration Service Transcript`,
    `createdAt: ${now}`,
    `serviceId: ${loadedPacket.serviceId}`,
    `executorCommand: ${executorCommand}`,
    '',
    '## STDOUT',
    stdout || '',
    '',
    '## STDERR',
    stderr || ''
  ].join('\n'));

  if (executorError) {
    return serviceExecutionResult({
      ok: false,
      status: 'FAILED',
      packet: loadedPacket,
      resultPath: resolvedResultPath,
      transcriptPath: resolvedTranscriptPath,
      issues: [issue('executor-failed', executorError.message)],
      diagnosis: 'The headless service executor failed before producing an accepted service result.',
      proposedFix: 'Oscar should inspect the transcript and either retry with a narrower packet or recommend an Orchestrator Debugger launch.'
    });
  }

  const serviceResult = await readServiceResult(resolvedResultPath, stdout);
  const resultIssues = validateServiceResult(serviceResult, loadedPacket);
  const afterState = await gitStatusMap(repoRoot);
  const writeIssues = auditServiceWrites({
    service,
    packet: loadedPacket,
    beforeState,
    afterState,
    ignoredPaths: [
      repoRelativePath(repoRoot, resolvedResultPath),
      repoRelativePath(repoRoot, resolvedTranscriptPath)
    ]
  });
  const issues = [...resultIssues, ...writeIssues];
  const status = issues.length > 0 ? 'BLOCK' : serviceResult.status;
  return serviceExecutionResult({
    ok: issues.length === 0 && status === 'PASS',
    status,
    packet: loadedPacket,
    serviceResult,
    resultPath: resolvedResultPath,
    transcriptPath: resolvedTranscriptPath,
    issues,
    diagnosis: issues.length > 0
      ? 'Service execution completed, but deterministic validation blocked acceptance.'
      : serviceResult.diagnosis || 'Service execution passed.',
    proposedFix: issues.length > 0
      ? 'Oscar should apply the proposed fix from the service result if it stays in scope; otherwise recommend an Orchestrator Debugger launch.'
      : serviceResult.proposedFix || 'None.'
  });
}

async function readDeclarationContract(contractsDir, issues) {
  const contracts = await loadContracts(contractsDir);
  const contract = contracts.get('orchestration-service-declaration');
  if (!contract) {
    issues.push(issue('missing-contract', 'orchestration-service-declaration contract is missing'));
    return null;
  }
  return contract;
}

function validateServiceDeclaration(service, fileName, seen) {
  const issues = [];
  if (!service || typeof service !== 'object' || Array.isArray(service)) {
    return [issue('invalid-service-declaration', `${fileName}: service declaration must be an object`)];
  }
  if (seen.has(service.id)) issues.push(issue('duplicate-service-id', `${service.id} is declared more than once`));
  if (service.id && fileName !== `${service.id}.json`) {
    issues.push(issue('service-file-id-mismatch', `${fileName} must match service id ${service.id}`));
  }
  if (service.mode === 'read-only' && normalizeStringArray(service.allowedWriteScopes).length > 0) {
    issues.push(issue('read-only-service-has-write-scopes', `${service.id} is read-only but declares allowedWriteScopes`));
  }
  if (service.mode === 'bounded-write' && normalizeStringArray(service.allowedWriteScopes).length === 0) {
    issues.push(issue('bounded-write-service-missing-scopes', `${service.id} must declare allowedWriteScopes`));
  }
  return issues;
}

function serviceById(services, serviceId) {
  return services.find((service) => service.id === serviceId) || null;
}

async function readRunContext(runDir) {
  const issues = [];
  if (!runDir) {
    return {
      run: { runId: '', runDir: '', status: 'unknown', terminal: false, lanes: [] },
      issues: [issue('missing-run-dir', 'runDir is required')]
    };
  }
  const resolvedRunDir = path.resolve(runDir);
  const statusPath = path.join(resolvedRunDir, 'status.json');
  const launchPath = path.join(resolvedRunDir, 'launch.json');
  const startupPacketPath = path.join(resolvedRunDir, 'startup-packet.json');
  const status = await readJsonIfExists(statusPath, issues);
  const launch = await readJsonIfExists(launchPath, issues);
  const startupPacket = await readJsonIfExists(startupPacketPath, issues);
  const sessions = Array.isArray(launch?.sessions) ? launch.sessions : [];
  return {
    run: {
      runId: status?.runId || launch?.runId || path.basename(resolvedRunDir),
      runDir: resolvedRunDir,
      routeId: status?.routeId || launch?.route?.id || startupPacket?.route?.id || null,
      prioritySlug: startupPacket?.selectedPriority?.slug || startupPacket?.resolvedWriteBoundary?.prioritySlug || null,
      status: status?.status || 'unknown',
      terminal: status?.terminal === true,
      lanes: sessions.map((session) => ({
        lane: session.lane,
        persona: session.persona,
        adapter: session.adapter,
        resultPath: session.resultPath,
        resultStatus: status?.jobs?.[session.lane]?.status || null
      }))
    },
    issues
  };
}

async function readJsonIfExists(filePath, issues) {
  if (!(await pathExists(filePath))) {
    issues.push(issue('missing-run-artifact', `missing run artifact: ${filePath}`));
    return null;
  }
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    issues.push(issue('invalid-json', `${filePath}: ${error.message}`));
    return null;
  }
}

function normalizeAllowedWrites(service, requested) {
  if (service.mode === 'read-only') return [];
  const values = normalizeStringArray(requested);
  return values;
}

async function runServiceExecutor({ executorCommand, prompt, repoRoot, resultPath, packetPath, model }) {
  const base = path.basename(executorCommand);
  if (base === 'cursor-agent' || base === 'cursor-agent.cmd') {
    const args = [
      '--print',
      '--trust',
      '--force',
      '--sandbox',
      'disabled',
      '--workspace',
      repoRoot
    ];
    if (model) args.push('--model', model);
    args.push(prompt);
    return execFileAsync(executorCommand, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        SERVICE_PACKET_PATH: packetPath || '',
        SERVICE_RESULT_PATH: resultPath
      },
      maxBuffer: 1024 * 1024 * 10
    });
  }

  return execFileAsync(executorCommand, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SERVICE_PACKET_PATH: packetPath || '',
      SERVICE_RESULT_PATH: resultPath,
      SERVICE_PROMPT: prompt
    },
    maxBuffer: 1024 * 1024 * 10
  });
}

function renderServicePrompt({ packet, resultPath, repoRoot }) {
  return [
    'You are executing a CoCoder orchestration service packet, not acting as a persona.',
    'Oscar owns all judgment. Do not change priority, scope, architecture, founder decisions, or atom completion.',
    `Workspace: ${repoRoot}`,
    `Write the service result JSON to: ${resultPath}`,
    '',
    'Hard rules:',
    '- Edit only files listed in allowedWrites. If the packet is read-only, edit nothing.',
    '- If checks fail, return status BLOCK with diagnosis and proposedFix for Oscar.',
    '- Always write non-empty diagnosis, proposedFix, and nextAction strings, including for PASS. For a clean PASS, use diagnosis like "Required checks passed." and proposedFix "None.".',
    '- If scope is missing or unsafe, do not improvise; return NEEDS_FOUNDER or BLOCK.',
    '- Do not run git commit unless the packet explicitly includes that as an allowed required check and the service instructions require it.',
    '',
    'Service result JSON shape:',
    '{ "status": "PASS|BLOCK|NEEDS_FOUNDER|FAILED", "serviceId": "...", "filesChanged": [], "checksRun": [], "evidence": [], "residualRisk": [], "diagnosis": "...", "proposedFix": "...", "nextAction": "..." }',
    '',
    'Packet:',
    JSON.stringify(packet, null, 2)
  ].join('\n');
}

async function readServiceResult(resultPath, stdout) {
  if (await pathExists(resultPath)) return readJson(resultPath);
  try {
    return JSON.parse(stdout);
  } catch {
    return {
      status: 'FAILED',
      serviceId: '',
      filesChanged: [],
      checksRun: [],
      evidence: [],
      residualRisk: [],
      diagnosis: 'Executor did not write result JSON and stdout was not JSON.',
      proposedFix: 'Ask Oscar to retry with a narrower service packet or launch the Orchestrator Debugger.',
      nextAction: 'Return failure to Oscar.'
    };
  }
}

function validateServiceResult(result, packet) {
  const issues = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return [issue('service-result-invalid', 'service result must be an object')];
  }
  if (!['PASS', 'BLOCK', 'NEEDS_FOUNDER', 'FAILED'].includes(result.status)) {
    issues.push(issue('service-result-status-invalid', 'service result status must be PASS, BLOCK, NEEDS_FOUNDER, or FAILED'));
  }
  if (result.serviceId !== packet.serviceId) {
    issues.push(issue('service-result-id-mismatch', `service result serviceId ${result.serviceId || ''} does not match packet ${packet.serviceId}`));
  }
  for (const field of ['filesChanged', 'checksRun', 'evidence', 'residualRisk']) {
    if (!Array.isArray(result[field])) issues.push(issue('service-result-field-invalid', `${field} must be an array`));
  }
  for (const field of ['diagnosis', 'proposedFix', 'nextAction']) {
    if (typeof result[field] !== 'string' || result[field].trim() === '') {
      issues.push(issue('service-result-field-invalid', `${field} must be a non-empty string`));
    }
  }
  if (result.status !== 'PASS' && (!result.diagnosis || !result.proposedFix)) {
    issues.push(issue('service-result-missing-diagnosis', 'non-PASS service results must include diagnosis and proposedFix'));
  }
  return issues;
}

function auditServiceWrites({ service, packet, beforeState, afterState, ignoredPaths = [] }) {
  const issues = [];
  const ignored = new Set(ignoredPaths.filter(Boolean).map((filePath) => normalizeScope(filePath)));
  const changed = changedSince(beforeState, afterState).filter((filePath) => !ignored.has(normalizeScope(filePath)));
  const allowed = service.mode === 'read-only' ? [] : packet.allowedWrites;
  if (service.mode === 'read-only' && changed.length > 0) {
    issues.push(issue('read-only-service-wrote-files', `read-only service changed files: ${changed.join(', ')}`));
  }
  for (const filePath of changed) {
    if (!matchesAnyScope(filePath, allowed)) {
      issues.push(issue('service-write-outside-allowed-writes', `${filePath} changed outside allowedWrites`));
    }
  }
  return issues;
}

function repoRelativePath(repoRoot, filePath) {
  if (!filePath) return '';
  const relativePath = path.relative(repoRoot, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return '';
  return relativePath;
}

function changedSince(beforeState, afterState) {
  const paths = new Set([...beforeState.keys(), ...afterState.keys()]);
  return [...paths].filter((filePath) => beforeState.get(filePath) !== afterState.get(filePath)).sort();
}

async function gitStatusMap(repoRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 5
    });
    const map = new Map();
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const filePath = line.slice(3).replace(/^"|"$/g, '');
      map.set(filePath, line.slice(0, 2));
    }
    return map;
  } catch {
    return new Map();
  }
}

function serviceExecutionResult({ ok, status, packet, serviceResult = null, resultPath = '', transcriptPath = '', issues = [], diagnosis, proposedFix }) {
  return {
    ok,
    status,
    serviceId: packet?.serviceId || null,
    packetId: packet?.id || null,
    resultPath,
    transcriptPath,
    serviceResult,
    issues,
    diagnosis,
    proposedFix,
    nextAction: ok
      ? 'Return PASS service result to Oscar.'
      : 'Return diagnosis and proposed fix to Oscar; Oscar either fixes in scope or recommends an Orchestrator Debugger launch.'
  };
}

function validateServiceRequest({ service, request, requestedWrites, allowedWrites }) {
  const issues = [];
  if (typeof request.objective !== 'string' || request.objective.trim() === '') {
    issues.push(issue('missing-objective', 'service request must include a concrete objective'));
  }
  if (service.mode === 'read-only' && requestedWrites.length > 0) {
    issues.push(issue('read-only-service-requested-writes', `read-only service ${service.id} request must not include allowedWrites`));
  }
  if (service.mode !== 'read-only' && (!request.oscarDecision || typeof request.oscarDecision !== 'object' || Array.isArray(request.oscarDecision))) {
    issues.push(issue('missing-oscar-decision', 'bounded-write services require an oscarDecision object'));
  }
  if (service.mode !== 'read-only' && requestedWrites.length === 0) {
    issues.push(issue('missing-allowed-writes', `bounded-write service ${service.id} request must name exact allowedWrites`));
  }
  issues.push(...validateAllowedWrites(service, allowedWrites));
  return issues;
}

function validateAllowedWrites(service, allowedWrites) {
  const issues = [];
  if (service.mode === 'read-only' && allowedWrites.length > 0) {
    issues.push(issue('read-only-service-has-writes', `read-only service ${service.id} cannot allow writes`));
  }
  for (const filePath of allowedWrites) {
    if (!matchesAnyScope(filePath, service.allowedWriteScopes)) {
      issues.push(issue('write-outside-service-scope', `${filePath} is outside service ${service.id} write scope`));
    }
  }
  return issues;
}

async function validatePacketContract(packet, contractsDir) {
  const contracts = await loadContracts(contractsDir);
  const contract = contracts.get('orchestration-service-packet');
  if (!contract) return [issue('missing-contract', 'orchestration-service-packet contract is missing')];
  return validateInstance(contract, packet).map((detail) => issue('contract-invalid', detail));
}

function matchesAnyScope(filePath, scopes) {
  if (!scopes || scopes.length === 0) return false;
  return scopes.some((scope) => matchesScope(filePath, scope));
}

function matchesScope(filePath, scope) {
  const normalizedPath = normalizeScope(filePath);
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope.includes('*')) return globToRegExp(normalizedScope).test(normalizedPath);
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}

function globToRegExp(scope) {
  const escaped = scope.split('*').map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${escaped}$`);
}

function normalizeScope(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\/+/, '').replace(/\/+$/g, '');
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function failedPacketResult(issues) {
  return { ok: false, packet: null, issues };
}

function issue(code, detail) {
  return { code, detail };
}

function safeId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'service';
}

function compactTimestamp(iso) {
  return String(iso || new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
