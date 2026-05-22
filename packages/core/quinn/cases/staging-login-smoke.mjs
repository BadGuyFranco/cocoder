// Staging login smoke — Quinn drives the IDE through:
//   1. Initial screenshot (whatever the IDE shows first).
//   2. Switch env to 'staging' (writes localStorage + reload).
//   3. Capture pre-login screenshot + DOM snapshot.
//   4. Fill email + password from the credentials file and submit.
//   5. Wait for ANY known post-login surface to appear:
//        - app-layout    (subscribed user → real workspace)
//        - paygate       (signed in, no active subscription → PayGate.tsx)
//        - sign-in error (backend rejected creds)
//      Either of the first two counts as a successful sign-in.
//   6. Capture post-login screenshot + DOM snapshot and report which
//      surface appeared so the founder can see exactly where the user lands.
//
// All evidence lands under the runner's --output directory.

export const meta = {
  id: 'staging-login-smoke',
  description: 'Switch to staging, sign in as the configured user, capture pre/post evidence and detect app-layout vs paygate vs error.',
  requires: ['staging-credentials']
};

const DEFAULT_EMAIL = 'jake.owner@wingmaservices.us';

const APP_LAYOUT_SELECTOR = '[data-testid="app-layout"]';
const ERROR_SELECTOR = 'p.text-red-500';
const PAYGATE_TEXT = 'Subscribe to get started';
const PAYGATE_EXPR = `(() => Array.from(document.querySelectorAll('h1, h2, h3')).some((el) => el.textContent && el.textContent.trim() === ${JSON.stringify(PAYGATE_TEXT)}))()`;

export async function run(driver, ctx) {
  const email = ctx.args?.signInEmail ?? DEFAULT_EMAIL;
  if (!ctx.credentials) {
    throw new Error('staging-login-smoke requires a credentials file (default: cocoder/.quinn-credentials.json).');
  }
  const cred = ctx.credentials.lookup('staging', email);

  await driver.captureScreenshot('00-initial.png');
  await driver.captureDom('00-initial.json');

  // After the env-switch reload the renderer briefly shows nothing while React
  // re-mounts and the /me request settles. We deliberately do NOT pass a
  // waitForSelector to setEnvironment (any generic h1/form match would fire on
  // transient loading frames) and instead wait below for one of the four
  // definitive post-reload surfaces.
  await driver.setEnvironment('staging');

  const envInStorage = await driver.getLocalStorage('cocoder-dev-console-env');
  if (envInStorage !== 'staging') {
    throw new Error(`Expected env=staging after setEnvironment, observed ${envInStorage}`);
  }

  // Wait for the renderer to settle on one of the four known surfaces. This
  // covers (a) already-signed-in subscriber → app-layout, (b) already-signed-in
  // non-subscriber → paygate, (c) signed-out → sign-in form, (d) edge case
  // where an error banner is already rendered (rare on fresh load but cheap to
  // include for diagnostic completeness).
  const settled = await driver.waitForAny([
    { name: 'app-layout', expr: `Boolean(document.querySelector(${JSON.stringify(APP_LAYOUT_SELECTOR)}))` },
    { name: 'paygate', expr: PAYGATE_EXPR },
    { name: 'sign-in-form', expr: `Boolean(document.querySelector('input#email')) && Boolean(document.querySelector('input#password'))` },
    { name: 'sign-in-error', expr: `Boolean(document.querySelector(${JSON.stringify(ERROR_SELECTOR)}))` }
  ], { timeoutMs: 30000 });

  await driver.captureScreenshot('01-staging-pre-login.png');
  await driver.captureDom('01-staging-pre-login.json');

  const preexisting = {
    appLayout: settled.matched === 'app-layout',
    paygate: settled.matched === 'paygate',
    signInForm: settled.matched === 'sign-in-form'
  };

  if (!preexisting.signInForm && (preexisting.appLayout || preexisting.paygate)) {
    await driver.captureScreenshot('02-post-login.png');
    await driver.captureDom('02-post-login.json');
    const landedOn = preexisting.appLayout ? 'app-layout' : 'paygate';
    // Pre-existing session: the sign-in flow was not driven, so we don't record
    // a 'sign-in-form-present' assertion (it doesn't apply to this branch).
    // A downstream consumer evaluating assertions.every(a => a.passed) now
    // gets a faithful answer.
    return {
      status: 'PASS',
      assertions: [
        { name: 'env-set-to-staging', passed: envInStorage === 'staging' },
        { name: 'post-login-surface-visible', passed: true, observed: landedOn }
      ],
      user: { email, sessionSource: 'pre-existing' },
      environment: 'staging',
      observed: { landedOn, signInFormSkipped: true }
    };
  }

  // Drive sign-in manually (instead of driver.signIn) so we can race three
  // post-submit surfaces rather than just two.
  if (cred.password) driver.redactedSecrets.push(cred.password);
  await driver.waitFor('input#email', { timeoutMs: 15000 });
  await driver.fillInput('input#email', cred.email);
  await driver.fillInput('input#password', cred.password);
  await driver.click('form button[type="submit"]');

  let landedOn;
  try {
    const outcome = await driver.waitForAny([
      { name: 'app-layout', expr: `Boolean(document.querySelector(${JSON.stringify(APP_LAYOUT_SELECTOR)}))` },
      { name: 'paygate', expr: PAYGATE_EXPR },
      { name: 'sign-in-error', expr: `Boolean(document.querySelector(${JSON.stringify(ERROR_SELECTOR)}))` }
    ], { timeoutMs: 60000 });
    landedOn = outcome.matched;
  } catch (timeoutError) {
    await driver.captureScreenshot('02-sign-in-timeout.png');
    await driver.captureDom('02-sign-in-timeout.json');
    return {
      status: 'FAILED',
      reason: `Sign-in submitted but no known post-login surface appeared within 60s: ${timeoutError.message}`,
      assertions: [
        { name: 'env-set-to-staging', passed: envInStorage === 'staging' },
        { name: 'sign-in-form-present', passed: true },
        { name: 'post-login-surface-visible', passed: false }
      ],
      user: { email },
      environment: 'staging'
    };
  }

  if (landedOn === 'sign-in-error') {
    const errorText = await driver.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(ERROR_SELECTOR)}); return el ? el.textContent : null; })()`
    );
    await driver.captureScreenshot('02-sign-in-error.png');
    await driver.captureDom('02-sign-in-error.json');
    return {
      status: 'NEEDS_FOUNDER',
      reason: `Staging backend rejected sign-in for ${email}: "${errorText}". Confirm credentials, email-verification status, and that the account exists on the configured staging backend.`,
      assertions: [
        { name: 'env-set-to-staging', passed: envInStorage === 'staging' },
        { name: 'sign-in-form-present', passed: true },
        { name: 'post-login-surface-visible', passed: false }
      ],
      signInError: errorText,
      user: { email },
      environment: 'staging'
    };
  }

  await driver.captureScreenshot('02-post-login.png');
  await driver.captureDom('02-post-login.json');

  return {
    status: 'PASS',
    assertions: [
      { name: 'env-set-to-staging', passed: envInStorage === 'staging' },
      { name: 'sign-in-form-present', passed: true },
      { name: 'post-login-surface-visible', passed: true, observed: landedOn }
    ],
    user: { email, sessionSource: 'fresh-sign-in' },
    environment: 'staging',
    observed: { landedOn }
  };
}
