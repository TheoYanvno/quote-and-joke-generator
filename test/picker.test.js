import test from 'node:test';
import assert from 'node:assert';
import { nextIndex, dailyIndex, filterByTag, allTags, formatQuote } from '../src/picker.js';
import { QUOTES, JOKES } from '../src/data.js';

test('never repeats the same item twice in a row', () => {
  for (let last = 0; last < 5; last++) {
    for (const r of [0, 0.3, 0.6, 0.99]) assert.notStrictEqual(nextIndex(5, last, () => r), last);
  }
  assert.strictEqual(nextIndex(1, 0), 0);
});

test('every index is reachable', () => {
  const seen = new Set();
  for (let k = 0; k < 400; k++) seen.add(nextIndex(6, 2));
  assert.deepStrictEqual([...seen].sort(), [0, 1, 3, 4, 5]);
});

test('daily pick is stable within a day and changes across days', () => {
  const a = dailyIndex(28, new Date(2026, 9, 14, 8)), b = dailyIndex(28, new Date(2026, 9, 14, 22));
  assert.strictEqual(a, b);
  const week = new Set([...Array(7)].map((_, d) => dailyIndex(28, new Date(2026, 9, 14 + d))));
  assert.ok(week.size > 1);
});

test('filters and tags', () => {
  assert.ok(filterByTag(JOKES, 'tech').every((j) => j.tags.includes('tech')));
  assert.strictEqual(filterByTag(QUOTES, 'all').length, QUOTES.length);
  assert.ok(allTags(JOKES).includes('medical'));
});

test('data is complete', () => {
  for (const q of QUOTES) assert.ok(q.text && q.author && q.source && q.tags.length);
  for (const j of JOKES) assert.ok(j.setup && j.punchline && j.tags.length);
  assert.match(formatQuote(QUOTES[0]), /— Socrates/);
});
