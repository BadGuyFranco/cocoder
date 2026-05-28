import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkOrchestrationFragmentation,
  summarizeOrchestrationFragmentationReport
} from '../checks/check-orchestration-fragmentation.mjs';

test('checkOrchestrationFragmentation flags ghost priority owners in route declarations', async () => {
  const fixture = await createFixture();
  try {
    await writePriorityFile(fixture.root, ['active-priority']);
    await writeRoute(fixture.root, 'limited', ['active-priority', 'ghost-priority']);
    await writeDecisionsIndex(fixture.root, {
      rows: [],
      pending: ''
    });

    const report = await checkOrchestrationFragmentation({ root: fixture.root });

    assert.equal(report.ok, false);
    assert.equal(report.summary.findingsByKind['ghost-priority'], 1);
    assert.deepEqual(report.findings.map((finding) => finding.kind), ['ghost-priority']);
    assert.equal(report.findings[0].routeId, 'limited');
    assert.equal(report.findings[0].slug, 'ghost-priority');
  } finally {
    await fixture.cleanup();
  }
});

test('checkOrchestrationFragmentation leaves clean routes and wildcard owners unflagged', async () => {
  const fixture = await createFixture();
  try {
    await writePriorityFile(fixture.root, ['active-priority']);
    await writeRoute(fixture.root, 'clean', ['active-priority']);
    await writeRoute(fixture.root, 'wildcard', ['*']);
    await writeDecisionsIndex(fixture.root, {
      rows: [],
      pending: ''
    });

    const report = await checkOrchestrationFragmentation({ root: fixture.root });

    assert.equal(report.ok, true);
    assert.equal(report.summary.routesScanned, 2);
    assert.equal(report.summary.findingsByKind['ghost-priority'], 0);
  } finally {
    await fixture.cleanup();
  }
});

test('checkOrchestrationFragmentation flags indexed ADRs whose files are absent', async () => {
  const fixture = await createFixture();
  try {
    await writePriorityFile(fixture.root, ['active-priority']);
    await writeRoute(fixture.root, 'clean', ['active-priority']);
    await writeDecisionsIndex(fixture.root, {
      rows: [
        '| [ADR-0001](./0001-missing.md) | Missing decision | accepted | 2026-05-28 |'
      ],
      pending: ''
    });

    const report = await checkOrchestrationFragmentation({ root: fixture.root });

    assert.equal(report.ok, false);
    assert.equal(report.summary.findingsByKind['dangling-adr'], 1);
    assert.equal(report.findings[0].kind, 'dangling-adr');
    assert.equal(report.findings[0].adr, 'ADR-0001');
    assert.equal(report.findings[0].sourceFile, 'cocoder/decisions/README.md');
  } finally {
    await fixture.cleanup();
  }
});

test('checkOrchestrationFragmentation does not flag pending/proposed reserved ADRs', async () => {
  const fixture = await createFixture();
  try {
    await writePriorityFile(fixture.root, ['active-priority']);
    await writeRoute(fixture.root, 'clean', ['active-priority']);
    await writeDecisionsIndex(fixture.root, {
      rows: [],
      pending: 'ADR-0010 is reserved on a design branch and deliberately file-absent.'
    });

    const report = await checkOrchestrationFragmentation({ root: fixture.root });

    assert.equal(report.ok, true);
    assert.equal(report.summary.pendingAdrReferences, 1);
    assert.equal(report.summary.findingsByKind['dangling-adr'], 0);
  } finally {
    await fixture.cleanup();
  }
});

test('checkOrchestrationFragmentation does not flag present indexed ADRs', async () => {
  const fixture = await createFixture();
  try {
    await writePriorityFile(fixture.root, ['active-priority']);
    await writeRoute(fixture.root, 'clean', ['active-priority']);
    await writeFile(
      path.join(fixture.root, 'cocoder/decisions/0002-present.md'),
      '# ADR-0002\n'
    );
    await writeDecisionsIndex(fixture.root, {
      rows: [
        '| [ADR-0002](./0002-present.md) | Present decision | accepted | 2026-05-28 |'
      ],
      pending: ''
    });

    const report = await checkOrchestrationFragmentation({ root: fixture.root });

    assert.equal(report.ok, true);
    assert.equal(report.summary.adrIndexRows, 1);
    assert.equal(report.summary.findingsByKind['dangling-adr'], 0);
    assert.match(summarizeOrchestrationFragmentationReport(report), /findings=0/);
  } finally {
    await fixture.cleanup();
  }
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cocoder-fragmentation-'));
  await mkdir(path.join(root, 'cocoder/routes'), { recursive: true });
  await mkdir(path.join(root, 'cocoder/decisions'), { recursive: true });
  await mkdir(path.join(root, 'cocoder/priorities'), { recursive: true });
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

async function writePriorityFile(root, slugs) {
  const lines = ['# Priorities', ''];
  for (const slug of slugs) {
    lines.push(`### [${slug}](./priorities/${slug}/README.md)`);
    lines.push('**Status:** Active');
    lines.push('');
  }
  await writeFile(path.join(root, 'cocoder/PRIORITIES.md'), `${lines.join('\n')}\n`);
}

async function writeRoute(root, id, supportedPriorityOwners) {
  await writeFile(
    path.join(root, `cocoder/routes/${id}.json`),
    `${JSON.stringify({ id, supportedPriorityOwners }, null, 2)}\n`
  );
}

async function writeDecisionsIndex(root, { rows, pending }) {
  const content = [
    '# Architecture Decision Records (ADRs)',
    '',
    '## Index',
    '',
    '| ID | Title | Status | Date |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## Pending / proposed',
    '',
    pending,
    ''
  ].join('\n');
  await writeFile(path.join(root, 'cocoder/decisions/README.md'), content);
}
