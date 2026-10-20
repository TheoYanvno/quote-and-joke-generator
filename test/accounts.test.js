import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountService, AccountError, MAX_FAILED_LOGINS, validateSignup } from '../src/accounts/service.js';
import { openStore } from '../server/sqlite-store.js';
import { passwords, tokens } from '../server/crypto.js';

function setup() {
  let clock = Date.UTC(2026, 9, 16, 12);
  const store = openStore(':memory:');
  const service = new AccountService({ store, passwords, tokens, now: () => clock });
  return { store, service, advance: (ms) => { clock += ms; } };
}

const rejects = (promise, status, pattern) =>
  assert.rejects(promise, (err) => err instanceof AccountError && err.status === status && (!pattern || pattern.test(err.message)));

test('passwords are hashed with a per-user salt and verified', async () => {
  const a = await passwords.hash('correct horse');
  const b = await passwords.hash('correct horse');
  assert.match(a, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(a, b);                                   // different salts
  assert.equal(await passwords.verify('correct horse', a), true);
  assert.equal(await passwords.verify('wrong horse', a), false);
  assert.equal(await passwords.verify('x', 'not-a-hash'), false);
});

test('signup checks usernames and passwords', () => {
  assert.deepEqual(validateSignup({ username: 'anthony_e', password: 'longenough' }), {});
  assert.ok(validateSignup({ username: 'ab', password: 'longenough' }).username);
  assert.ok(validateSignup({ username: 'has space', password: 'longenough' }).username);
  assert.ok(validateSignup({ username: 'anthony', password: 'short' }).password);
  assert.ok(validateSignup({ username: 'password1', password: 'PASSWORD1' }).password);
});

test('sign up, then log in with the same name in any case', async () => {
  const { service, store } = setup();
  const s = await service.signup({ username: 'Anthony', password: 'hunter2hunter2' });
  assert.equal(s.user.username, 'anthony');
  assert.ok(s.token.length >= 40);
  const row = await store.userByName('anthony');
  assert.doesNotMatch(row.passwordHash, /hunter2/);
  const again = await service.login({ username: 'ANTHONY', password: 'hunter2hunter2' });
  assert.equal(again.user.id, s.user.id);
});

test('a username can only be taken once', async () => {
  const { service } = setup();
  await service.signup({ username: 'bruce', password: 'iamthenight' });
  await rejects(service.signup({ username: 'Bruce', password: 'different1' }), 409, /taken/);
});

test('sessions: token works until logout or expiry, and only its hash is stored', async () => {
  const { service, store, advance } = setup();
  const { token } = await service.signup({ username: 'diana', password: 'themyscira1' });
  assert.equal((await service.userForToken(token)).username, 'diana');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(token).n, 0);
  await service.logout(token);
  assert.equal(await service.userForToken(token), null);

  const second = await service.login({ username: 'diana', password: 'themyscira1' });
  advance(31 * 24 * 60 * 60 * 1000);
  assert.equal(await service.userForToken(second.token), null);
  assert.equal(await service.userForToken('made-up-token'), null);
});

test('wrong passwords are rate limited, and the lock lifts after 15 minutes', async () => {
  const { service, advance } = setup();
  await service.signup({ username: 'clark', password: 'smallville1' });
  for (let i = 1; i < MAX_FAILED_LOGINS; i++) await rejects(service.login({ username: 'clark', password: 'nope' }), 401, /Wrong/);
  await rejects(service.login({ username: 'clark', password: 'nope' }), 401, /Too many/);
  // even the right password is refused while locked
  await rejects(service.login({ username: 'clark', password: 'smallville1' }), 429, /Try again in 15 minutes/);
  advance(15 * 60 * 1000 + 1);
  const ok = await service.login({ username: 'clark', password: 'smallville1' });
  assert.equal(ok.user.username, 'clark');
});

test('unknown usernames get the same message as wrong passwords', async () => {
  const { service } = setup();
  await rejects(service.login({ username: 'nobody', password: 'whatever1' }), 401, /Wrong username or password/);
});

test('favorites belong to one user, ignore duplicates and can be removed', async () => {
  const { service } = setup();
  const a = (await service.signup({ username: 'alfred', password: 'butler1234' })).user;
  const b = (await service.signup({ username: 'selina', password: 'catsuit123' })).user;
  const fav = await service.addFavorite(a.id, { text: 'Well begun is half done.', kind: 'quote' });
  await service.addFavorite(a.id, { text: 'Well begun is half done.', kind: 'quote' });
  await service.addFavorite(a.id, { text: 'Why do programmers prefer dark mode? Because light attracts bugs.', kind: 'joke' });
  assert.equal((await service.favorites(a.id)).length, 2);
  assert.equal((await service.favorites(b.id)).length, 0);

  await rejects(service.removeFavorite(b.id, fav.id), 404);         // can't delete someone else's
  await service.removeFavorite(a.id, fav.id);
  assert.equal((await service.favorites(a.id)).length, 1);
});

test('rejects empty or unknown favorites', async () => {
  const { service } = setup();
  const u = (await service.signup({ username: 'barbara', password: 'oracle1234' })).user;
  await rejects(service.addFavorite(u.id, { text: '  ', kind: 'quote' }), 400);
  await rejects(service.addFavorite(u.id, { text: 'hi', kind: 'poem' }), 400);
});

test('favorites saved while logged out can be imported once', async () => {
  const { service } = setup();
  const u = (await service.signup({ username: 'dick', password: 'nightwing1' })).user;
  await service.addFavorite(u.id, { text: 'A', kind: 'quote' });
  const added = await service.importFavorites(u.id, [{ text: 'A', kind: 'quote' }, { text: 'B', kind: 'joke' }, { text: '', kind: 'joke' }]);
  assert.equal(added, 1);
  assert.deepEqual((await service.favorites(u.id)).map((f) => f.text).sort(), ['A', 'B']);
});
