// End-to-end tests: a real server on a random port with an in-memory database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, parseCookies, sessionCookie, ipLimiter } from '../server/server.js';

async function start() {
  const server = createApp();
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = /Max-Age=0/.test(set) ? '' : set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: set, headers: res.headers };
  };
  return { server, call, base, getCookie: () => cookie, setCookie: (c) => { cookie = c; } };
}

test('sign up sets an HttpOnly, SameSite session cookie and /api/me knows who you are', async (t) => {
  const { server, call } = await start();
  t.after(() => server.close());
  const r = await call('POST', '/api/signup', { username: 'Bruce', password: 'iamthenight' });
  assert.equal(r.status, 201);
  assert.match(r.setCookie, /^qj_session=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+/);
  assert.equal((await call('GET', '/api/me')).body.user.username, 'bruce');
});

test('favorites need a login and are saved per user', async (t) => {
  const { server, call, setCookie } = await start();
  t.after(() => server.close());
  assert.equal((await call('GET', '/api/favorites')).status, 401);

  await call('POST', '/api/signup', { username: 'selina', password: 'catsuit123' });
  const added = await call('POST', '/api/favorites', { text: 'Fortune favors the bold.', kind: 'quote' });
  assert.equal(added.status, 201);
  const list = await call('GET', '/api/favorites');
  assert.deepEqual(list.body.favorites.map((f) => f.text), ['Fortune favors the bold.']);

  const del = await call('DELETE', `/api/favorites/${added.body.favorite.id}`);
  assert.equal(del.status, 204);
  assert.equal((await call('GET', '/api/favorites')).body.favorites.length, 0);

  // another account can't see them
  setCookie('');
  await call('POST', '/api/signup', { username: 'harvey', password: 'twofaces12' });
  assert.equal((await call('GET', '/api/favorites')).body.favorites.length, 0);
});

test('logout clears the cookie and ends the session on the server', async (t) => {
  const { server, call, getCookie, setCookie } = await start();
  t.after(() => server.close());
  await call('POST', '/api/signup', { username: 'lucius', password: 'applied123' });
  const old = getCookie();
  const out = await call('POST', '/api/logout', {});
  assert.match(out.setCookie, /Max-Age=0/);
  setCookie(old);                                     // replaying the old cookie doesn't work
  assert.equal((await call('GET', '/api/me')).body.user, null);
});

test('login errors: wrong password, then locked with Retry-After', async (t) => {
  const { server, call, setCookie } = await start();
  t.after(() => server.close());
  await call('POST', '/api/signup', { username: 'jason', password: 'redhood123' });
  setCookie('');
  const wrong = await call('POST', '/api/login', { username: 'jason', password: 'nope' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.attemptsLeft, 4);
  for (let i = 0; i < 4; i++) await call('POST', '/api/login', { username: 'jason', password: 'nope' });
  const locked = await call('POST', '/api/login', { username: 'jason', password: 'redhood123' });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
});

test('signup validation errors name the fields', async (t) => {
  const { server, call } = await start();
  t.after(() => server.close());
  const r = await call('POST', '/api/signup', { username: 'x', password: '1' });
  assert.equal(r.status, 400);
  assert.ok(r.body.fields.username && r.body.fields.password);
});

test('blocks cross-site and non-JSON requests', async (t) => {
  const { server, call } = await start();
  t.after(() => server.close());
  const evil = await call('POST', '/api/login', { username: 'a', password: 'b' }, { Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const form = await call('POST', '/api/login', null, { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
});

test('serves the app but not the database, tests or server code', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/src/app.js')).status, 200);
  for (const path of ['/server/server.js', '/package.json', '/test/server.test.js', '/../etc/passwd', '/src/../sql/schema.sql']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('helpers: cookie parsing, cookie flags and the per-IP limiter', () => {
  assert.deepEqual(parseCookies('a=1; qj_session=abc%3D; b=2'), { a: '1', qj_session: 'abc=', b: '2' });
  assert.match(sessionCookie({ token: 't', expiresAt: Date.now() + 60000 }, { secure: true }), /; Secure; Max-Age=(59|60)$/);
  let clock = 0;
  const allow = ipLimiter({ max: 2, windowMs: 1000, now: () => clock });
  assert.deepEqual([allow('1.1.1.1'), allow('1.1.1.1'), allow('1.1.1.1'), allow('2.2.2.2')], [true, true, false, true]);
  clock = 1001;
  assert.equal(allow('1.1.1.1'), true);
});
