import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertLoopbackHost, createOzServer } from 'oz-daemon';

test('C-S1: rejects binding to 0.0.0.0', () => {
  assert.throws(() => assertLoopbackHost('0.0.0.0'), /127\.0\.0\.1 only/);
});

test('C-S1: rejects binding to ::', () => {
  assert.throws(() => assertLoopbackHost('::'), /127\.0\.0\.1 only/);
});

test('C-S1: createOzServer refuses non-loopback host before listen', async () => {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-bind-'));
  await assert.rejects(
    () => createOzServer({ cocoderHome, host: '0.0.0.0' }),
    /127\.0\.0\.1 only/
  );
});

test('C-S1: listens on 127.0.0.1 when started with a real socket', async () => {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-bind-'));
  const { app } = await createOzServer({ cocoderHome, port: 0 });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  assert.equal(address.address, '127.0.0.1');
  await app.close();
});
