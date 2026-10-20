// Talks to the account API.
//  - Served by the Node server: requests go over HTTP and the session lives in an HttpOnly cookie.
//  - No server (the live demo on GitHub Pages): the same service and routes run inside the browser,
//    with accounts saved in IndexedDB. Clearly labeled as a demo in the page.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Request failed (${status})`);
    this.status = status;
    this.fields = body?.fields ?? {};
  }
}

async function httpCall(method, path, body) {
  const res = await fetch(path.replace(/^\//, ''), {        // relative, so it works under any folder
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

const DEMO_TOKEN = 'qj-demo-session';

/** The demo backend: loaded only when there is no server, so the server version never downloads it. */
async function demoCall() {
  const [{ AccountService }, { handleApi }, browser] = await Promise.all([
    import('./accounts/service.js'),
    import('./accounts/routes.js'),
    import('./accounts/browser-store.js'),
  ]);
  const store = await browser.openBrowserStore();
  const service = new AccountService({ store, passwords: browser.browserPasswords, tokens: browser.browserTokens });
  const token = {
    get: () => { try { return localStorage.getItem(DEMO_TOKEN); } catch { return null; } },
    set: (v) => { try { v ? localStorage.setItem(DEMO_TOKEN, v) : localStorage.removeItem(DEMO_TOKEN); } catch { /* private mode */ } },
  };
  return async (method, path, body) => {
    const res = await handleApi(service, { method, path, body, token: token.get() });
    if (res.session) token.set(res.session.clear ? null : res.session.token);
    if (res.status >= 400) throw new ApiError(res.status, res.body);
    return res.body;
  };
}

/** Finds out whether a server is running. Returns { mode: 'server' | 'demo' | 'off', call }. */
export async function connect() {
  try {
    const res = await fetch('api/health', { credentials: 'same-origin' });
    if (res.ok && (await res.json()).ok) return { mode: 'server', call: httpCall };
  } catch { /* no server */ }
  try {
    if (!globalThis.indexedDB || !crypto?.subtle) throw new Error('unsupported');
    return { mode: 'demo', call: await demoCall() };
  } catch {
    return { mode: 'off', call: null };      // very old browser or storage blocked: favorites stay local
  }
}
