// Storage, password hashing and tokens for the live demo on GitHub Pages, where there is no server.
// It has the same methods as server/sqlite-store.js, so the same AccountService and API routes run
// unchanged in the browser. Data is kept in IndexedDB, in this browser only.
//
// This is a demo: anyone with access to this browser can read IndexedDB, and the session token can't be
// HttpOnly here. Real accounts need the Node server.

const DB_NAME = 'quote-joke-demo';
const STORE = 'state';
const KEY = 'accounts';

const empty = () => ({ nextId: 1, users: [], sessions: [], favorites: [], attempts: {} });

/** Saves the whole demo state as one record in IndexedDB. */
export function indexedDbPersistence(idb = globalThis.indexedDB) {
  const open = () => new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, action) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = action(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req?.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  };
  return {
    load: () => run('readonly', (s) => s.get(KEY)),
    save: (state) => run('readwrite', (s) => s.put(state, KEY)),
    clear: () => run('readwrite', (s) => s.delete(KEY)),
  };
}

export const memoryPersistence = () => {
  let saved;
  return { load: async () => saved && structuredClone(saved), save: async (s) => { saved = structuredClone(s); }, clear: async () => { saved = undefined; } };
};

export async function openBrowserStore(persistence = indexedDbPersistence()) {
  let state = (await persistence.load()) ?? empty();
  const save = () => persistence.save(state);
  const copy = (row) => (row ? { ...row } : null);

  return {
    async createUser({ username, passwordHash, createdAt }) {
      if (state.users.some((u) => u.username === username)) throw Object.assign(new Error('duplicate'), { code: 'DUPLICATE' });
      const id = state.nextId++;
      state.users.push({ id, username, passwordHash, createdAt });
      await save();
      return id;
    },
    async userByName(name) { return copy(state.users.find((u) => u.username === name)); },
    async userById(id) {
      const u = state.users.find((x) => x.id === id);
      return u ? { id: u.id, username: u.username } : null;
    },
    async createSession(session) { state.sessions.push({ ...session }); await save(); },
    async session(tokenHash) {
      const s = state.sessions.find((x) => x.tokenHash === tokenHash);
      return s ? { userId: s.userId, expiresAt: s.expiresAt } : null;
    },
    async deleteSession(tokenHash) { state.sessions = state.sessions.filter((s) => s.tokenHash !== tokenHash); await save(); },
    async deleteExpiredSessions(now) {
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((s) => s.expiresAt > now);
      await save();
      return before - state.sessions.length;
    },
    async favorites(userId) {
      return state.favorites.filter((f) => f.userId === userId)
        .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
        .map(({ id, kind, text, createdAt }) => ({ id, kind, text, createdAt }));
    },
    async addFavorite(userId, { text, kind, createdAt }) {
      let fav = state.favorites.find((f) => f.userId === userId && f.text === text);
      if (!fav) {
        fav = { id: state.nextId++, userId, kind, text, createdAt };
        state.favorites.push(fav);
        await save();
      }
      return { id: fav.id, kind: fav.kind, text: fav.text, createdAt: fav.createdAt };
    },
    async removeFavorite(userId, id) {
      const before = state.favorites.length;
      state.favorites = state.favorites.filter((f) => !(f.id === id && f.userId === userId));
      await save();
      return state.favorites.length < before;
    },
    async attempts(key) { return copy(state.attempts[key]); },
    async saveAttempts(key, value) { state.attempts[key] = { ...value }; await save(); },
    async clearAttempts(key) { delete state.attempts[key]; await save(); },
    async reset() { state = empty(); await persistence.clear(); },
  };
}

// ---- passwords and tokens with the Web Crypto API ----
// scrypt isn't available in browsers, so the demo uses PBKDF2-SHA256, the standard choice there.

const ITERATIONS = 210_000;
const bytesToB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const b64ToBytes = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export const browserPasswords = {
  async hash(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return `pbkdf2$${ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(await pbkdf2(password, salt, ITERATIONS))}`;
  },
  async verify(password, stored) {
    const [scheme, iterations, salt, hash] = String(stored).split('$');
    if (scheme !== 'pbkdf2' || !hash) return false;
    const actual = await pbkdf2(password, b64ToBytes(salt), Number(iterations));
    const expected = b64ToBytes(hash);
    // compare every byte so the time taken doesn't depend on where they differ
    let diff = actual.length ^ expected.length;
    for (let i = 0; i < Math.min(actual.length, expected.length); i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  },
};

export const browserTokens = {
  create() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  async hash(token) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token))));
    return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
};
