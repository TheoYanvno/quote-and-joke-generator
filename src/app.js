import { QUOTES, JOKES } from './data.js';
import { nextIndex, dailyIndex, filterByTag, allTags, formatQuote, formatJoke } from './picker.js';

const $ = (id) => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get: () => { try { return JSON.parse(localStorage.getItem('qj-favorites')) ?? []; } catch { return []; } },
  set: (v) => { try { localStorage.setItem('qj-favorites', JSON.stringify(v)); } catch { /* private mode */ } },
};

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
  const saved = store.get().includes(asText(item));
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

function toggleSave() {
  const text = asText(current);
  const favs = store.get();
  const saved = favs.includes(text);
  store.set(saved ? favs.filter((f) => f !== text) : [text, ...favs]);
  $('save').textContent = saved ? '☆ Save' : '★ Saved';
  toast(saved ? 'Removed from saved' : 'Saved!');
}

function renderFavorites() {
  const favs = store.get();
  $('favEmpty').hidden = favs.length > 0;
  $('favList').innerHTML = favs.map((f, i) => `<li><span>${f.replace(/</g, '&lt;')}</span><button data-i="${i}" aria-label="Remove">✕</button></li>`).join('');
}

document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
$('tag').onchange = next;
$('next').onclick = next;
$('reveal').onclick = revealPunchline;
$('save').onclick = toggleSave;
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(asText(current)); toast('Copied to clipboard'); } catch { toast('Copy not allowed here'); }
};
$('favList').onclick = (e) => {
  const i = e.target.dataset.i;
  if (i === undefined) return;
  const favs = store.get(); favs.splice(Number(i), 1); store.set(favs); renderFavorites();
};
addEventListener('keydown', (e) => {
  if (e.target.matches('select, input') || mode === 'fav') return;
  if (e.code === 'Space') { e.preventDefault(); current?.setup && !$('reveal').hidden ? revealPunchline() : next(); }
});

setMode('quote');
