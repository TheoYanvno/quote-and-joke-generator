-- Accounts and favorites for the Node server (SQLite).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 20),
  password_hash TEXT    NOT NULL,           -- "scrypt$N$r$p$salt$hash", never the password itself
  created_at    INTEGER NOT NULL            -- milliseconds since 1970
);

-- Only a SHA-256 hash of each session token is stored, so a copy of the database can't be used to log in.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS favorites (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('quote', 'joke')),
  text       TEXT    NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, text)                    -- saving the same item twice keeps one copy
);

-- Failed logins per username, for rate limiting
CREATE TABLE IF NOT EXISTS login_attempts (
  key      TEXT    PRIMARY KEY,
  count    INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_ip  TEXT
);
