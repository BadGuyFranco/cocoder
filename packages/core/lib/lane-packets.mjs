import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readJson, writeJson } from './fs-utils.mjs';
import { safeName } from './lib-utils.mjs';
import { isTerminalRunStatusRecord } from './run-status.mjs';

export async function advanceLanePacket({ runDir, lane, reason = '', now = new Date().toISOString() } = {}) {
  if (!runDir) throw new Error('runDir is required');
  if (!lane) throw new Error('lane is required');

  const status = await readJson(path.join(runDir, 'status.json'));
  if (isTerminalRunStatusRecord(status)) {
    return blocked({ runDir, lane, reason: `run is terminal: ${status.status}` });
  }

  const launchPlan = await readJson(path.join(runDir, 'launch.json'));
  const session = (launchPlan.sessions || []).find((candidate) => candidate.lane === lane);
  if (!session) return blocked({ runDir, lane, reason: `No launched lane named ${lane}` });

  const resultPath = session.resultPath || path.join(runDir, 'jobs', safeName(lane), 'result.json');
  const markdownResultPath = session.markdownResultPath || path.join(runDir, 'jobs', safeName(lane), 'result.md');
  const existing = [];
  if (await pathExists(resultPath)) existing.push(resultPath);
  if (await pathExists(markdownResultPath)) existing.push(markdownResultPath);
  if (existing.length === 0) return blocked({ runDir, lane, reason: `lane ${lane} has no completed result pair to archive` });
  if (existing.length !== 2) {
    return blocked({
      runDir,
      lane,
      reason: `lane ${lane} has a partial result pair: ${existing.join(', ')}`
    });
  }

  const markdownStat = await stat(markdownResultPath);
  if (!markdownStat.isFile() || markdownStat.size === 0) {
    return blocked({ runDir, lane, reason: `lane ${lane} markdown result is empty: ${markdownResultPath}` });
  }

  const result = await readJson(resultPath);
  if (result.status !== 'PASS') {
    return blocked({ runDir, lane, reason: `lane ${lane} result status ${result.status || '<missing>'} is not archivable; only PASS packets can be advanced` });
  }

  const jobDir = path.join(runDir, 'jobs', safeName(lane));
  const ledgerPath = path.join(jobDir, 'packets.jsonl');
  const packetIndex = await nextPacketIndex(path.join(jobDir, 'packets'));
  const packetId = `packet-${String(packetIndex).padStart(4, '0')}`;
  const packetDir = path.join(jobDir, 'packets', packetId);
  const archivedResultPath = path.join(packetDir, 'result.json');
  const archivedMarkdownPath = path.join(packetDir, 'result.md');
  await mkdir(packetDir, { recursive: true });
  await copyFile(resultPath, archivedResultPath);
  await copyFile(markdownResultPath, archivedMarkdownPath);

  const record = {
    version: 1,
    lane,
    packetId,
    archivedAt: now,
    reason,
    status: result.status,
    filesChanged: Array.isArray(result.filesChanged) ? result.filesChanged : [],
    resultPath: path.relative(runDir, archivedResultPath),
    markdownResultPath: path.relative(runDir, archivedMarkdownPath),
    sourceResultPath: path.relative(runDir, resultPath),
    sourceMarkdownResultPath: path.relative(runDir, markdownResultPath)
  };
  await appendJsonl(ledgerPath, record);
  await appendJsonl(path.join(runDir, 'events.jsonl'), {
    createdAt: now,
    type: 'lane.packet.archived',
    lane,
    packetId,
    resultPath: record.resultPath,
    markdownResultPath: record.markdownResultPath,
    sourceResultPath: record.sourceResultPath,
    reason
  });

  await unlink(resultPath);
  await unlink(markdownResultPath);

  return {
    ok: true,
    status: 'advanced',
    runDir,
    lane,
    packetId,
    archivedResultPath,
    archivedMarkdownResultPath: archivedMarkdownPath,
    nextResultPath: resultPath,
    nextMarkdownResultPath: markdownResultPath,
    recordPath: ledgerPath
  };
}

export async function collectArchivedLanePacketResults({ runDir, launchPlan } = {}) {
  const records = [];
  for (const session of launchPlan?.sessions || []) {
    const ledgerPath = path.join(runDir, 'jobs', safeName(session.lane), 'packets.jsonl');
    if (!(await pathExists(ledgerPath))) continue;
    const raw = await readFile(ledgerPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        records.push({
          lane: session.lane,
          packetId: '',
          resultPath: ledgerPath,
          markdownResultPath: ledgerPath,
          result: null,
          issues: [`invalid packet ledger JSON: ${error.message}`]
        });
        continue;
      }
      const resultPath = resolveRunPath(runDir, record.resultPath);
      const markdownResultPath = resolveRunPath(runDir, record.markdownResultPath);
      const issues = [];
      let result = null;
      if (!(await pathExists(resultPath))) issues.push(`archived packet result missing: ${resultPath}`);
      if (!(await pathExists(markdownResultPath))) issues.push(`archived packet markdown missing: ${markdownResultPath}`);
      if (issues.length === 0) {
        try {
          result = await readJson(resultPath);
        } catch (error) {
          issues.push(error.message || String(error));
        }
      }
      records.push({
        lane: record.lane || session.lane,
        packetId: record.packetId || '',
        resultPath,
        markdownResultPath,
        result,
        record,
        issues
      });
    }
  }
  return records;
}

export function isArchivedLanePacketResultPath(runDir, lane, resultPath) {
  const relative = path.relative(path.resolve(runDir, 'jobs', safeName(lane), 'packets'), path.resolve(resultPath));
  return relative
    && !relative.startsWith('..')
    && !path.isAbsolute(relative)
    && /(^|[/\\])result\.json$/.test(relative);
}

function blocked({ runDir, lane, reason }) {
  return { ok: false, status: 'blocked', runDir, lane, reason };
}

async function nextPacketIndex(packetsDir) {
  try {
    const entries = await readdir(packetsDir, { withFileTypes: true });
    const indexes = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => /^packet-(\d+)$/.exec(entry.name)?.[1])
      .filter(Boolean)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value));
    return indexes.length === 0 ? 1 : Math.max(...indexes) + 1;
  } catch (error) {
    if (error.code === 'ENOENT') return 1;
    throw error;
  }
}

function resolveRunPath(runDir, value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.resolve(runDir, value);
}

async function appendJsonl(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { flag: 'a' });
}
