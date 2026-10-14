// Pure helpers: easy to test without a browser.

/** Random index that is never the same as the last one (when there is a choice). */
export function nextIndex(length, last, rand = Math.random) {
  if (length <= 1) return 0;
  let i = Math.floor(rand() * (length - 1));
  if (i >= last && last >= 0) i += 1;      // skip over the previous pick
  return i;
}

/** Same item all day, a new one tomorrow: seeded by the date. */
export function dailyIndex(length, date = new Date()) {
  const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % length;
}

export const filterByTag = (items, tag) => (tag === 'all' ? items : items.filter((i) => i.tags.includes(tag)));

export const allTags = (items) => [...new Set(items.flatMap((i) => i.tags))].sort();

export const formatQuote = (q) => `“${q.text}” — ${q.author}${q.source ? `, ${q.source}` : ''}`;
export const formatJoke = (j) => `${j.setup} ${j.punchline}`;
