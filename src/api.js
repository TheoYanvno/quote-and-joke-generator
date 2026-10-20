// Talks to the account API. When the app is served by the Node server, requests go over HTTP and the
// session lives in an HttpOnly cookie. Without a server (for example on GitHub Pages) accounts are
// turned off, and favorites stay in this browser only.

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

/** Finds out whether a server is running. Returns { mode, call } or { mode: 'off' }. */
export async function connect() {
  try {
    const res = await fetch('api/health', { credentials: 'same-origin' });
    if (res.ok && (await res.json()).ok) return { mode: 'server', call: httpCall };
  } catch { /* no server */ }
  return { mode: 'off', call: null };
}
