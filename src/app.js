import { QUOTES, JOKES } from './data.js';
import { nextIndex, dailyIndex, filterByTag, allTags, formatQuote, formatJoke } from './picker.js';
import { connect, ApiError } from './api.js';

const $ = (id) => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Favorites saved while logged out stay in this browser (a list of strings, as before accounts existed)
const local = {
  get: () => { try { return JSON.parse(localStorage.getItem('qj-favorites')) ?? []; } catch { return []; } },
  set: (v) => { try { localStorage.setItem('qj-favorites', JSON.stringify(v)); } catch { /* private mode */ } },
};
const JOKE_TEXTS = new Set(JOKES.map(formatJoke));
const kindOf = (text) => (JOKE_TEXTS.has(text) ? 'joke' : 'quote');

let api = { mode: 'off', call: null };
let user = null;                 // { id, username } when logged in
let favorites = [];              // [{ id?, text, kind }]: the account's when logged in, else this browser's

let mode = 'quote';
let last = { quote: -1, joke: -1 };
let current = null;
let typing = null;

const pool = () => filterByTag(mode === 'quote' ? QUOTES : JOKES, $('tag').value);
const asText = (item) => (item.setup ? formatJoke(item) : formatQuote(item));

function setMode(next) {
  mode = next;
  document.body.className = next;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === next)));
  $('generator').hidden = next === 'fav';
  $('favorites').hidden = next !== 'fav';
  if (next === 'fav') return renderFavorites();
  const items = next === 'quote' ? QUOTES : JOKES;
  $('tag').innerHTML = ['all', ...allTags(items)].map((t) => `<option value="${t}">${t === 'all' ? 'Everything' : t[0].toUpperCase() + t.slice(1)}</option>`).join('');
  show(items[dailyIndex(items.length)], true);
}

function typeText(el, text, done) {
  clearInterval(typing);
  if (reduced) { el.textContent = text; return done?.(); }
  el.textContent = '';
  el.classList.add('typing');
  let i = 0;
  typing = setInterval(() => {
    el.textContent = text.slice(0, ++i);
    if (i >= text.length) { clearInterval(typing); el.classList.remove('typing'); done?.(); }
  }, 22);
}

function show(item, isDaily = false) {
  current = item;
  $('card').classList.remove('flip'); void $('card').offsetWidth; $('card').classList.add('flip');
  $('daily').hidden = !isDaily;
  $('sub').className = 'sub';
  $('sub').textContent = '';
  $('reveal').hidden = true;
  if (item.setup) {
    typeText($('main'), item.setup, () => { $('reveal').hidden = false; $('reveal').focus({ preventScroll: true }); });
  } else {
    typeText($('main'), `“${item.text}”`, () => { $('sub').textContent = `— ${item.author}, ${item.source}`; });
  }
  const saved = favorites.some((f) => f.text === asText(item));
  $('save').textContent = saved ? '★ Saved' : '☆ Save';
  $('share').href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(asText(item))}`;
}

function next() {
  const items = pool();
  const i = nextIndex(items.length, items.indexOf(current));
  show(items[i]);
}

function revealPunchline() {
  if (!current?.setup) return;
  $('reveal').hidden = true;
  $('sub').className = 'sub punch';
  $('sub').textContent = current.punchline;
}

function toast(msg) {
  $('toast').textContent = msg;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { $('toast').textContent = ''; }, 1800);
}

async function loadFavorites() {
  if (user) {
    try { favorites = (await api.call('GET', '/api/favorites')).favorites; } catch (err) { toast(err.message); }
  } else {
    favorites = local.get().map((text) => ({ text, kind: kindOf(text) }));
  }
}

async function toggleSave() {
  const text = asText(current);
  const existing = favorites.find((f) => f.text === text);
  try {
    if (user) {
      if (existing) await api.call('DELETE', `/api/favorites/${existing.id}`);
      else await api.call('POST', '/api/favorites', { text, kind: current.setup ? 'joke' : 'quote' });
      await loadFavorites();
    } else {
      local.set(existing ? local.get().filter((f) => f !== text) : [text, ...local.get()]);
      await loadFavorites();
    }
  } catch (err) {
    return toast(err.status === 401 ? 'Your session ended. Please log in again.' : err.message);
  }
  $('save').textContent = existing ? '☆ Save' : '★ Saved';
  toast(existing ? 'Removed from saved' : user ? 'Saved to your account!' : 'Saved!');
}

function renderFavorites() {
  $('favEmpty').hidden = favorites.length > 0;
  $('favList').innerHTML = favorites.map((f, i) => `<li><span>${f.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span><button data-i="${i}" aria-label="Remove">✕</button></li>`).join('');
  if (api.mode === 'off') $('favWhere').textContent = 'Saved in this browser.';
  else if (user) $('favWhere').textContent = api.mode === 'demo' ? `Saved to ${user.username}'s demo account (in this browser).` : `Saved to ${user.username}'s account, on any device.`;
  else $('favWhere').innerHTML = 'Saved in this browser only. <button id="favLogin" class="ghost">Log in</button> to keep them in an account.';
  $('favLogin')?.addEventListener('click', () => openAuth('login'));
}

document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
$('tag').onchange = next;
$('next').onclick = next;
$('reveal').onclick = revealPunchline;
$('save').onclick = toggleSave;
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(asText(current)); toast('Copied to clipboard'); } catch { toast('Copy not allowed here'); }
};
$('favList').onclick = async (e) => {
  const i = e.target.dataset.i;
  if (i === undefined) return;
  const fav = favorites[Number(i)];
  try {
    if (user) await api.call('DELETE', `/api/favorites/${fav.id}`);
    else local.set(local.get().filter((f) => f !== fav.text));
  } catch (err) {
    toast(err.message);
  }
  await loadFavorites();
  renderFavorites();
};
addEventListener('keydown', (e) => {
  if (e.target.matches('select, input') || mode === 'fav') return;
  if (e.code === 'Space') { e.preventDefault(); current?.setup && !$('reveal').hidden ? revealPunchline() : next(); }
});

// ---- accounts: log in, create an account, log out ----

let authMode = 'login';

function openAuth(mode) {
  setAuthMode(mode);
  $('authForm').reset();
  clearAuthErrors();
  $('authDialog').showModal();
  $('username').focus();
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  document.querySelectorAll('[data-auth]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.auth === mode)));
  $('authTitle').textContent = signup ? 'Create your account' : 'Welcome back';
  $('authNote').textContent = signup
    ? 'Your favorites will be saved to your account so they follow you to any device.'
    : 'Log in to see your saved quotes and jokes on any device.';
  $('authSubmit').textContent = signup ? 'Create account' : 'Log in';
  $('password').autocomplete = signup ? 'new-password' : 'current-password';
  $('pwHint').hidden = !signup;
  clearAuthErrors();
}

function clearAuthErrors() {
  for (const f of ['username', 'password']) { $(`${f}Error`).textContent = ''; $(f).removeAttribute('aria-invalid'); }
  $('authError').textContent = '';
}

document.querySelectorAll('[data-auth]').forEach((b) => (b.onclick = () => setAuthMode(b.dataset.auth)));
$('authCancel').onclick = () => $('authDialog').close();
$('showPw').onclick = () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('showPw').textContent = show ? 'Hide' : 'Show';
  $('showPw').setAttribute('aria-pressed', String(show));
};

$('authForm').onsubmit = async (e) => {
  e.preventDefault();
  clearAuthErrors();
  const body = { username: $('username').value.trim(), password: $('password').value };
  if (!body.username) { $('usernameError').textContent = 'Enter a username.'; $('username').setAttribute('aria-invalid', 'true'); return $('username').focus(); }
  if (!body.password) { $('passwordError').textContent = 'Enter a password.'; $('password').setAttribute('aria-invalid', 'true'); return $('password').focus(); }

  $('authSubmit').disabled = true;
  try {
    const res = await api.call('POST', authMode === 'signup' ? '/api/signup' : '/api/login', body);
    user = res.user;
    // move anything saved in this browser into the account, so nothing is lost
    const pending = local.get().map((text) => ({ text, kind: kindOf(text) }));
    let moved = 0;
    if (pending.length) {
      moved = (await api.call('POST', '/api/favorites/import', { items: pending })).added;
      local.set([]);
    }
    $('authDialog').close();
    await afterAuthChange();
    toast(`${authMode === 'signup' ? 'Account created' : 'Logged in'} as ${user.username}.${moved ? ` ${moved} saved item${moved === 1 ? '' : 's'} moved to your account.` : ''}`);
  } catch (err) {
    if (!(err instanceof ApiError)) { $('authError').textContent = api.mode === 'demo' ? 'Something went wrong saving in this browser.' : 'Could not reach the server. Check your connection.'; return; }
    for (const [field, message] of Object.entries(err.fields)) {
      $(`${field}Error`).textContent = message;
      $(field).setAttribute('aria-invalid', 'true');
    }
    if (!Object.keys(err.fields).length) $('authError').textContent = err.message;
  } finally {
    $('authSubmit').disabled = false;
  }
};

$('loginBtn').onclick = () => openAuth('login');
$('logoutBtn').onclick = async () => {
  try { await api.call('POST', '/api/logout', {}); } catch { /* the session is gone either way */ }
  user = null;
  await afterAuthChange();
  toast('Logged out.');
};

async function afterAuthChange() {
  $('who').hidden = !user;
  $('who').textContent = user ? `👤 ${user.username}` : '';
  $('loginBtn').hidden = !!user;
  $('logoutBtn').hidden = !user;
  await loadFavorites();
  if (mode === 'fav') renderFavorites();
  else if (current) $('save').textContent = favorites.some((f) => f.text === asText(current)) ? '★ Saved' : '☆ Save';
}

async function start() {
  api = await connect();
  if (api.mode !== 'off') {
    $('account').hidden = false;
    $('demoBadge').hidden = api.mode !== 'demo';
    $('demoNote').hidden = api.mode !== 'demo';
    try { user = (await api.call('GET', '/api/me')).user; } catch { user = null; }
  }
  await afterAuthChange();
}

setMode('quote');
start();
