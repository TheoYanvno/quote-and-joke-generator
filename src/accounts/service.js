// Accounts and saved favorites: the rules, independent of where data is stored.
//
// The same service runs in two places:
//   - the Node server, with SQLite storage and scrypt password hashing (server/)
//   - the GitHub Pages demo, with IndexedDB storage and PBKDF2 hashing in the browser (src/accounts/browser-store.js)
//
// `store` saves and loads rows; `passwords` hashes and checks passwords; `tokens` makes random session tokens.

export const SESSION_DAYS = 30;
export const MAX_FAILED_LOGINS = 5;          // per username, within the window below
export const LOCKOUT_MINUTES = 15;
export const MAX_FAVORITES = 500;

export class AccountError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

/** Usernames are case-insensitive: "Anthony" and "anthony" are the same account. */
export const normalizeUsername = (name) => String(name ?? '').trim().toLowerCase();

export function validateSignup({ username, password }) {
  const errors = {};
  const name = normalizeUsername(username);
  if (!/^[a-z0-9_]{3,20}$/.test(name)) errors.username = 'Use 3-20 letters, numbers or underscores.';
  const pw = String(password ?? '');
  if (pw.length < 8) errors.password = 'Use at least 8 characters.';
  else if (pw.length > 128) errors.password = 'Use 128 characters or fewer.';
  else if (pw.toLowerCase() === name) errors.password = "Your password can't be your username.";
  return errors;
}

export function validateFavorite({ text, kind }) {
  const t = String(text ?? '').trim();
  if (!t) return 'Nothing to save.';
  if (t.length > 1000) return 'That is too long to save.';
  if (!['quote', 'joke'].includes(kind)) return 'Kind must be "quote" or "joke".';
  return null;
}

export class AccountService {
  constructor({ store, passwords, tokens, now = () => Date.now() }) {
    this.store = store;
    this.passwords = passwords;
    this.tokens = tokens;
    this.now = now;
  }

  // ---- sign up, log in, log out ----

  async signup({ username, password }) {
    const errors = validateSignup({ username, password });
    if (Object.keys(errors).length) throw new AccountError(400, 'Please fix the highlighted fields.', { fields: errors });
    const name = normalizeUsername(username);
    if (await this.store.userByName(name)) {
      throw new AccountError(409, 'That username is taken.', { fields: { username: 'That username is taken.' } });
    }
    const passwordHash = await this.passwords.hash(password);
    let id;
    try {
      id = await this.store.createUser({ username: name, passwordHash, createdAt: this.now() });
    } catch (err) {
      // two sign-ups with the same name at the same moment: the database's unique rule catches the second
      if (err.code === 'DUPLICATE') throw new AccountError(409, 'That username is taken.', { fields: { username: 'That username is taken.' } });
      throw err;
    }
    return this.#startSession(id, name);
  }

  async login({ username, password }, { ip = '' } = {}) {
    const name = normalizeUsername(username);
    const key = `login:${name}`;
    await this.#checkLockout(key);

    const user = name ? await this.store.userByName(name) : null;
    // Hash even when the user doesn't exist, so the response time doesn't reveal which usernames exist
    const ok = user
      ? await this.passwords.verify(String(password ?? ''), user.passwordHash)
      : (await this.passwords.hash(String(password ?? '')), false);

    if (!ok) {
      const left = await this.#recordFailure(key, ip);
      throw new AccountError(401, left > 0
        ? 'Wrong username or password.'
        : `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`, { attemptsLeft: left });
    }
    await this.store.clearAttempts(key);
    return this.#startSession(user.id, user.username);
  }

  async logout(token) {
    if (token) await this.store.deleteSession(await this.tokens.hash(token));
  }

  /** The signed-in user for a session token, or null. Expired sessions are removed. */
  async userForToken(token) {
    if (!token) return null;
    const tokenHash = await this.tokens.hash(token);
    const session = await this.store.session(tokenHash);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      await this.store.deleteSession(tokenHash);
      return null;
    }
    const user = await this.store.userById(session.userId);
    return user ? { id: user.id, username: user.username } : null;
  }

  // ---- favorites ----

  async favorites(userId) {
    return this.store.favorites(userId);
  }

  async addFavorite(userId, { text, kind }) {
    const problem = validateFavorite({ text, kind });
    if (problem) throw new AccountError(400, problem);
    if ((await this.store.favorites(userId)).length >= MAX_FAVORITES) {
      throw new AccountError(400, `You can save up to ${MAX_FAVORITES} favorites.`);
    }
    // saving the same text twice keeps one copy
    return this.store.addFavorite(userId, { text: String(text).trim(), kind, createdAt: this.now() });
  }

  async removeFavorite(userId, favoriteId) {
    const removed = await this.store.removeFavorite(userId, Number(favoriteId));
    if (!removed) throw new AccountError(404, 'That favorite was not found.');
  }

  /** Adds favorites saved while logged out to the account, skipping ones it already has. */
  async importFavorites(userId, items) {
    if (!Array.isArray(items)) throw new AccountError(400, 'Expected a list of favorites.');
    let added = 0;
    for (const item of items.slice(0, MAX_FAVORITES)) {
      if (validateFavorite(item)) continue;
      const before = (await this.store.favorites(userId)).length;
      if (before >= MAX_FAVORITES) break;
      await this.store.addFavorite(userId, { text: String(item.text).trim(), kind: item.kind, createdAt: this.now() });
      if ((await this.store.favorites(userId)).length > before) added++;
    }
    return added;
  }

  // ---- helpers ----

  async #startSession(userId, username) {
    const token = this.tokens.create();
    const expiresAt = this.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    await this.store.createSession({ tokenHash: await this.tokens.hash(token), userId, expiresAt });
    return { token, expiresAt, user: { id: userId, username } };
  }

  async #checkLockout(key) {
    const a = await this.store.attempts(key);
    if (!a) return;
    const windowMs = LOCKOUT_MINUTES * 60 * 1000;
    if (this.now() - a.firstAt > windowMs) return this.store.clearAttempts(key);
    if (a.count >= MAX_FAILED_LOGINS) {
      const minutes = Math.ceil((a.firstAt + windowMs - this.now()) / 60000);
      throw new AccountError(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, { retryAfter: minutes * 60 });
    }
  }

  async #recordFailure(key, ip) {
    const a = await this.store.attempts(key);
    const fresh = !a || this.now() - a.firstAt > LOCKOUT_MINUTES * 60 * 1000;
    const next = fresh ? { count: 1, firstAt: this.now(), ip } : { ...a, count: a.count + 1, ip };
    await this.store.saveAttempts(key, next);
    return MAX_FAILED_LOGINS - next.count;
  }
}
