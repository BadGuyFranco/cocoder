// Minimal Quinn case — proves driver attachment and primitive evidence capture
// against whatever IDE state happens to be on screen. Useful for:
//   * Smoke-testing the driver itself without staging or credentials.
//   * Capturing a 'whatever the user is looking at' baseline.

export const meta = {
  id: 'cdp-attach-smoke',
  description: 'Attach to running IDE, capture screenshot+DOM+console+title; no env switch, no login.',
  requires: []
};

export async function run(driver) {
  await driver.captureScreenshot('attach.png');
  await driver.captureDom('attach.json');
  const title = await driver.evaluate('document.title');
  const href = await driver.evaluate('document.location.href');
  const env = await driver.getLocalStorage('cocoder-dev-console-env');
  const signedIn = await driver.evaluate('Boolean(document.querySelector(\'[data-testid="app-layout"]\'))');
  const signInFormVisible = await driver.evaluate('Boolean(document.querySelector(\'input#email\'))');
  return {
    status: 'PASS',
    assertions: [
      { name: 'screenshot-captured', passed: true },
      { name: 'dom-captured', passed: true }
    ],
    observed: {
      title,
      href,
      localStorageEnv: env,
      appLayoutVisible: Boolean(signedIn),
      signInFormVisible: Boolean(signInFormVisible)
    }
  };
}
