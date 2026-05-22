// Minimal Chrome DevTools Protocol JSON-RPC client over WebSocket.
//
// No third-party deps. Uses the runtime's built-in WebSocket (Node 22.4+).
// One connection = one CDP target (typically the renderer page).

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export class CdpClient {
  constructor({ webSocketDebuggerUrl, requestTimeoutMs }) {
    if (!webSocketDebuggerUrl) throw new Error('webSocketDebuggerUrl is required');
    this.url = webSocketDebuggerUrl;
    this.requestTimeoutMs = requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Map();
    this.closed = false;
    this.closeReason = null;
  }

  async connect() {
    if (typeof WebSocket !== 'function') {
      throw new Error('Native WebSocket is not available. Quinn driver requires Node 22.4+ or a polyfill.');
    }
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.ws.removeEventListener('error', onError);
        resolve();
      };
      const onError = (event) => {
        this.ws.removeEventListener('open', onOpen);
        reject(new Error(`CDP WebSocket failed to open: ${event?.message ?? 'unknown error'}`));
      };
      this.ws.addEventListener('open', onOpen, { once: true });
      this.ws.addEventListener('error', onError, { once: true });
    });
    this.ws.addEventListener('message', (event) => this.handleMessage(event));
    this.ws.addEventListener('close', (event) => this.handleClose(event));
  }

  handleMessage(event) {
    let message;
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    } catch {
      return;
    }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        reject(Object.assign(new Error(`CDP error: ${message.error.message}`), { cdpError: message.error }));
      } else {
        resolve(message.result);
      }
      return;
    }
    if (message.method) {
      const listeners = this.eventListeners.get(message.method);
      if (!listeners) return;
      for (const listener of listeners) {
        try { listener(message.params); } catch { /* listener crash shouldn't kill the stream */ }
      }
    }
  }

  handleClose(event) {
    this.closed = true;
    this.closeReason = event?.reason || `code ${event?.code ?? 'unknown'}`;
    for (const { reject } of this.pending.values()) {
      reject(new Error(`CDP connection closed: ${this.closeReason}`));
    }
    this.pending.clear();
  }

  on(method, listener) {
    if (!this.eventListeners.has(method)) this.eventListeners.set(method, new Set());
    this.eventListeners.get(method).add(listener);
    return () => this.eventListeners.get(method)?.delete(listener);
  }

  async send(method, params = {}) {
    if (this.closed) throw new Error(`CDP send rejected: connection closed (${this.closeReason ?? 'unknown'})`);
    if (!this.ws || this.ws.readyState !== 1) throw new Error('CDP WebSocket not open');
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP request timed out: ${method} (${this.requestTimeoutMs}ms)`));
        }
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });
      this.ws.send(payload);
    });
  }

  async close() {
    if (this.ws && !this.closed) {
      try { this.ws.close(); } catch { /* already closing */ }
    }
    this.closed = true;
  }
}

// Discover renderer page targets from the CDP HTTP endpoint.
// Returns the first page-type target; throws if none found.
export async function discoverRendererTarget(httpUrl, { retries = 30, intervalMs = 500 } = {}) {
  const base = httpUrl.replace(/\/json\/version\/?$/, '').replace(/\/$/, '');
  const listUrl = `${base}/json/list`;
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(listUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const targets = await response.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return { target: page, allTargets: targets };
      lastError = new Error(`No 'page' target in /json/list (got ${targets.length} entries)`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Failed to discover CDP renderer target at ${listUrl}: ${lastError?.message ?? 'unknown'}`);
}
