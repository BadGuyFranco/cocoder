import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildOrchestrationServicePacket,
  executeOrchestrationServicePacket,
  listOrchestrationServices,
  validateOrchestrationServicePacket
} from '../lib/services.mjs';

const execFileAsync = promisify(execFile);
const coreRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractsDir = path.join(coreRoot, 'contracts');
const servicesDir = path.join(coreRoot, 'services');
const cliPath = path.join(coreRoot, 'cli.mjs');

test('orchestration service catalog separates admin services from personas', async () => {
  const loaded = await listOrchestrationServices({ servicesDir, contractsDir });
  assert.equal(loaded.ok, true, JSON.stringify(loaded.issues, null, 2));
  const services = loaded.services;
  const ids = services.map((service) => service.id);
  assert.ok(ids.includes('wrap-execution'));
  assert.ok(ids.includes('evidence-collation'));
  assert.ok(ids.includes('handoff-compaction'));
  assert.ok(ids.includes('startup-context-audit'));
  const wrap = services.find((service) => service.id === 'wrap-execution');
  assert.equal(wrap.mode, 'bounded-write');
  assert.equal(wrap.execution.preferredModelClass, 'fast-low-cost-editor');
  assert.deepEqual(services.filter((service) => service.mode === 'read-only').flatMap((service) => service.allowedWriteScopes), []);
});

test('wrap-execution service packet preserves Oscar decision authority and bounded writes', async () => {
  const fixture = await createRunFixture();
  try {
    const result = await buildOrchestrationServicePacket({
      serviceId: 'wrap-execution',
      runDir: fixture.runDir,
      request: {
        objective: 'Apply Oscar-approved Phase 2 closeout handoff.',
        oscarDecision: {
          disposition: 'continue',
          completedAtom: 'D4',
          nextAtom: 'P3.1'
        },
        allowedWrites: [
          'cocoder/PRIORITIES.md',
          'cocoder/SESSION_LOG.md',
          'cocoder/SESSION_LOG_ARCHIVE.md',
          'cocoder/plans/2026-05-24-file-state-rebuild-2.md'
        ],
        evidence: ['jobs/oscar/result.json']
      },
      contractsDir,
      servicesDir,
      now: '2026-05-27T12:00:00.000Z'
    });

    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.packet.decisionAuthority, 'oscar-only');
    assert.equal(result.packet.executionAuthority, 'orchestration-service');
    assert.equal(result.packet.mode, 'bounded-write');
    assert.equal(result.packet.run.prioritySlug, 'FILE-STATE-REBUILD-2');
    assert.equal(result.packet.run.lanes[0].resultStatus, 'PASS');
    assert.equal(result.packet.allowedWrites.includes('cocoder/plans/2026-05-24-file-state-rebuild-2.md'), true);
    assert.equal(result.packet.forbiddenDecisions.some((item) => item.includes('Do not decide priority order')), true);
    assert.equal(result.packet.execution.preferredModelClass, 'fast-low-cost-editor');

    const validation = await validateOrchestrationServicePacket(result.packet, { contractsDir, servicesDir });
    assert.equal(validation.ok, true, JSON.stringify(validation.issues, null, 2));
  } finally {
    await fixture.cleanup();
  }
});

test('service packet builder rejects write scope expansion and read-only writes', async () => {
  const fixture = await createRunFixture();
  try {
    const outOfScope = await buildOrchestrationServicePacket({
      serviceId: 'wrap-execution',
      runDir: fixture.runDir,
      request: {
        objective: 'Try to edit product code.',
        oscarDecision: { nextAtom: 'P3.1' },
        allowedWrites: ['packages/core/lib/launch.mjs']
      },
      contractsDir
    });
    assert.equal(outOfScope.ok, false);
    assert.equal(outOfScope.issues.some((issue) => issue.code === 'write-outside-service-scope'), true);

    const readOnly = await validateOrchestrationServicePacket({
      version: 1,
      id: 'bad-read-only',
      createdAt: '2026-05-27T12:00:00.000Z',
      serviceId: 'evidence-collation',
      mode: 'read-only',
      requestedBy: 'oscar',
      decisionAuthority: 'oscar-only',
      executionAuthority: 'orchestration-service',
      execution: { style: 'deterministic', preferredModelClass: 'none', fallback: 'ask-oscar' },
      run: { runId: 'run-fixture', runDir: fixture.runDir, status: 'running' },
      objective: 'Collect evidence.',
      allowedWrites: ['cocoder/SESSION_LOG.md'],
      forbiddenDecisions: ['Do not decide priority order.'],
      requiredChecks: ['source artifact existence'],
      resultContract: {
        statusValues: ['PASS'],
        mustReport: ['evidence'],
        mayEditOnlyAllowedWrites: false
      }
    }, { contractsDir, servicesDir });
    assert.equal(readOnly.ok, false);
    assert.equal(readOnly.issues.some((issue) => issue.code === 'read-only-service-has-writes'), true);

    const readOnlyRequest = await buildOrchestrationServicePacket({
      serviceId: 'startup-context-audit',
      runDir: fixture.runDir,
      request: {
        objective: 'Audit startup context without editing files.',
        allowedWrites: ['cocoder/PRIORITIES.md']
      },
      contractsDir,
      servicesDir
    });
    assert.equal(readOnlyRequest.ok, false);
    assert.equal(readOnlyRequest.issues.some((issue) => issue.code === 'read-only-service-requested-writes'), true);

    const implicitWriteScope = await buildOrchestrationServicePacket({
      serviceId: 'handoff-compaction',
      runDir: fixture.runDir,
      request: {
        objective: 'Compact handoff docs.',
        oscarDecision: { nextAtom: 'P3.1' }
      },
      contractsDir,
      servicesDir
    });
    assert.equal(implicitWriteScope.ok, false);
    assert.equal(implicitWriteScope.issues.some((issue) => issue.code === 'missing-allowed-writes'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('startup-context-audit service packet is read-only and preserves Oscar authority', async () => {
  const fixture = await createRunFixture();
  try {
    const result = await buildOrchestrationServicePacket({
      serviceId: 'startup-context-audit',
      runDir: fixture.runDir,
      request: {
        objective: 'Audit startup context budgets before Oscar reads large handoff files.',
        evidence: ['startup-packet.json', 'jobs/oscar/prompt.md']
      },
      contractsDir,
      servicesDir,
      now: '2026-05-27T12:00:00.000Z'
    });

    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.packet.serviceId, 'startup-context-audit');
    assert.equal(result.packet.mode, 'read-only');
    assert.equal(result.packet.decisionAuthority, 'oscar-only');
    assert.deepEqual(result.packet.allowedWrites, []);
    assert.equal(result.packet.resultContract.mayEditOnlyAllowedWrites, false);
    assert.ok(result.packet.constraints.includes('read-only service: do not edit files'));
  } finally {
    await fixture.cleanup();
  }
});

test('execute-service-packet runs a headless executor and accepts bounded writes', async () => {
  const fixture = await createGitRunFixture();
  try {
    const executorPath = await createFakeExecutor(fixture.tmp, {
      changedFile: 'cocoder/PRIORITIES.md',
      status: 'PASS'
    });
    const packet = await buildServicePacketForExecution(fixture);

    const result = await executeOrchestrationServicePacket({
      packet,
      repoRoot: fixture.tmp,
      contractsDir,
      servicesDir,
      executorCommand: executorPath,
      now: '2026-05-27T12:00:00.000Z'
    });

    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.status, 'PASS');
    assert.equal(result.nextAction, 'Return PASS service result to Oscar.');
    assert.equal(result.resultPath.endsWith('/services/handoff-compaction-run-fixture-20260527T120000Z/result.json'), true);
    assert.match(await readFile(result.transcriptPath, 'utf8'), /executorCommand:/);
  } finally {
    await fixture.cleanup();
  }
});

test('execute-service-packet blocks out-of-scope writes with Oscar-facing diagnosis', async () => {
  const fixture = await createGitRunFixture();
  try {
    const executorPath = await createFakeExecutor(fixture.tmp, {
      changedFile: 'outside.txt',
      status: 'PASS'
    });
    const packet = await buildServicePacketForExecution(fixture);

    const result = await executeOrchestrationServicePacket({
      packet,
      repoRoot: fixture.tmp,
      contractsDir,
      servicesDir,
      executorCommand: executorPath,
      now: '2026-05-27T12:00:00.000Z'
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'BLOCK');
    assert.equal(result.issues.some((issue) => issue.code === 'service-write-outside-allowed-writes'), true);
    assert.equal(
      result.nextAction,
      'Return diagnosis and proposed fix to Oscar; Oscar either fixes in scope or recommends an Orchestrator Debugger launch.'
    );
    assert.match(result.diagnosis, /deterministic validation blocked/);
  } finally {
    await fixture.cleanup();
  }
});

test('build-service-packet CLI writes a validated packet', async () => {
  const fixture = await createRunFixture();
  try {
    const requestPath = path.join(fixture.tmp, 'request.json');
    const outputPath = path.join(fixture.tmp, 'packet.json');
    await writeFile(requestPath, `${JSON.stringify({
      objective: 'Compact the handoff without changing Oscar decisions.',
      oscarDecision: { nextAtom: 'P3.1' },
      allowedWrites: ['cocoder/PRIORITIES.md', 'cocoder/plans/2026-05-24-file-state-rebuild-2.md']
    }, null, 2)}\n`);

    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      'build-service-packet',
      '--service', 'handoff-compaction',
      '--run-dir', fixture.runDir,
      '--request', requestPath,
      '--output', outputPath,
      '--services-dir', servicesDir,
      '--contracts-dir', contractsDir,
      '--now', '2026-05-27T12:00:00.000Z'
    ]);
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    const packet = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(packet.serviceId, 'handoff-compaction');
    assert.equal(packet.decisionAuthority, 'oscar-only');
  } finally {
    await fixture.cleanup();
  }
});

test('execute-service-packet CLI invokes configured headless executor', async () => {
  const fixture = await createGitRunFixture();
  try {
    const executorPath = await createFakeExecutor(fixture.tmp, {
      changedFile: 'cocoder/PRIORITIES.md',
      status: 'PASS'
    });
    const packet = await buildServicePacketForExecution(fixture);
    const packetPath = path.join(fixture.tmp, 'packet.json');
    await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`);

    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      'execute-service-packet',
      '--packet', packetPath,
      '--repo-root', fixture.tmp,
      '--executor-command', executorPath,
      '--services-dir', servicesDir,
      '--contracts-dir', contractsDir,
      '--now', '2026-05-27T12:00:00.000Z'
    ]);
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.status, 'PASS');
    assert.equal(result.serviceId, 'handoff-compaction');
  } finally {
    await fixture.cleanup();
  }
});

test('validate-orchestration-services CLI validates declaration files', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    'validate-orchestration-services',
    '--services-dir', servicesDir,
    '--contracts-dir', contractsDir
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.ok(result.services.includes('startup-context-audit'));
});

async function createGitRunFixture() {
  const fixture = await createRunFixture();
  await mkdir(path.join(fixture.tmp, 'cocoder/plans'), { recursive: true });
  await writeFile(path.join(fixture.tmp, 'cocoder/PRIORITIES.md'), '# Priorities\n');
  await writeFile(path.join(fixture.tmp, 'cocoder/SESSION_LOG.md'), '# Session Log\n');
  await writeFile(path.join(fixture.tmp, 'cocoder/plans/2026-05-24-file-state-rebuild-2.md'), '# Plan\n');
  await writeFile(path.join(fixture.tmp, 'outside.txt'), 'baseline\n');
  await execFileAsync('git', ['init'], { cwd: fixture.tmp });
  await execFileAsync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: fixture.tmp });
  await execFileAsync('git', ['config', 'user.name', 'Test Runner'], { cwd: fixture.tmp });
  await execFileAsync('git', ['add', '.'], { cwd: fixture.tmp });
  await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: fixture.tmp });
  return fixture;
}

async function buildServicePacketForExecution(fixture) {
  const result = await buildOrchestrationServicePacket({
    serviceId: 'handoff-compaction',
    runDir: fixture.runDir,
    request: {
      objective: 'Compact the handoff without changing Oscar decisions.',
      oscarDecision: { nextAtom: 'P3.1' },
      allowedWrites: ['cocoder/PRIORITIES.md']
    },
    contractsDir,
    servicesDir,
    now: '2026-05-27T12:00:00.000Z'
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  return result.packet;
}

async function createFakeExecutor(tmp, { changedFile, status }) {
  const executorPath = path.join(tmp, 'fake-service-executor.sh');
  await writeFile(executorPath, [
    '#!/bin/sh',
    'set -eu',
    `printf 'service update\\n' >> '${changedFile}'`,
    'cat > "$SERVICE_RESULT_PATH" <<\'JSON\'',
    JSON.stringify({
      status,
      serviceId: 'handoff-compaction',
      filesChanged: [changedFile],
      checksRun: ['fake-check'],
      evidence: ['fake executor wrote requested change'],
      residualRisk: [],
      diagnosis: 'fake executor completed',
      proposedFix: 'None.',
      nextAction: 'Return to Oscar.'
    }, null, 2),
    'JSON'
  ].join('\n'));
  await chmod(executorPath, 0o755);
  return executorPath;
}

async function createRunFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-services-'));
  const runDir = path.join(tmp, 'runs/run-fixture');
  await mkdir(path.join(runDir, 'jobs/oscar'), { recursive: true });
  await writeFile(path.join(runDir, 'status.json'), `${JSON.stringify({
    runId: 'run-fixture',
    status: 'running',
    terminal: false,
    routeId: 'claude-oscar-dynamic',
    jobs: {
      oscar: { status: 'PASS', persona: 'oscar', adapter: 'claude' }
    }
  }, null, 2)}\n`);
  await writeFile(path.join(runDir, 'launch.json'), `${JSON.stringify({
    runId: 'run-fixture',
    route: { id: 'claude-oscar-dynamic', lead: 'oscar' },
    sessions: [
      {
        lane: 'oscar',
        persona: 'oscar',
        adapter: 'claude',
        resultPath: path.join(runDir, 'jobs/oscar/result.json')
      }
    ]
  }, null, 2)}\n`);
  await writeFile(path.join(runDir, 'startup-packet.json'), `${JSON.stringify({
    selectedPriority: { slug: 'FILE-STATE-REBUILD-2' },
    route: { id: 'claude-oscar-dynamic' }
  }, null, 2)}\n`);
  return {
    tmp,
    runDir,
    cleanup: () => rm(tmp, { recursive: true, force: true })
  };
}
