import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createOzServer, OZ_CSRF_HEADER } from 'oz-daemon';

const DEFAULT_PORT = 7878;

async function makeSettingsFixture() {
  const cocoderHome = await mkdtemp(path.join(os.tmpdir(), 'cocoder-oz-settings-'));
  await mkdir(path.join(cocoderHome, 'templates/install-local'), { recursive: true });
  await mkdir(path.join(cocoderHome, 'local'), { recursive: true });
  await writeFile(
    path.join(cocoderHome, 'templates/install-local/config.example.yaml'),
    ['version: "0.1"', 'defaults:', '  adapter: codex'].join('\n')
  );
  return cocoderHome;
}

function hostHeader(port = DEFAULT_PORT) {
  return `127.0.0.1:${port}`;
}

async function sessionHeaders(app, token, port = DEFAULT_PORT) {
  const session = await app.inject({
    method: 'GET',
    url: '/auth/session',
    headers: { host: hostHeader(port) }
  });
  assert.equal(session.statusCode, 200);
  return {
    host: hostHeader(port),
    authorization: `Bearer ${token}`,
    [OZ_CSRF_HEADER]: session.json().csrfToken,
    'content-type': 'application/json'
  };
}

async function putSetting(app, token, body, port = DEFAULT_PORT) {
  return app.inject({
    method: 'PUT',
    url: '/settings',
    headers: await sessionHeaders(app, token, port),
    payload: body
  });
}

test('C-S5: PUT concrete value stores verbatim and GET returns it', async () => {
  const cocoderHome = await makeSettingsFixture();
  const { app, token } = await createOzServer({ cocoderHome, port: DEFAULT_PORT });

  const putResponse = await putSetting(app, token, {
    key: 'modelRoles.lead',
    value: 'codex-pro'
  });
  assert.equal(putResponse.statusCode, 200);

  const getResponse = await app.inject({
    method: 'GET',
    url: '/settings',
    headers: { host: hostHeader() }
  });
  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.json().config.modelRoles.lead, 'codex-pro');
  await app.close();
});

test('C-S5: PUT ${env:FOO} literal stores verbatim and GET returns the literal', async () => {
  const cocoderHome = await makeSettingsFixture();
  const { app, token } = await createOzServer({ cocoderHome, port: DEFAULT_PORT });
  const literal = '${env:OPENAI_API_KEY}';

  const putResponse = await putSetting(app, token, {
    key: 'secrets.openai',
    value: literal
  });
  assert.equal(putResponse.statusCode, 200);

  const getResponse = await app.inject({
    method: 'GET',
    url: '/settings',
    headers: { host: hostHeader() }
  });
  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.json().config.secrets.openai, literal);
  await app.close();
});

test('C-S5: GET never resolves secrets even when env var is set', async () => {
  const cocoderHome = await makeSettingsFixture();
  const literal = '${env:OZ_SETTINGS_LEAK_TEST_KEY}';
  await writeFile(
    path.join(cocoderHome, 'local/config.yaml'),
    ['secrets:', `  openai: "${literal}"`].join('\n')
  );

  const previous = process.env.OZ_SETTINGS_LEAK_TEST_KEY;
  process.env.OZ_SETTINGS_LEAK_TEST_KEY = 'sk-must-not-leak-through-get';
  try {
    const { app } = await createOzServer({ cocoderHome, port: DEFAULT_PORT });
    const getResponse = await app.inject({
      method: 'GET',
      url: '/settings',
      headers: { host: hostHeader() }
    });
    assert.equal(getResponse.statusCode, 200);
    assert.equal(getResponse.json().config.secrets.openai, literal);
    assert.doesNotMatch(JSON.stringify(getResponse.json()), /sk-must-not-leak-through-get/);
    await app.close();
  } finally {
    if (previous === undefined) delete process.env.OZ_SETTINGS_LEAK_TEST_KEY;
    else process.env.OZ_SETTINGS_LEAK_TEST_KEY = previous;
  }
});
