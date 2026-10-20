// The GitHub Pages demo runs the same AccountService and routes with browser storage and Web Crypto.
// Node has Web Crypto built in, so it can be tested here with an in-memory stand-in for IndexedDB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountService } from '../src/accounts/service.js';
import { handleApi } from '../src/accounts/routes.js';
import { openBrowserStore, memoryPersistence, browserPasswords, browserTokens } from '../src/accounts/browser-store.js';

async function demo(persistence = memoryPersistence()) {
  const store = await openBrowserStore(persistence);
  const service = new AccountService({ store, passwords: browserPasswords, tokens: browserTokens });
  let token = null;
  const call = async (method, path, body) => {
    const r = await handleApi(service, { method, path, body, token });
    if (r.session) token = r.session.clear ? null : r.session.token;
    return r;
  };
  return { call, store, persistence };
}

test('PBKDF2 password hashes are salted and verify', async () => {
  const a = await browserPasswords.hash('goodpassword1');
  assert.match(a, /^pbkdf2\$210000\$/);
  assert.notEqual(a, await browserPasswords.hash('goodpassword1'));
  assert.equal(await browserPasswords.verify('goodpassword1', a), true);
  assert.equal(await browserPasswords.verify('goodpassword2', a), false);
});

test('tokens are random and URL-safe; only their SHA-256 hash is stored', async () => {
  const t = browserTokens.create();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(t, browserTokens.create());
  assert.match(await browserTokens.hash(t), /^[0-9a-f]{64}$/);
});

test('the same API works in the demo: sign up, favorites, log out, log in', async () => {
  const { call } = await demo();
  assert.equal((await call('POST', '/api/signup', { username: 'Barbara', password: 'oracle1234' })).status, 201);
  const fav = await call('POST', '/api/favorites', { text: 'Well done is better than well said.', kind: 'quote' });
  assert.equal(fav.status, 201);
  assert.equal((await call('POST', '/api/logout', {})).status, 200);
  assert.equal((await call('GET', '/api/favorites')).status, 401);
  assert.equal((await call('POST', '/api/login', { username: 'barbara', password: 'oracle1234' })).status, 200);
  assert.deepEqual((await call('GET', '/api/favorites')).body.favorites.map((f) => f.text), ['Well done is better than well said.']);
  assert.equal((await call('POST', '/api/signup', { username: 'barbara', password: 'another123' })).status, 409);
});

test('demo data survives a reload (it is saved through the persistence layer)', async () => {
  const persistence = memoryPersistence();
  const first = await demo(persistence);
  await first.call('POST', '/api/signup', { username: 'alfred', password: 'butler1234' });
  const second = await demo(persistence);                      // like opening the page again
  assert.equal((await second.call('POST', '/api/login', { username: 'alfred', password: 'butler1234' })).status, 200);
});
