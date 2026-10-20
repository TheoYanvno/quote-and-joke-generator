// The account REST API as one plain function: request in, response out.
// The Node server calls it for real HTTP requests, and the GitHub Pages demo calls it directly in the
// browser, so validation, status codes and messages are the same in both.
//
// request:  { method, path, body, token, ip }      token = the session cookie's value, if any
// response: { status, body, session? }             session = { token, expiresAt } to set, or { clear: true }

import { AccountError } from './service.js';

export async function handleApi(service, { method, path, body = {}, token = null, ip = '' }) {
  try {
    const route = `${method} ${path.replace(/\/+$/, '')}`;

    if (route === 'GET /api/health') return ok({ ok: true });

    if (route === 'POST /api/signup') {
      const s = await service.signup(body ?? {});
      return { status: 201, body: { user: s.user }, session: { token: s.token, expiresAt: s.expiresAt } };
    }

    if (route === 'POST /api/login') {
      const s = await service.login(body ?? {}, { ip });
      return { status: 200, body: { user: s.user }, session: { token: s.token, expiresAt: s.expiresAt } };
    }

    if (route === 'POST /api/logout') {
      await service.logout(token);
      return { status: 200, body: { ok: true }, session: { clear: true } };
    }

    const user = await service.userForToken(token);

    if (route === 'GET /api/me') {
      // a stale cookie gets cleared so the browser stops sending it
      return { status: 200, body: { user }, ...(token && !user ? { session: { clear: true } } : {}) };
    }

    if (path.startsWith('/api/favorites')) {
      if (!user) return error(401, 'Please log in to see your saved favorites.');

      if (route === 'GET /api/favorites') return ok({ favorites: await service.favorites(user.id) });

      if (route === 'POST /api/favorites') {
        const favorite = await service.addFavorite(user.id, body ?? {});
        return { status: 201, body: { favorite } };
      }

      if (route === 'POST /api/favorites/import') {
        const added = await service.importFavorites(user.id, body?.items);
        return ok({ added, favorites: await service.favorites(user.id) });
      }

      const match = /^DELETE \/api\/favorites\/(\d+)$/.exec(route);
      if (match) {
        await service.removeFavorite(user.id, Number(match[1]));
        return { status: 204, body: null };
      }
    }

    return error(404, 'Not found.');
  } catch (err) {
    if (err instanceof AccountError) {
      return error(err.status, err.message, {
        ...(err.fields ? { fields: err.fields } : {}),
        ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}),
        ...(err.attemptsLeft !== undefined && err.attemptsLeft > 0 ? { attemptsLeft: err.attemptsLeft } : {}),
      });
    }
    console.error(err);
    return error(500, 'Something went wrong on our end. Please try again.');
  }
}

const ok = (body) => ({ status: 200, body });
const error = (status, message, extra = {}) => ({ status, body: { error: message, ...extra } });
