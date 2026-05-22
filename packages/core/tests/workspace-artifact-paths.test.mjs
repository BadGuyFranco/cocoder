import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_WORKSPACE_SLUG,
  workspaceArtifactsRoot,
  workspaceCheckReportPath,
  workspaceDebuggerRunsRoot,
  workspaceRunsRoot
} from '../lib/paths.mjs';

// M4.25 / pending-decisions Q3=A.
// Ephemeral run/debug/check-report artifacts live in the install-local zone
// at `<install>/local/workspaces/<slug>/...` — never in the tracked
// `cocoder/runs/` or `cocoder/debug-runs/` tree.

test('default workspace slug is "default"', () => {
  assert.equal(DEFAULT_WORKSPACE_SLUG, 'default');
});

test('workspaceArtifactsRoot composes install + slug into install-local zone', () => {
  const home = '/some/install';
  assert.equal(
    workspaceArtifactsRoot({ cocoderHome: home, workspaceSlug: 'cocoder-dogfood' }),
    path.join(home, 'local', 'workspaces', 'cocoder-dogfood')
  );
});

test('workspaceArtifactsRoot falls back to the default slug', () => {
  assert.equal(
    workspaceArtifactsRoot({ cocoderHome: '/x' }),
    path.join('/x', 'local', 'workspaces', 'default')
  );
});

test('workspaceArtifactsRoot refuses to run without cocoderHome', () => {
  assert.throws(() => workspaceArtifactsRoot({ workspaceSlug: 'x' }), /requires cocoderHome/);
});

test('workspaceRunsRoot sits under the install-local artifacts dir', () => {
  assert.equal(
    workspaceRunsRoot({ cocoderHome: '/a/b', workspaceSlug: 'demo' }),
    path.join('/a/b', 'local', 'workspaces', 'demo', 'runs')
  );
});

test('workspaceDebuggerRunsRoot sits under the install-local artifacts dir', () => {
  assert.equal(
    workspaceDebuggerRunsRoot({ cocoderHome: '/a/b', workspaceSlug: 'demo' }),
    path.join('/a/b', 'local', 'workspaces', 'demo', 'debug-runs')
  );
});

test('workspaceCheckReportPath composes check-name + timestamp under the artifacts dir', () => {
  assert.equal(
    workspaceCheckReportPath({
      cocoderHome: '/a/b',
      workspaceSlug: 'demo',
      checkName: 'check-doc-refs',
      timestamp: '20260522T120000Z'
    }),
    path.join('/a/b', 'local', 'workspaces', 'demo', 'check-reports', 'check-doc-refs-20260522T120000Z', 'evidence', 'report.json')
  );
});

test('workspaceCheckReportPath rejects missing checkName / timestamp', () => {
  assert.throws(
    () => workspaceCheckReportPath({ cocoderHome: '/x', workspaceSlug: 'demo', timestamp: 'ts' }),
    /requires checkName/
  );
  assert.throws(
    () => workspaceCheckReportPath({ cocoderHome: '/x', workspaceSlug: 'demo', checkName: 'foo' }),
    /requires timestamp/
  );
});

test('artifact paths never leak into the tracked cocoder/ meta-project tree', () => {
  // Sanity check: the resolved paths must include `local/workspaces/<slug>/`
  // and must NOT include the legacy `cocoder/runs/` or `cocoder/debug-runs/`
  // patterns the audit (§H5) flagged as tracked-tree pollution.
  const samples = [
    workspaceRunsRoot({ cocoderHome: '/i', workspaceSlug: 's' }),
    workspaceDebuggerRunsRoot({ cocoderHome: '/i', workspaceSlug: 's' }),
    workspaceCheckReportPath({ cocoderHome: '/i', workspaceSlug: 's', checkName: 'c', timestamp: 't' })
  ];
  for (const sample of samples) {
    assert.ok(sample.includes(path.join('local', 'workspaces', 's')), `expected ${sample} to include local/workspaces/s/`);
    assert.ok(!sample.includes(path.join('cocoder', 'runs')), `${sample} must not include legacy cocoder/runs/`);
    assert.ok(!sample.includes(path.join('cocoder', 'debug-runs')), `${sample} must not include legacy cocoder/debug-runs/`);
  }
});
