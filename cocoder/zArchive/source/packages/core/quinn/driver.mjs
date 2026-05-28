// Quinn driver — high-level CDP primitives for IDE QA.
//
// Owns one CDP page connection and exposes the vocabulary test cases need:
// evaluate, screenshot, DOM snapshot, console capture, selector waits,
// React-aware input fills, click, localStorage manipulation, env switch,
// sign-in. Evidence artifacts are written into a per-run directory.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CdpClient, discoverRendererTarget } from './cdp-client.mjs';

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_WAIT_TIMEOUT_MS = 30000;
const SIGN_IN_TIMEOUT_MS = 45000;
const ENV_STORAGE_KEY = process.env.COCODER_QUINN_ENV_STORAGE_KEY || 'cocoder-dev-console-env';

export class QuinnDriver {
  constructor({ cdpHttpUrl, evidenceDir, redactedSecrets = [] }) {
    this.cdpHttpUrl = cdpHttpUrl;
    this.evidenceDir = evidenceDir;
    this.client = null;
    this.target = null;
    this.consoleEntries = [];
    this.networkEntries = [];
    this.screenshotsTaken = [];
    this.domSnapshotsTaken = [];
    this.actionsLog = [];
    this.assertions = [];
    this.redactedSecrets = redactedSecrets.filter(Boolean);
  }

  async attach() {
    await mkdir(path.join(this.evidenceDir, 'screenshots'), { recursive: true });
    await mkdir(path.join(this.evidenceDir, 'dom'), { recursive: true });
    const { target, allTargets } = await discoverRendererTarget(this.cdpHttpUrl);
    this.target = target;
    this.allTargets = allTargets;
    this.client = new CdpClient({ webSocketDebuggerUrl: target.webSocketDebuggerUrl });
    await this.client.connect();
    await this.client.send('Page.enable');
    await this.client.send('Runtime.enable');
    await this.client.send('DOM.enable');
    try { await this.client.send('Log.enable'); } catch { /* may not be supported on every CDP version */ }
    this.client.on('Runtime.consoleAPICalled', (params) => {
      this.consoleEntries.push({
        kind: 'console',
        level: params.type,
        timestamp: params.timestamp,
        args: (params.args ?? []).map(formatRemoteObject)
      });
    });
    this.client.on('Runtime.exceptionThrown', (params) => {
      this.consoleEntries.push({
        kind: 'exception',
        timestamp: params.timestamp,
        text: params.exceptionDetails?.text,
        stack: params.exceptionDetails?.stackTrace?.callFrames ?? null
      });
    });
    this.client.on('Log.entryAdded', (params) => {
      this.consoleEntries.push({
        kind: 'log',
        level: params.entry?.level,
        source: params.entry?.source,
        text: params.entry?.text,
        timestamp: params.entry?.timestamp
      });
    });
    this.logAction('attach', { target: { url: target.url, id: target.id, type: target.type } });
  }

  logAction(name, details = {}) {
    this.actionsLog.push({ at: new Date().toISOString(), name, details: this.redactObject(details) });
  }

  redactString(value) {
    if (typeof value !== 'string' || this.redactedSecrets.length === 0) return value;
    let out = value;
    for (const secret of this.redactedSecrets) {
      if (!secret) continue;
      out = out.split(secret).join('[REDACTED]');
    }
    return out;
  }

  redactObject(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return this.redactString(obj);
    if (Array.isArray(obj)) return obj.map((v) => this.redactObject(v));
    if (typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = this.redactObject(v);
      return out;
    }
    return obj;
  }

  async evaluate(expression, { returnByValue = true, awaitPromise = true } = {}) {
    const result = await this.client.send('Runtime.evaluate', {
      expression,
      returnByValue,
      awaitPromise,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const msg = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'unknown exception';
      throw new Error(`Renderer evaluate failed: ${msg}`);
    }
    return returnByValue ? result.result?.value : result.result;
  }

  async captureScreenshot(name) {
    const file = path.join(this.evidenceDir, 'screenshots', name);
    const result = await this.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (!result?.data) throw new Error('Page.captureScreenshot returned no data');
    await writeFile(file, Buffer.from(result.data, 'base64'));
    this.screenshotsTaken.push(file);
    this.logAction('screenshot', { file });
    return file;
  }

  async captureDom(name) {
    const file = path.join(this.evidenceDir, 'dom', name);
    const doc = await this.client.send('DOM.getDocument', { depth: -1, pierce: true });
    const sanitized = sanitizeDomTree(doc.root, this.redactedSecrets);
    await writeFile(file, JSON.stringify(this.redactObject(sanitized), null, 2));
    this.domSnapshotsTaken.push(file);
    this.logAction('dom-snapshot', { file });
    return file;
  }

  async waitFor(selector, { timeoutMs = DEFAULT_WAIT_TIMEOUT_MS, intervalMs = DEFAULT_POLL_INTERVAL_MS, absent = false } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const present = await this.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      if (absent ? !present : present) {
        this.logAction('wait-for', { selector, absent, satisfiedAt: new Date().toISOString() });
        return true;
      }
      await sleep(intervalMs);
    }
    throw new Error(`waitFor timed out: selector=${selector} absent=${absent} after ${timeoutMs}ms`);
  }

  async fillInput(selector, value) {
    const script = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'selector-not-found' };
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, length: el.value.length };
    })()`;
    const result = await this.evaluate(script);
    if (!result?.ok) throw new Error(`fillInput failed: ${result?.reason ?? 'unknown'} (selector=${selector})`);
    this.logAction('fill-input', { selector, length: result.length });
    return result;
  }

  // Synthetic-event click: dispatches a 'click' event in the renderer via
  // HTMLElement.click(). This is the cheap path — it does NOT go through
  // Chromium's pointer pipeline, so it does not move focus, fire
  // pointerdown/pointerup, trigger drag-detection thresholds, or behave like a
  // real mouse click in any other way. Prefer mouseClick() for anything that
  // mimics user behavior; reach for click() only when you specifically want
  // the synthetic-event escape hatch (e.g. an element that the real mouse
  // pipeline can't reach due to an overlay).
  async click(selector) {
    const script = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'selector-not-found' };
      el.click();
      return { ok: true };
    })()`;
    const result = await this.evaluate(script);
    if (!result?.ok) throw new Error(`click failed: ${result?.reason ?? 'unknown'} (selector=${selector})`);
    this.logAction('click', { selector });
  }

  // Real-user click: dispatches mousePressed + mouseReleased via CDP at the
  // element's bounding-rect center. Goes through Chromium's full pointer
  // pipeline — mousedown → mouseup → focus → click — so it behaves exactly
  // like a hardware mouse click. This is the default for "click like a user"
  // and the one that sets focus correctly on inputs/textareas/buttons.
  //
  // Guards: throws on selector-not-found, zero-size element, OR element whose
  // bounding-rect center is outside the viewport (off-screen). Off-screen
  // clicks silently miss in Chromium — the dispatch succeeds but no element
  // receives the event — so we refuse to issue them. Scroll the element into
  // view first (or shrink the IDE chrome) before retrying.
  async mouseClick(selector, { button = 'left', clickCount = 1 } = {}) {
    const probe = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return { found: true, zeroSize: true };
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const inViewport = x >= 0 && y >= 0 && x <= vw && y <= vh;
      return { found: true, zeroSize: false, x, y, inViewport, viewport: { width: vw, height: vh } };
    })()`);
    if (!probe?.found) throw new Error(`mouseClick failed: selector ${selector} not found`);
    if (probe.zeroSize) throw new Error(`mouseClick failed: selector ${selector} has zero size`);
    if (!probe.inViewport) {
      throw new Error(
        `mouseClick failed: selector ${selector} center (${probe.x},${probe.y}) is outside viewport `
        + `(${probe.viewport.width}x${probe.viewport.height}). Scroll the element into view before clicking.`
      );
    }
    const base = { x: probe.x, y: probe.y, button, clickCount };
    await this.client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base, buttons: 1 });
    await this.client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 });
    this.logAction('mouse-click', { selector, x: probe.x, y: probe.y, button });
  }

  async setLocalStorage(key, value) {
    const expr = `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))})`;
    await this.evaluate(expr);
    this.logAction('set-local-storage', { key });
  }

  async getLocalStorage(key) {
    return this.evaluate(`(() => { const raw = localStorage.getItem(${JSON.stringify(key)}); try { return raw === null ? null : JSON.parse(raw); } catch { return raw; } })()`);
  }

  async reload({ waitForSelector } = {}) {
    await this.client.send('Page.reload', { ignoreCache: false });
    this.logAction('reload', {});
    if (waitForSelector) await this.waitFor(waitForSelector);
  }

  async setEnvironment(env, { waitForSelector = 'form, [data-testid="app-layout"]' } = {}) {
    await this.setLocalStorage(ENV_STORAGE_KEY, env);
    await this.reload({ waitForSelector });
    const observed = await this.getLocalStorage(ENV_STORAGE_KEY);
    if (observed !== env) {
      throw new Error(`setEnvironment(${env}) failed: localStorage still reports ${observed}`);
    }
    this.logAction('set-environment', { env, observed });
  }

  async signIn(email, password, {
    postLoginSelector = '[data-testid="app-layout"]',
    errorSelector = 'p.text-red-500',
    timeoutMs = SIGN_IN_TIMEOUT_MS
  } = {}) {
    if (password) this.redactedSecrets.push(password);
    await this.waitFor('input#email', { timeoutMs: 15000 });
    await this.fillInput('input#email', email);
    await this.fillInput('input#password', password);
    await this.click('form button[type="submit"]');
    const outcome = await this.waitForEither(postLoginSelector, errorSelector, { timeoutMs });
    if (outcome.matched === 'second') {
      const errorText = await this.evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(errorSelector)}); return el ? el.textContent : null; })()`
      );
      const err = new Error(`Sign-in rejected: ${errorText ?? 'unknown reason'}`);
      err.signInError = errorText ?? null;
      this.logAction('sign-in-error', { email, errorText });
      throw err;
    }
    this.logAction('sign-in', { email, completedAt: new Date().toISOString() });
  }

  async waitForEither(selectorA, selectorB, { timeoutMs = DEFAULT_WAIT_TIMEOUT_MS, intervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const expr = `(() => ({
        a: Boolean(document.querySelector(${JSON.stringify(selectorA)})),
        b: Boolean(document.querySelector(${JSON.stringify(selectorB)}))
      }))()`;
      const observed = await this.evaluate(expr);
      if (observed?.a) return { matched: 'first', selector: selectorA };
      if (observed?.b) return { matched: 'second', selector: selectorB };
      await sleep(intervalMs);
    }
    throw new Error(`waitForEither timed out: neither '${selectorA}' nor '${selectorB}' appeared after ${timeoutMs}ms`);
  }

  // Wait until any one of N predicates is true. Each predicate is either a CSS
  // selector string (matched against document.querySelector) or an object
  // { name, expr } where `expr` is a JS expression evaluated in the renderer
  // and treated as a boolean. Returns { matched: <name>, index: <i> } for the
  // first one that fires. Throws on timeout.
  async waitForAny(predicates, { timeoutMs = DEFAULT_WAIT_TIMEOUT_MS, intervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
    if (!Array.isArray(predicates) || predicates.length === 0) {
      throw new Error('waitForAny requires at least one predicate');
    }
    const normalized = predicates.map((p, i) => {
      if (typeof p === 'string') return { name: `predicate-${i}`, expr: `Boolean(document.querySelector(${JSON.stringify(p)}))` };
      if (p && typeof p.expr === 'string') return { name: p.name ?? `predicate-${i}`, expr: p.expr };
      throw new Error(`waitForAny predicate ${i} must be a CSS selector string or { name, expr } object`);
    });
    const aggregated = `(() => [${normalized.map((p) => p.expr).join(',')}])()`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const observed = await this.evaluate(aggregated);
      if (Array.isArray(observed)) {
        for (let i = 0; i < observed.length; i += 1) {
          if (observed[i]) return { matched: normalized[i].name, index: i };
        }
      }
      await sleep(intervalMs);
    }
    const names = normalized.map((p) => p.name).join(', ');
    throw new Error(`waitForAny timed out: none of [${names}] became truthy within ${timeoutMs}ms`);
  }

  // Generic state-based wait. `condition` is a JS expression evaluated in the
  // renderer; resolves the first poll where it's truthy. The expression is
  // wrapped in an IIFE so callers can pass multi-statement bodies.
  async waitForCondition(condition, { timeoutMs = DEFAULT_WAIT_TIMEOUT_MS, intervalMs = DEFAULT_POLL_INTERVAL_MS, label = 'condition' } = {}) {
    const expr = `(() => { try { return Boolean((${condition})); } catch (e) { return false; } })()`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(expr)) {
        this.logAction('wait-for-condition', { label, satisfiedAt: new Date().toISOString() });
        return true;
      }
      await sleep(intervalMs);
    }
    throw new Error(`waitForCondition timed out: label='${label}' after ${timeoutMs}ms`);
  }

  // Press a single key or chord against the focused element. Examples:
  //   'Enter', 'Escape', 'Tab', 'ArrowDown', 'Meta+S', 'Control+Shift+P'
  // Modifiers are bitfield-encoded per CDP: Alt=1, Control=2, Meta=4, Shift=8.
  async pressKey(key, { modifiers: extraMods } = {}) {
    const { mainKey, modifiers } = parseKeyChord(key);
    const combined = (modifiers | (extraMods ?? 0)) & 0xF;
    const desc = describeKey(mainKey);
    const base = { modifiers: combined, key: desc.key, code: desc.code, windowsVirtualKeyCode: desc.virtualKeyCode };
    await this.client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: desc.text });
    await this.client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    this.logAction('press-key', { key });
  }

  // Type a string by dispatching one Input.insertText per character so React
  // controlled inputs see real input events. For special keys (Enter, Tab,
  // shortcuts), call pressKey instead.
  async type(text) {
    if (typeof text !== 'string') throw new Error('type(text) requires a string');
    for (const char of text) {
      await this.client.send('Input.insertText', { text: char });
    }
    this.logAction('type', { length: text.length });
  }

  async hover(selector) {
    const rect = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!rect) throw new Error(`hover failed: selector ${selector} not found`);
    await this.client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y, button: 'none', buttons: 0 });
    this.logAction('hover', { selector, x: rect.x, y: rect.y });
  }

  // ---------- Assertion vocabulary ----------
  // Every expect* pushes a record into this.assertions and returns the record
  // (with `passed: boolean`). Cases can return `assertions: driver.assertions`
  // directly. Failures do NOT throw by default; pass { throwOnFail: true } to
  // make a single assertion hard-fail the case.

  recordAssertion(record) {
    const stamped = { ...record, recordedAt: new Date().toISOString() };
    this.assertions.push(stamped);
    return stamped;
  }

  async expectVisible(selector, { throwOnFail = false } = {}) {
    const passed = await this.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const record = this.recordAssertion({ name: `visible:${selector}`, passed: Boolean(passed), selector });
    if (!record.passed && throwOnFail) throw new Error(`expectVisible failed: ${selector}`);
    return record;
  }

  async expectAbsent(selector, { throwOnFail = false } = {}) {
    const present = await this.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    const record = this.recordAssertion({ name: `absent:${selector}`, passed: !present, selector });
    if (!record.passed && throwOnFail) throw new Error(`expectAbsent failed: ${selector} is still present`);
    return record;
  }

  async expectText(selector, matcher, { throwOnFail = false } = {}) {
    const text = await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent : null; })()`);
    const passed = matchesText(text, matcher);
    const record = this.recordAssertion({
      name: `text:${selector}`,
      passed,
      selector,
      observed: text,
      matcher: describeMatcher(matcher)
    });
    if (!passed && throwOnFail) throw new Error(`expectText failed: ${selector} observed='${text}' matcher=${describeMatcher(matcher)}`);
    return record;
  }

  async expectCount(selector, expected, { throwOnFail = false } = {}) {
    const observed = await this.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    const passed = typeof expected === 'function' ? Boolean(expected(observed)) : observed === expected;
    const record = this.recordAssertion({
      name: `count:${selector}`,
      passed,
      selector,
      observed,
      expected: typeof expected === 'function' ? '<predicate>' : expected
    });
    if (!passed && throwOnFail) throw new Error(`expectCount failed: ${selector} observed=${observed} expected=${expected}`);
    return record;
  }

  async expectValue(selector, expected, { throwOnFail = false } = {}) {
    const observed = await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.value : null; })()`);
    const passed = matchesText(observed, expected);
    const record = this.recordAssertion({
      name: `value:${selector}`,
      passed,
      selector,
      observed,
      expected: describeMatcher(expected)
    });
    if (!passed && throwOnFail) throw new Error(`expectValue failed: ${selector} observed='${observed}' expected=${describeMatcher(expected)}`);
    return record;
  }

  // Asserts there are no console exception/error entries since the supplied
  // marker. Pass driver.consoleEntries.length BEFORE the action you want to
  // gate, then call this after.
  expectNoConsoleErrors(since = 0, { throwOnFail = false } = {}) {
    const sliced = this.consoleEntries.slice(since);
    const offenders = sliced.filter((entry) => entry.kind === 'exception' || (entry.kind === 'console' && entry.level === 'error'));
    const passed = offenders.length === 0;
    const record = this.recordAssertion({
      name: `no-console-errors:since=${since}`,
      passed,
      offenderCount: offenders.length,
      offenders: offenders.slice(0, 5)
    });
    if (!passed && throwOnFail) throw new Error(`expectNoConsoleErrors failed: ${offenders.length} entries since ${since}`);
    return record;
  }

  async detach() {
    if (this.client) {
      try { await this.client.close(); } catch { /* already closed */ }
    }
  }

  exportRunSummary() {
    return {
      cdpHttpUrl: this.cdpHttpUrl,
      target: this.target ? { id: this.target.id, type: this.target.type, url: this.target.url, title: this.target.title } : null,
      screenshots: this.screenshotsTaken,
      domSnapshots: this.domSnapshotsTaken,
      consoleEntryCount: this.consoleEntries.length,
      assertions: this.assertions,
      actions: this.actionsLog
    };
  }
}

const KEY_MODIFIERS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const MODIFIER_ALIASES = { Cmd: 'Meta', Command: 'Meta', Ctrl: 'Control' };

function parseKeyChord(chord) {
  const parts = chord.split('+').map((p) => p.trim()).filter(Boolean);
  let modifiers = 0;
  let mainKey = parts[parts.length - 1];
  for (let i = 0; i < parts.length - 1; i += 1) {
    const raw = parts[i];
    const canonical = MODIFIER_ALIASES[raw] ?? raw;
    if (!(canonical in KEY_MODIFIERS)) {
      throw new Error(`Unknown modifier '${raw}' in key chord '${chord}'`);
    }
    modifiers |= KEY_MODIFIERS[canonical];
  }
  if (!mainKey) throw new Error(`Empty main key in chord '${chord}'`);
  return { mainKey, modifiers };
}

const SPECIAL_KEYS = {
  Enter: { key: 'Enter', code: 'Enter', virtualKeyCode: 13, text: '\r' },
  Escape: { key: 'Escape', code: 'Escape', virtualKeyCode: 27, text: '' },
  Tab: { key: 'Tab', code: 'Tab', virtualKeyCode: 9, text: '\t' },
  Backspace: { key: 'Backspace', code: 'Backspace', virtualKeyCode: 8, text: '' },
  Delete: { key: 'Delete', code: 'Delete', virtualKeyCode: 46, text: '' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', virtualKeyCode: 38, text: '' },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', virtualKeyCode: 40, text: '' },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', virtualKeyCode: 37, text: '' },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', virtualKeyCode: 39, text: '' },
  Space: { key: ' ', code: 'Space', virtualKeyCode: 32, text: ' ' },
  Home: { key: 'Home', code: 'Home', virtualKeyCode: 36, text: '' },
  End: { key: 'End', code: 'End', virtualKeyCode: 35, text: '' }
};

function describeKey(name) {
  if (SPECIAL_KEYS[name]) return SPECIAL_KEYS[name];
  if (name.length === 1) {
    const upper = name.toUpperCase();
    const isLetter = upper >= 'A' && upper <= 'Z';
    const isDigit = name >= '0' && name <= '9';
    return {
      key: name,
      code: isLetter ? `Key${upper}` : (isDigit ? `Digit${name}` : name),
      virtualKeyCode: isLetter || isDigit ? upper.charCodeAt(0) : 0,
      text: name
    };
  }
  return { key: name, code: name, virtualKeyCode: 0, text: '' };
}

function matchesText(observed, matcher) {
  if (observed === null || observed === undefined) return false;
  if (matcher instanceof RegExp) return matcher.test(String(observed));
  if (typeof matcher === 'function') return Boolean(matcher(observed));
  if (typeof matcher === 'string') return String(observed).includes(matcher);
  return observed === matcher;
}

function describeMatcher(matcher) {
  if (matcher instanceof RegExp) return matcher.toString();
  if (typeof matcher === 'function') return '<predicate>';
  if (typeof matcher === 'string') return JSON.stringify(matcher);
  return String(matcher);
}

function formatRemoteObject(remote) {
  if (!remote) return null;
  if (remote.unserializableValue) return remote.unserializableValue;
  if ('value' in remote) return remote.value;
  if (remote.description) return remote.description;
  return remote.type;
}

// Walks a CDP DOM node tree and rewrites every <input type="password"> so its
// value attribute and any same-text nodeValues read as [REDACTED-INPUT-VALUE].
// Run before the global string-redaction pass so passwords never reach disk
// even when the driver doesn't yet know they're secrets (e.g. the user types
// into the field but signIn() hasn't been called).
export function _sanitizeDomTreeForTests(root, knownSecrets) {
  return sanitizeDomTree(root, knownSecrets);
}

function sanitizeDomTree(root, knownSecrets) {
  if (!root || typeof root !== 'object') return root;
  const passwordValues = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.nodeName === 'INPUT' && Array.isArray(node.attributes)) {
      let isPassword = false;
      let valueIndex = -1;
      for (let i = 0; i < node.attributes.length; i += 2) {
        const key = node.attributes[i];
        const val = node.attributes[i + 1];
        if (key === 'type' && val === 'password') isPassword = true;
        if (key === 'value') valueIndex = i;
      }
      if (isPassword) {
        if (valueIndex >= 0) {
          passwordValues.add(node.attributes[valueIndex + 1]);
          node.attributes[valueIndex + 1] = '[REDACTED-INPUT-VALUE]';
        }
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
    if (node.contentDocument) walk(node.contentDocument);
    if (node.shadowRoots) node.shadowRoots.forEach(walk);
    if (Array.isArray(node.pseudoElements)) node.pseudoElements.forEach(walk);
    if (Array.isArray(node.templateContent?.children)) node.templateContent.children.forEach(walk);
  };
  walk(root);
  if (passwordValues.size > 0) {
    knownSecrets.push(...passwordValues);
  }
  return root;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
