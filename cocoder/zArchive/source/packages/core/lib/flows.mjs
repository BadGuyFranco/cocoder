import { readJson, writeJson, pathExists } from './fs-utils.mjs';
import { auditWriteBoundary, evaluateResultGate, validateVerifierPacket } from './dispatch.mjs';
import { loadContracts, validateInstance } from './contracts.mjs';

export async function validateSessionStartFlow(flow, { contractsDir } = {}) {
  const issues = [];
  if (!flow.loadedDirectory) issues.push(issue('missing-loaded-directory', 'loaded directory handshake is required'));
  if (!flow.startupPacketPath || !(await pathExists(flow.startupPacketPath))) {
    issues.push(issue('missing-startup-packet', 'startup packet artifact is required'));
  }
  let startupPacket = null;
  if (flow.startupPacketPath && await pathExists(flow.startupPacketPath)) {
    startupPacket = await readJson(flow.startupPacketPath);
    if (!contractsDir) {
      issues.push(issue('missing-contracts-dir', 'startup packet contract validation requires contractsDir'));
    } else {
      const contracts = await loadContracts(contractsDir);
      const errors = validateInstance(contracts.get('startup-packet'), startupPacket);
      if (errors.length > 0) {
        issues.push(issue('startup-packet-invalid', errors.join('; ')));
      }
    }
    if (startupPacket.selectedPriority?.staleState !== 'active') {
      issues.push(issue('priority-not-active', `selected priority staleState=${startupPacket.selectedPriority?.staleState || 'unknown'}`));
    }
    if (!startupPacket.route?.id || !startupPacket.profileDigest) {
      issues.push(issue('missing-route-profile-metadata', 'startup packet must include route/profile metadata'));
    }
  }
  if (!Array.isArray(flow.extractionEvidence) || flow.extractionEvidence.length === 0) {
    issues.push(issue('missing-extraction-evidence', 'session start must record bounded extraction evidence'));
  }
  return {
    ok: issues.length === 0,
    flow: 'session-start',
    startupPacket,
    loadedDirectory: flow.loadedDirectory || '',
    gaps: flow.gaps || startupPacket?.gaps || [],
    issues
  };
}

export async function evaluatePhaseTransitionFlow(flow, { contractsDir }) {
  const issues = [];
  const resultGate = await evaluateResultGate({ resultPath: flow.resultPath || '', contractsDir });
  if (!resultGate.accepting) issues.push(issue('result-gate-blocked', resultGate.reasons.join('; ')));

  let verifier = null;
  if (flow.verifierPacketPath) {
    verifier = validateVerifierPacket(await readJson(flow.verifierPacketPath));
    if (!verifier.ok) {
      issues.push(issue('verifier-packet-invalid', verifier.issues.map((item) => `${item.code}: ${item.detail}`).join('; ')));
    }
  }

  let writeBoundary = null;
  if (flow.writeBoundary && Array.isArray(flow.filesChanged)) {
    writeBoundary = auditWriteBoundary({ ...flow.writeBoundary, filesChanged: flow.filesChanged });
    if (!writeBoundary.ok) {
      issues.push(issue('write-boundary-blocked', writeBoundary.issues.map((item) => `${item.code}: ${item.detail}`).join('; ')));
    }
  }

  for (const artifactPath of flow.requiredArtifacts || []) {
    if (!(await pathExists(artifactPath))) issues.push(issue('missing-artifact', `required artifact missing: ${artifactPath}`));
  }
  for (const field of ['teammateOutput', 'gitStatus', 'diff', 'tests']) {
    const artifactPath = flow.suppliedArtifacts?.[field];
    if (!artifactPath || !(await pathExists(artifactPath))) {
      issues.push(issue('missing-phase-artifact', `suppliedArtifacts.${field} must point to an existing artifact`));
    }
  }

  return {
    ok: issues.length === 0,
    flow: 'phase-transition',
    decision: transitionDecision(resultGate, issues),
    resultGate,
    verifier,
    writeBoundary,
    note: 'write-boundary audit uses supplied changed-file artifacts; live git diff capture is not implemented in Phase 8',
    issues
  };
}

export function validateTaliaAcceptancePacket(packet) {
  const issues = [];
  if (packet.persona !== 'talia') issues.push(issue('wrong-persona', 'Talia acceptance packet must target persona talia'));
  if (packet.canWrite !== false || packet.writePolicy !== 'read-only') {
    issues.push(issue('talia-write-violation', 'Talia acceptance packet must be read-only with canWrite=false'));
  }
  for (const field of ['specScope', 'acceptanceCriteria', 'evidenceRequests']) {
    if (!Array.isArray(packet[field]) || packet[field].length === 0) {
      issues.push(issue('missing-talia-scope', `${field} must be a non-empty array`));
    }
  }
  if (typeof packet.deterministicCheckHook !== 'string' || packet.deterministicCheckHook.trim() === '') {
    issues.push(issue('missing-deterministic-check-hook', 'Talia acceptance packet requires deterministicCheckHook'));
  }
  return { ok: issues.length === 0, flow: 'talia-acceptance', packet, issues };
}

export async function validateQuinnQaPacket(packet, { contractsDir }) {
  const issues = [];
  if (packet.persona !== 'quinn') issues.push(issue('wrong-persona', 'Quinn packet must target persona quinn'));
  if (packet.canWrite !== false || packet.writePolicy !== 'read-only') {
    issues.push(issue('quinn-write-violation', 'Quinn packet must be read-only with canWrite=false'));
  }
  if (!packet.task || typeof packet.task !== 'string') issues.push(issue('missing-quinn-task', 'Quinn packet requires a task string'));
  for (const capability of ['screenshot', 'dom', 'console', 'interaction']) {
    if (!Array.isArray(packet.requiredEvidence) || !packet.requiredEvidence.includes(capability)) {
      issues.push(issue('missing-quinn-evidence-request', `requiredEvidence must include ${capability}`));
    }
  }
  const contracts = await loadContracts(contractsDir);
  const evidenceContract = contracts.get('evidence');
  for (const evidence of packet.evidenceArtifacts || []) {
    const errors = validateInstance(evidenceContract, evidence);
    if (errors.length > 0) issues.push(issue('quinn-evidence-invalid', `${evidence.id || 'evidence'}: ${errors.join('; ')}`));
  }
  const evidenceSources = new Set((packet.evidenceArtifacts || []).map((item) => item.source));
  if (evidenceSources.has('local-dev') && packet.evidenceClassClaim === 'A') {
    issues.push(issue('quinn-class-a-overclaim', 'local-dev Quinn evidence cannot claim Class A'));
  }
  const typedEvidence = (packet.evidenceArtifacts || []).filter((item) => item.kind || item.type);
  if (typedEvidence.length > 0) {
    const evidenceKinds = new Set(typedEvidence.map((item) => item.kind || item.type));
    for (const capability of ['screenshot', 'dom', 'console', 'interaction']) {
      if (!evidenceKinds.has(capability)) {
        issues.push(issue('missing-quinn-typed-evidence', `evidenceArtifacts kind/type must include ${capability}`));
      }
    }
  }
  return { ok: issues.length === 0, flow: 'quinn-ide-qa', packet, issues };
}

export async function evaluateCloseoutFlow(flow, { contractsDir }) {
  const issues = [];
  if (flow.docsFresh !== true) issues.push(issue('stale-docs', 'closeout requires docsFresh=true'));
  if (!Array.isArray(flow.verification) || flow.verification.length === 0) {
    issues.push(issue('missing-verification', 'closeout requires verification entries'));
  }
  for (const verification of flow.verification || []) {
    if (verification.status !== 'PASS') issues.push(issue('verification-not-pass', `${verification.name || 'verification'} status=${verification.status || 'missing'}`));
  }
  for (const resultPath of flow.resultPaths || []) {
    const gate = await evaluateResultGate({ resultPath, contractsDir });
    if (!gate.accepting) issues.push(issue('result-not-accepting', `${resultPath}: ${gate.status}`));
  }
  if ((flow.resultPaths || []).length === 0) issues.push(issue('missing-result-files', 'closeout requires result files'));
  if (Array.isArray(flow.oldReferenceDiffs) && flow.oldReferenceDiffs.length > 0) {
    issues.push(issue('old-reference-drift', `old reference drift: ${flow.oldReferenceDiffs.join(', ')}`));
  }
  for (const gate of flow.classAGates || []) {
    if (gate.met !== true) issues.push(issue('class-a-gate-unmet', `${gate.name || 'Class A gate'} is unmet`));
  }
  if (flow.writeBoundary && Array.isArray(flow.filesChanged)) {
    const writeBoundary = auditWriteBoundary({ ...flow.writeBoundary, filesChanged: flow.filesChanged });
    if (!writeBoundary.ok) issues.push(issue('write-boundary-blocked', writeBoundary.issues.map((item) => item.detail).join('; ')));
  }
  return { ok: issues.length === 0, flow: 'closeout', decision: issues.length === 0 ? 'complete' : 'blocked', issues };
}

export async function buildRecoveryArtifact(input, { type, outputPath } = {}) {
  const issues = [];
  if (!['rollback', 'abort'].includes(type)) issues.push(issue('invalid-recovery-type', 'type must be rollback or abort'));
  if (!input.reason) issues.push(issue('missing-reason', `${type} artifact requires a reason`));
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) issues.push(issue('missing-evidence', `${type} artifact requires evidence`));
  if (!Array.isArray(input.recoveryInstructions) || input.recoveryInstructions.length === 0) {
    issues.push(issue('missing-recovery-instructions', `${type} artifact requires recovery instructions`));
  }
  const artifact = {
    type,
    createdAt: input.createdAt || new Date().toISOString(),
    reason: input.reason || '',
    evidence: input.evidence || [],
    recoveryInstructions: input.recoveryInstructions || [],
    owner: input.owner || 'bob',
    limitations: input.limitations || []
  };
  if (outputPath && issues.length === 0) await writeJson(outputPath, artifact);
  return { ok: issues.length === 0, artifact, outputPath: outputPath || '', issues };
}

function transitionDecision(resultGate, issues) {
  if (issues.length === 0) return 'accept';
  if (resultGate.status === 'NEEDS_FOUNDER') return 'founder-decision';
  return 'send-back';
}

function issue(code, detail) {
  return { code, severity: 'block', detail };
}
