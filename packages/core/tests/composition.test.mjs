import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkRouteProfileCompatibility, composeCompatibility, composeLaunchDryRun, validateProfileDirectory, validateRouteDirectory } from '../lib/composition.mjs';

const repoRoot = path.resolve(process.cwd(), '../..');
const contractsDir = path.join(repoRoot, 'packages/core/contracts');
const committedProfilesDir = path.join(repoRoot, 'cocoder/profiles');
const committedRoutesDir = path.join(repoRoot, 'cocoder/routes');
const committedBoundariesDir = path.join(repoRoot, 'cocoder/priority-boundaries');

test('committed profiles and routes pass semantic directory validation', async () => {
  const profiles = await validateProfileDirectory({ profilesDir: committedProfilesDir, contractsDir });
  assert.equal(profiles.ok, true, JSON.stringify(profiles.failures, null, 2));

  const routes = await validateRouteDirectory({ routesDir: committedRoutesDir, contractsDir });
  assert.equal(routes.ok, true, JSON.stringify(routes.failures, null, 2));
});

test('committed Grok role references use grok-build explicitly', async () => {
  for (const fileName of ['cocoder-dogfood.profile.json']) {
    const profile = JSON.parse(await readFile(path.join(committedProfilesDir, fileName), 'utf8'));
    for (const ref of collectAdapterRefs(profile).filter((item) => item.adapter === 'grok')) {
      assert.equal(ref.adapterProfile, 'grok-build', `${fileName} has non-explicit Grok profile at ${ref.path}`);
    }
  }
});

test('committed active default route remains Oscar/Bob compatible', async () => {
  const profile = JSON.parse(await readFile(path.join(committedProfilesDir, 'cocoder-dogfood.profile.json'), 'utf8'));
  const route = JSON.parse(await readFile(path.join(committedRoutesDir, 'dogfood-port-tests.json'), 'utf8'));
  const result = composeCompatibility({
    profile,
    route,
    loaded: {
      adapters: [
        adapter('codex', { writeCapability: 'repo', shell: true, fileEdit: true })
      ],
      failures: []
    },
    preflight: {
      results: [
        { adapter: 'codex', status: 'available', reasons: [] }
      ]
    }
  });

  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.deepEqual(result.lanes.map((lane) => lane.lane), ['bob', 'talia']);
  assert.equal(result.lanes.some((lane) => lane.lane === 'phil'), false);
});

test('committed priority boundaries allow Oscar bootstrap route', async () => {
  for (const fileName of [
    'v0.1-foundation.boundary.json'
  ]) {
    const boundary = JSON.parse(await readFile(path.join(committedBoundariesDir, fileName), 'utf8'));
    assert.ok(
      boundary.routeIds.includes('dogfood-port-tests'),
      `${fileName} must allow the launcher default Oscar bootstrap route`
    );
  }
});

test('profile directory validation rejects missing lane paths and lane fields', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-profile-validation-'));
  try {
    const profilesDir = path.join(tmp, 'profiles');
    await mkdir(profilesDir, { recursive: true });
    const profile = happyProfile();
    delete profile.lanes.verifiers.primary;
    delete profile.lanes.bob.excludedWriteBoundary;
    profile.lanes.oscar.canWrite = 'false';
    await writeFile(path.join(profilesDir, 'bad.profile.json'), `${JSON.stringify(profile, null, 2)}\n`);

    const result = await validateProfileDirectory({ profilesDir, contractsDir });
    assert.equal(result.ok, false);
    const errors = result.failures.flatMap((failure) => failure.errors);
    assert.ok(errors.includes('missing required lane path verifiers.primary'));
    assert.ok(errors.includes('bob missing required lane field excludedWriteBoundary'));
    assert.ok(errors.includes('oscar.canWrite must be a boolean'));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('profile directory validation rejects invalid model role references', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-profile-model-roles-'));
  try {
    const profilesDir = path.join(tmp, 'profiles');
    await mkdir(profilesDir, { recursive: true });
    const profile = happyProfile();
    profile.modelRoles.planning.primary[0].lane = 'missing-lane';
    profile.modelRoles.research.primary = { adapter: '' };
    profile.modelRoles.substitutionPolicy = 'silent-substitution';
    await writeFile(path.join(profilesDir, 'bad.profile.json'), `${JSON.stringify(profile, null, 2)}\n`);

    const result = await validateProfileDirectory({ profilesDir, contractsDir });
    assert.equal(result.ok, false);
    const errors = result.failures.flatMap((failure) => failure.errors);
    assert.ok(errors.includes('modelRoles.planning.primary[0].lane references unknown lane missing-lane'));
    assert.ok(errors.includes('modelRoles.research.primary[0] must define lane or adapter'));
    assert.ok(errors.some((error) => error.includes('modelRoles.substitutionPolicy must be one of')));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('route directory validation rejects malformed laneRequirements shape', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-route-validation-'));
  try {
    const routesDir = path.join(tmp, 'routes');
    await mkdir(routesDir, { recursive: true });
    const route = buildRoute();
    delete route.laneRequirements.bob;
    route.laneRequirements.oscar.requiredCapabilities = 'initialPrompt';
    route.laneRequirements.oscar.requiresInteractive = 'true';
    await writeFile(path.join(routesDir, 'bad-route.json'), `${JSON.stringify(route, null, 2)}\n`);

    const result = await validateRouteDirectory({ routesDir, contractsDir });
    assert.equal(result.ok, false);
    const errors = result.failures.flatMap((failure) => failure.errors);
    assert.ok(errors.includes('missing laneRequirements entry for bob'));
    assert.ok(errors.includes('oscar.laneRequirements.requiredCapabilities must be an array when present'));
    assert.ok(errors.includes('oscar.laneRequirements.requiresInteractive must be a boolean when present'));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('route/profile compatibility passes for an available one-writer route', async () => {
  const fixture = await createCompositionFixture();
  try {
    const result = await checkRouteProfileCompatibility(await fixture.options({ profile: happyProfile(), route: buildRoute() }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.lanes.map((lane) => lane.lane), ['oscar', 'bob']);
    assert.equal(result.modelRoles.planning.primary[0].label, 'Claude Opus 4.7');
    assert.equal(result.modelRoles.planning.audit[0].adapter, 'writer-cli');
  } finally {
    await fixture.cleanup();
  }
});

test('route model roles override profile model roles during composition', async () => {
  const fixture = await createCompositionFixture();
  try {
    const route = buildRoute();
    route.modelRoles = {
      planning: {
        primary: [{ adapter: 'writer-cli', adapterProfile: 'gpt-5.5', label: 'Route Planning Override' }]
      }
    };
    const result = await checkRouteProfileCompatibility(await fixture.options({ profile: happyProfile(), route }));
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.modelRoles.planning.primary[0].label, 'Route Planning Override');
    assert.equal(result.modelRoles.planning.audit[0].label, 'Codex GPT-5.5');
  } finally {
    await fixture.cleanup();
  }
});

test('route/profile compatibility rejects missing adapters', async () => {
  const fixture = await createCompositionFixture();
  try {
    const profile = happyProfile();
    profile.lanes.bob.adapter = 'missing-adapter';
    const result = await checkRouteProfileCompatibility(await fixture.options({ profile, route: buildRoute() }));
    assert.equal(result.ok, false);
    assert.equal(result.issues.some((issue) => issue.code === 'missing-adapter'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('route/profile compatibility rejects unsupported adapters and auth unavailable adapters', async () => {
  const fixture = await createCompositionFixture();
  try {
    const unsupportedProfile = happyProfile();
    unsupportedProfile.lanes.oscar.adapter = 'future-cli';
    const unsupported = await checkRouteProfileCompatibility(await fixture.options({ profile: unsupportedProfile, route: singleLaneRoute('oscar') }));
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.issues.some((issue) => issue.code === 'unsupported-adapter'), true);

    const authProfile = happyProfile();
    authProfile.lanes.oscar.adapter = 'auth-cli';
    const auth = await checkRouteProfileCompatibility(await fixture.options({ profile: authProfile, route: singleLaneRoute('oscar') }));
    assert.equal(auth.ok, false);
    assert.equal(auth.issues.some((issue) => issue.code === 'auth-config-unavailable'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('route/profile compatibility rejects capability and write-policy conflicts', async () => {
  const fixture = await createCompositionFixture();
  try {
    const nonInteractive = happyProfile();
    nonInteractive.lanes.oscar.adapter = 'script-cli';
    const interactiveResult = await checkRouteProfileCompatibility(await fixture.options({ profile: nonInteractive, route: singleLaneRoute('oscar') }));
    assert.equal(interactiveResult.ok, false);
    assert.equal(interactiveResult.issues.some((issue) => issue.code === 'interactive-required'), true);

    const writerWithReadonly = happyProfile();
    writerWithReadonly.lanes.bob.adapter = 'readonly-cli';
    const writerResult = await checkRouteProfileCompatibility(await fixture.options({ profile: writerWithReadonly, route: buildRoute() }));
    assert.equal(writerResult.ok, false);
    assert.equal(writerResult.issues.some((issue) => issue.code === 'writer-with-readonly-adapter'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('read-only verifier lanes reject write-capable adapters unless explicitly allowed with writes disabled', async () => {
  const fixture = await createCompositionFixture();
  try {
    const blocked = await checkRouteProfileCompatibility(await fixture.options({
      profile: happyProfile(),
      route: verifierRoute({ allowWriteCapableAdapterWhenWritesDisabled: false })
    }));
    assert.equal(blocked.ok, false);
    assert.equal(blocked.issues.some((issue) => issue.code === 'verifier-writing-adapter-not-explicit'), true);

    const allowed = await checkRouteProfileCompatibility(await fixture.options({
      profile: happyProfile(),
      route: verifierRoute({ allowWriteCapableAdapterWhenWritesDisabled: true })
    }));
    assert.equal(allowed.ok, true, JSON.stringify(allowed.issues, null, 2));
  } finally {
    await fixture.cleanup();
  }
});

test('dry-run launch composition produces a startup packet without real launch', async () => {
  const fixture = await createCompositionFixture();
  try {
    const result = await composeLaunchDryRun({
      ...(await fixture.options({ profile: happyProfile(), route: buildRoute() })),
      priorityFile: fixture.priorityPath,
      prioritySlug: 'ORCHESTRATION-REBUILD',
      priorityBoundariesDir: fixture.boundariesDir,
      sessionLogFile: fixture.sessionLogPath,
      sessionLineLimit: 2
    });
    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.equal(result.status, 'ready');
    assert.equal(result.startupPacket.dryRun, true);
    assert.equal(result.priorityBoundary.id, 'orchestration-rebuild-boundary');
    assert.equal(result.modelRoles.research.primary[0].adapter, 'writer-cli');
    assert.equal(result.startupPacket.modelRoles.planning.primary[0].label, 'Claude Opus 4.7');
    assert.equal(result.startupPacket.safetyFlags.noRealLaunch, true);
    assert.equal(result.startupPacket.safetyFlags.noTmuxControl, true);
  } finally {
    await fixture.cleanup();
  }
});

test('dry-run launch composition surfaces missing required persona in startup packet', async () => {
  const fixture = await createCompositionFixture({
    priorityExtraLines: ['**Recommended next atom:** A1 - Phil authors the primitive scaffold.'],
    sessionLogText: 'Next Action: Owner: Phil. Atom: A1.'
  });
  try {
    const result = await composeLaunchDryRun({
      ...(await fixture.options({ profile: happyProfile(), route: buildRoute() })),
      priorityFile: fixture.priorityPath,
      prioritySlug: 'ORCHESTRATION-REBUILD',
      priorityBoundariesDir: fixture.boundariesDir,
      sessionLogFile: fixture.sessionLogPath,
      sessionLineLimit: 2
    });

    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.deepEqual(result.personaRouteAudit.requiredPersonas, ['phil']);
    assert.deepEqual(result.personaRouteAudit.missingPersonas, ['phil']);
    assert.equal(result.startupPacket.personaRouteAudit.missingPersonas.includes('phil'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('dry-run launch composition ignores historical persona mentions outside current action', async () => {
  const fixture = await createCompositionFixture({
    priorityStatus: 'Active. Tier 1 still dispatch-ready: a2-response-encoding (Bob-only). Founder-gated remaining: C3 Quinn-portion + Talia QA after Tier 1 drain. Ian was mentioned in historical process prose.',
    priorityExtraLines: [
      '**Owner:** Founder + Oscar + Bob/Codex + Phil',
      '**Process:** Phil built primitives earlier. Talia and Quinn verify later.',
      '**Recommended next atom:** a2-response-encoding - Bob-only packet.'
    ],
    sessionLogText: [
      '**Residual.** Quinn + Talia full suite remains founder-gated after Tier 1.',
      '**Next session should.** Launch fresh route and dispatch a2-response-encoding. Quinn/Talia full suite + C6 remain founder-gated.'
    ].join('\n')
  });
  try {
    const result = await composeLaunchDryRun({
      ...(await fixture.options({ profile: happyProfile(), route: buildRoute() })),
      priorityFile: fixture.priorityPath,
      prioritySlug: 'ORCHESTRATION-REBUILD',
      priorityBoundariesDir: fixture.boundariesDir,
      sessionLogFile: fixture.sessionLogPath,
      sessionLineLimit: 2
    });

    assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
    assert.deepEqual(result.personaRouteAudit.requiredPersonas, []);
    assert.deepEqual(result.personaRouteAudit.missingPersonas, []);
    assert.deepEqual(result.personaRouteAudit.packetOnlyPersonas, []);
    assert.deepEqual(result.personaRouteAudit.warnings, []);
  } finally {
    await fixture.cleanup();
  }
});

test('dry-run launch composition blocks matched-but-stale priorities', async () => {
  const fixture = await createCompositionFixture({
    priorityStatus: 'Superseded by another priority'
  });
  try {
    const result = await composeLaunchDryRun({
      ...(await fixture.options({ profile: happyProfile(), route: buildRoute() })),
      priorityFile: fixture.priorityPath,
      prioritySlug: 'ORCHESTRATION-REBUILD',
      priorityBoundariesDir: fixture.boundariesDir,
      sessionLogFile: fixture.sessionLogPath,
      sessionLineLimit: 2
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'stale');
    assert.equal(result.issues.some((issue) => issue.code === 'priority-not-active'), true);
  } finally {
    await fixture.cleanup();
  }
});

async function createCompositionFixture(options = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'cocoder-composition-'));
  const adaptersDir = path.join(tmp, 'adapters');
  const boundariesDir = path.join(tmp, 'priority-boundaries');
  const priorityPath = path.join(tmp, 'PRIORITIES.md');
  const sessionLogPath = path.join(tmp, 'SESSION_LOG.md');
  await mkdir(adaptersDir, { recursive: true });
  await mkdir(boundariesDir, { recursive: true });
  await writeFile(path.join(adaptersDir, 'writer-cli.json'), `${JSON.stringify(adapter('writer-cli', { writeCapability: 'repo', shell: true, fileEdit: true }), null, 2)}\n`);
  await writeFile(path.join(adaptersDir, 'readonly-cli.json'), `${JSON.stringify(adapter('readonly-cli'), null, 2)}\n`);
  await writeFile(path.join(adaptersDir, 'script-cli.json'), `${JSON.stringify(adapter('script-cli', { kind: 'script', interactive: false, initialPrompt: false, stdinDispatch: false, screenshots: true, dom: true, console: true }), null, 2)}\n`);
  await writeFile(path.join(adaptersDir, 'future-cli.json'), `${JSON.stringify(adapter('future-cli', { kind: 'future-cli', supported: false, interactive: false, initialPrompt: false, stdinDispatch: false }), null, 2)}\n`);
  await writeFile(path.join(adaptersDir, 'auth-cli.json'), `${JSON.stringify(adapter('auth-cli', { requiredEnv: ['COCODER_TEST_AUTH_MISSING'] }), null, 2)}\n`);
  await writeFile(path.join(boundariesDir, 'orchestration-rebuild.json'), `${JSON.stringify(priorityBoundary(), null, 2)}\n`);
  await writeFile(priorityPath, [
    '### [ORCHESTRATION-REBUILD] Orchestration Rebuild',
    `**Status:** ${options.priorityStatus || 'In progress'}`,
    'Expected next artifact: Phase 5 dry-run composition.',
    ...(options.priorityExtraLines || []),
    '',
    '### [NEXT] Next Priority'
  ].join('\n'));
  await writeFile(sessionLogPath, options.sessionLogText || ['older', 'recent one', 'recent two'].join('\n'));

  return {
    tmp,
    boundariesDir,
    priorityPath,
    sessionLogPath,
    options: async ({ profile, route }) => ({
      profilePath: await writeFixtureJson(tmp, 'profile.json', profile),
      routePath: await writeFixtureJson(tmp, 'route.json', route),
      adaptersDir,
      contractsDir,
      env: { PATH: process.env.PATH || '' }
    }),
    cleanup: () => rm(tmp, { recursive: true, force: true })
  };
}

async function writeFixtureJson(dir, name, value) {
  const filePath = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function happyProfile() {
  const lane = (persona, adapterId, canWrite = false) => ({
    persona,
    adapter: adapterId,
    canWrite,
    writeBoundary: canWrite ? ['packages/core/tests/'] : [],
    excludedWriteBoundary: [],
    resultContract: 'job-result',
    evidenceClassDefault: 'B'
  });
  return {
    id: 'test-profile',
    label: 'Test Profile',
    createdFor: 'ORCHESTRATION-REBUILD',
    lanes: {
      oscar: lane('oscar', 'writer-cli'),
      bob: lane('bob', 'writer-cli', true),
      ian: lane('ian', 'readonly-cli'),
      phil: lane('phil', 'readonly-cli'),
      talia: lane('talia', 'readonly-cli'),
      quinn: lane('quinn', 'script-cli'),
      verifiers: {
        primary: lane('verifier', 'writer-cli'),
        adversarial: lane('verifier', 'readonly-cli')
      },
      bobHelpers: {
        default: lane('bob-helper', 'readonly-cli'),
        readonlyResearch: lane('bob-helper', 'readonly-cli'),
        implementation: lane('bob-helper', 'writer-cli', true)
      }
    },
    modelRoles: {
      orchestrator: { lane: 'oscar', purpose: 'lead orchestration' },
      builder: { lane: 'bob', purpose: 'primary implementation' },
      builderSubagents: {
        primary: [{ adapter: 'writer-cli', adapterProfile: 'gpt-5.5', label: 'Codex GPT-5.5', purpose: 'coding subagents' }]
      },
      planning: {
        primary: [{ adapter: 'writer-cli', adapterProfile: 'opus-4.7', label: 'Claude Opus 4.7', purpose: 'priority-to-plan authoring' }],
        audit: [{ adapter: 'writer-cli', adapterProfile: 'gpt-5.5', label: 'Codex GPT-5.5', purpose: 'plan review' }]
      },
      research: {
        primary: [{ adapter: 'writer-cli', adapterProfile: 'gpt-5.5', label: 'Codex GPT-5.5', purpose: 'primary research' }],
        triangulation: [{ adapter: 'readonly-cli', adapterProfile: 'default', label: 'Grok', purpose: 'adversarial triangulation' }],
        synthesis: [{ lane: 'oscar', purpose: 'founder-facing synthesis' }]
      },
      fallbackPolicy: 'ask-founder',
      substitutionPolicy: 'strict'
    },
    defaults: {
      evidenceClass: 'B',
      maxParallelHelpers: 1,
      missingAdapterPolicy: 'needs_founder'
    }
  };
}

function buildRoute() {
  return {
    id: 'test-build-route',
    label: 'Test Build Route',
    lead: 'oscar',
    teammates: ['bob'],
    lanes: ['oscar', 'bob'],
    supportedPriorityOwners: ['ORCHESTRATION-REBUILD'],
    gates: ['startup-packet', 'profile-preflight', 'write-boundary'],
    writePolicy: 'one-writer',
    laneRequirements: {
      oscar: { requiresInteractive: true, requiredCapabilities: ['initialPrompt', 'stdinDispatch'] },
      bob: { requiresInteractive: true, requiredCapabilities: ['initialPrompt', 'stdinDispatch', 'fileEdit'] }
    }
  };
}

function priorityBoundary() {
  return {
    id: 'orchestration-rebuild-boundary',
    prioritySlug: 'ORCHESTRATION-REBUILD',
    label: 'Fixture ORCH boundary',
    routeIds: ['test-build-route'],
    writerLanes: {
      bob: {
        allowed: ['packages/core/tests/'],
        excluded: ['cocoder/PRIORITIES.md']
      }
    }
  };
}

function singleLaneRoute(lane) {
  return {
    id: `single-${lane}`,
    label: `Single ${lane}`,
    lead: lane,
    teammates: [],
    lanes: [lane],
    gates: ['startup-packet', 'profile-preflight'],
    writePolicy: 'read-only',
    laneRequirements: {
      [lane]: { requiresInteractive: true, requiredCapabilities: ['initialPrompt', 'stdinDispatch'] }
    }
  };
}

function verifierRoute(requirements) {
  return {
    id: 'verifier-route',
    label: 'Verifier Route',
    lead: 'oscar',
    teammates: ['verifier'],
    lanes: ['verifiers.primary'],
    gates: ['startup-packet', 'profile-preflight', 'verifier'],
    writePolicy: 'read-only',
    laneRequirements: {
      'verifiers.primary': {
        readOnlyVerifier: true,
        requiresInteractive: true,
        requiredCapabilities: ['initialPrompt', 'stdinDispatch'],
        ...requirements
      }
    }
  };
}

function collectAdapterRefs(value, pathLabel = '$') {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => collectAdapterRefs(child, `${pathLabel}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  const ownRef = typeof value.adapter === 'string' ? [{ path: pathLabel, adapter: value.adapter, adapterProfile: value.adapterProfile }] : [];
  return [
    ...ownRef,
    ...Object.entries(value).flatMap(([key, child]) => collectAdapterRefs(child, `${pathLabel}.${key}`))
  ];
}

function adapter(id, overrides = {}) {
  const kind = overrides.kind || 'llm-cli';
  return {
    id,
    label: id,
    kind,
    command: 'node',
    commandEnv: 'inherit',
    availabilityCheck: {
      commandExists: 'node',
      supported: overrides.supported,
      requiredEnv: overrides.requiredEnv || [],
      authHint: 'test fixture'
    },
    capabilities: {
      interactive: overrides.interactive ?? kind === 'llm-cli',
      initialPrompt: overrides.initialPrompt ?? kind === 'llm-cli',
      stdinDispatch: overrides.stdinDispatch ?? kind === 'llm-cli',
      resultFile: true,
      transcriptCapture: overrides.transcriptCapture ?? kind === 'llm-cli',
      streamingDetection: false,
      screenshots: overrides.screenshots || false,
      dom: overrides.dom || false,
      console: overrides.console || false,
      shell: overrides.shell || false,
      fileEdit: overrides.fileEdit || false
    },
    writeCapability: overrides.writeCapability || 'none',
    sandboxModes: ['read-only'],
    approvalModes: ['never'],
    resultContract: 'job-result',
    evidenceCapabilities: ['transcript', 'command-output', 'diff', 'test-result', 'screenshot', 'dom', 'console'],
    failureModes: ['missing-cli', 'auth-expired', 'no-result-file', 'unknown']
  };
}
