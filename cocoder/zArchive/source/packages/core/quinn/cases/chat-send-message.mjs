// Chat send-message — Quinn drives a real app-flow against the live IDE:
//   1. Confirm app-layout is visible (case requires a signed-in IDE on staging
//      or any env where the chat UI mounts; it does not drive sign-in itself).
//   2. Capture before-state evidence (screenshot + DOM + assistant-message
//      count).
//   3. Click into the chat input, type a deterministic prompt with
//      driver.type(), press Enter with driver.pressKey('Enter').
//   4. Wait for the assistant to finish responding — a non-streaming assistant
//      bubble appears (.chat-markdown present AND no [data-testid="chat-stop"]
//      button still visible).
//   5. Assert: assistant message count strictly increased, the latest
//      assistant bubble is non-empty, the chat-input is editable again
//      (not disabled by isTyping), and no console errors fired during the
//      send.
//   6. Capture after-state evidence.
//
// Exit codes:
//   PASS         — assistant responded, all assertions passed
//   FAILED       — app-layout was visible but assertions did not all pass or
//                  the assistant never responded within the timeout
//   NEEDS_FOUNDER — IDE not in app-layout (e.g. paygate / sign-in screen),
//                  so this case cannot exercise chat without a sign-in
//                  upstream

const APP_LAYOUT_SELECTOR = '[data-testid="app-layout"]';
const CHAT_INPUT_SELECTOR = '[data-testid="chat-input"]';
const CHAT_SEND_SELECTOR = '[data-testid="chat-send"]';
const CHAT_STOP_SELECTOR = '[data-testid="chat-stop"]';
const ASSISTANT_MESSAGE_SELECTOR = '.chat-markdown';

const DEFAULT_PROMPT = 'Quinn smoke check: please reply with the single word OK.';
const RESPONSE_TIMEOUT_MS = 120000;

export const meta = {
  id: 'chat-send-message',
  description: 'Sends a deterministic prompt into the chat input on the running IDE and asserts the assistant responds.',
  requires: ['signed-in-ide']
};

export async function run(driver, ctx) {
  const prompt = ctx.args?.chatPrompt ?? DEFAULT_PROMPT;

  await driver.captureScreenshot('00-initial.png');
  await driver.captureDom('00-initial.json');

  const appLayoutVisible = await driver.evaluate(
    `Boolean(document.querySelector(${JSON.stringify(APP_LAYOUT_SELECTOR)}))`
  );
  if (!appLayoutVisible) {
    return {
      status: 'NEEDS_FOUNDER',
      reason: 'chat-send-message requires app-layout to be visible. Run staging-login-smoke first or point Quinn at an already-signed-in IDE.',
      assertions: [
        { name: 'app-layout-visible', passed: false }
      ]
    };
  }

  await driver.expectVisible(APP_LAYOUT_SELECTOR, { throwOnFail: true });
  await driver.expectVisible(CHAT_INPUT_SELECTOR, { throwOnFail: true });

  const beforeCount = await driver.evaluate(
    `document.querySelectorAll(${JSON.stringify(ASSISTANT_MESSAGE_SELECTOR)}).length`
  );
  const consoleMarker = driver.consoleEntries.length;

  // Real-user click: dispatches mousePressed+mouseReleased through Chromium's
  // full pointer pipeline, which moves focus to the textarea the same way a
  // trackpad click would. (driver.click() is the synthetic-event escape hatch
  // and does NOT set focus — see Quinn README.)
  await driver.mouseClick(CHAT_INPUT_SELECTOR);
  await driver.waitForCondition(
    `document.activeElement && document.activeElement.matches(${JSON.stringify(CHAT_INPUT_SELECTOR)})`,
    { timeoutMs: 5000, label: 'chat-input-focused' }
  );

  await driver.type(prompt);

  // Sanity-check the controlled value before submitting. expectValue() is
  // non-throwing by default but we want this gated so a typo here doesn't
  // pollute the conversation thread with garbage.
  await driver.expectValue(CHAT_INPUT_SELECTOR, prompt, { throwOnFail: true });

  await driver.captureScreenshot('01-prompt-typed.png');

  // Submit via Enter (no shift) — same path a human user takes.
  await driver.pressKey('Enter');

  // Wait for the streaming cycle to finish. While isTyping=true the chat-stop
  // button is rendered; we wait for it to disappear AND the assistant bubble
  // count to have increased.
  await driver.waitForCondition(
    `(document.querySelectorAll(${JSON.stringify(ASSISTANT_MESSAGE_SELECTOR)}).length > ${beforeCount})
      && !document.querySelector(${JSON.stringify(CHAT_STOP_SELECTOR)})`,
    { timeoutMs: RESPONSE_TIMEOUT_MS, label: 'assistant-response-complete' }
  );

  const afterCount = await driver.evaluate(
    `document.querySelectorAll(${JSON.stringify(ASSISTANT_MESSAGE_SELECTOR)}).length`
  );
  const latestAssistantText = await driver.evaluate(`(() => {
    const all = document.querySelectorAll(${JSON.stringify(ASSISTANT_MESSAGE_SELECTOR)});
    const last = all[all.length - 1];
    return last ? (last.textContent || '').trim() : null;
  })()`);

  await driver.expectCount(ASSISTANT_MESSAGE_SELECTOR, (n) => n > beforeCount, { throwOnFail: true });
  // Use the NodeList-indexed text we already captured above. CSS :last-of-type
  // matches the last element of the same tag among its siblings — not the last
  // element with the .chat-markdown class — so it picks the wrong node whenever
  // a non-message sibling appears after the assistant bubble (status row,
  // typing indicator, footer spacer, etc.). querySelectorAll().length-1 is
  // unambiguous.
  driver.recordAssertion({
    name: 'latest-assistant-bubble-non-empty',
    passed: Boolean(latestAssistantText && latestAssistantText.trim().length > 0),
    observed: { length: latestAssistantText ? latestAssistantText.length : 0 }
  });
  await driver.expectAbsent(CHAT_STOP_SELECTOR);
  // After the stream completes the textarea is no longer disabled and the
  // send button is re-enabled. We assert the input is editable again by
  // checking the disabled attribute (false ⇒ value === null in CDP eval).
  const inputDisabled = await driver.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(CHAT_INPUT_SELECTOR)}); return el ? Boolean(el.disabled) : null; })()`
  );
  driver.recordAssertion({ name: 'chat-input-editable-after-response', passed: inputDisabled === false, observed: { disabled: inputDisabled } });
  await driver.expectVisible(CHAT_SEND_SELECTOR);

  driver.expectNoConsoleErrors(consoleMarker);

  await driver.captureScreenshot('02-assistant-responded.png');
  await driver.captureDom('02-assistant-responded.json');

  const allPassed = driver.assertions.every((a) => a.passed);

  return {
    status: allPassed ? 'PASS' : 'FAILED',
    prompt,
    observed: {
      assistantMessageCountBefore: beforeCount,
      assistantMessageCountAfter: afterCount,
      latestAssistantTextLength: latestAssistantText ? latestAssistantText.length : 0,
      latestAssistantTextPreview: latestAssistantText ? latestAssistantText.slice(0, 200) : null
    },
    assertions: driver.assertions
  };
}
