// SQLite storage for the account service, using Node's built-in node:sqlite (no packages to install).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const SCHEMA = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');

export function openStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  // Prepared statements with ? placeholders: user input is never pasted into SQL
  const q = {
    createUser: db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'),
    userByName: db.prepare('SELECT id, username, password_hash AS passwordHash FROM users WHERE username = ?'),
    userById: db.prepare('SELECT id, username FROM users WHERE id = ?'),
    createSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    session: db.prepare('SELECT user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    favorites: db.prepare('SELECT id, kind, text, created_at AS createdAt FROM favorites WHERE user_id = ? ORDER BY created_at DESC, id DESC'),
    addFavorite: db.prepare('INSERT INTO favorites (user_id, kind, text, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, text) DO NOTHING'),
    findFavorite: db.prepare('SELECT id, kind, text, created_at AS createdAt FROM favorites WHERE user_id = ? AND text = ?'),
    removeFavorite: db.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?'),
    attempts: db.prepare('SELECT count, first_at AS firstAt, last_ip AS ip FROM login_attempts WHERE key = ?'),
    saveAttempts: db.prepare(`INSERT INTO login_attempts (key, count, first_at, last_ip) VALUES (?, ?, ?, ?)
                              ON CONFLICT (key) DO UPDATE SET count = excluded.count, first_at = excluded.first_at, last_ip = excluded.last_ip`),
    clearAttempts: db.prepare('DELETE FROM login_attempts WHERE key = ?'),
  };
  const plain = (row) => (row ? { ...row } : null);       // node:sqlite rows have a null prototype

  return {
    db,
    async createUser({ username, passwordHash, createdAt }) {
      try {
        return Number(q.createUser.run(username, passwordHash, createdAt).lastInsertRowid);
      } catch (err) {
        if (/UNIQUE constraint failed: users.username/.test(err.message)) err.code = 'DUPLICATE';
        throw err;
      }
    },
    async userByName(name) { return plain(q.userByName.get(name)); },
    async userById(id) { return plain(q.userById.get(id)); },
    async createSession({ tokenHash, userId, expiresAt }) { q.createSession.run(tokenHash, userId, expiresAt); },
    async session(tokenHash) { return plain(q.session.get(tokenHash)); },
    async deleteSession(tokenHash) { q.deleteSession.run(tokenHash); },
    async deleteExpiredSessions(now) { return Number(q.deleteExpired.run(now).changes); },
    async favorites(userId) { return q.favorites.all(userId).map(plain); },
    async addFavorite(userId, { text, kind, createdAt }) {
      q.addFavorite.run(userId, kind, text, createdAt);
      return plain(q.findFavorite.get(userId, text));
    },
    async removeFavorite(userId, id) { return Number(q.removeFavorite.run(id, userId).changes) > 0; },
    async attempts(key) { return plain(q.attempts.get(key)); },
    async saveAttempts(key, { count, firstAt, ip }) { q.saveAttempts.run(key, count, firstAt, ip ?? null); },
    async clearAttempts(key) { q.clearAttempts.run(key); },
    close() { db.close(); },
  };
}
