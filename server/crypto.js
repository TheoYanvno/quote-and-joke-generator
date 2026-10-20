// Password hashing and session tokens for the Node server, with the built-in crypto module.
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

// scrypt settings: N = CPU/memory cost (16384 uses about 16 MB), r = block size, p = parallelism
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

const scryptAsync = (password, salt, n, r, p) =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });

export const passwords = {
  /** A new random salt for every password, so two people with the same password get different hashes. */
  async hash(password) {
    const salt = randomBytes(16);
    const key = await scryptAsync(String(password).normalize('NFKC'), salt, N, R, P);
    return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
  },

  async verify(password, stored) {
    const [scheme, n, r, p, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt' || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = await scryptAsync(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
    // compares in constant time, so timing doesn't leak how many bytes matched
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  },
};

export const tokens = {
  create: () => randomBytes(32).toString('base64url'),          // 256 random bits
  hash: async (token) => createHash('sha256').update(String(token)).digest('hex'),
};
