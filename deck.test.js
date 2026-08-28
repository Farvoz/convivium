// Тесты сборки колоды (правило композиции) — без DOM, с seeded RNG.
import './cards.js';
import './engine.js';

import { test } from 'node:test';
import assert from 'node:assert';
const C = globalThis.Convivium;

// детерминированный RNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isHarmful = (c) => C.isThreat(c) || c.arrow === 'down';
const harmfulTotal = globalThis.cards.filter(isHarmful).length;
const countHarmful = (deck) => deck.filter(isHarmful).length;

test('buildDeck: длина = все карты минус лишние вредные (только 3 инъектируются)', () => {
  const deck = C.buildDeck();
  const expected = globalThis.cards.length - Math.max(0, harmfulTotal - 3);
  assert.equal(deck.length, expected);
});

test('buildDeck: «Обход» присутствует', () => {
  const deck = C.buildDeck();
  assert.ok(deck.some((c) => c.name === 'Обход'));
});

test('buildDeck: ровно 3 вредные карты в колоде (дефолт)', () => {
  const deck = C.buildDeck();
  assert.equal(countHarmful(deck), 3);
});

test('buildDeck: первые 3 — это prep (не вредные)', () => {
  const deck = C.buildDeck();
  const prep = deck.slice(0, 3);
  assert.equal(prep.length, 3);
  for (const c of prep) assert.equal(isHarmful(c), false, `prep содержит вредную: ${c.name}`);
});

test('buildDeck: createGame не падает, статус playing', () => {
  const game = C.createGame({ deck: C.buildDeck() });
  assert.equal(game.status, 'playing');
});

test('buildDeck: детерминизм при одном seed', () => {
  const a = C.buildDeck({}, rng(42));
  const b = C.buildDeck({}, rng(42));
  assert.deepEqual(a.map((c) => c.name), b.map((c) => c.name));
});

test('buildDeck: withObhod:false убирает «Обход» и оставляет 3 вредные', () => {
  const deck = C.buildDeck({ withObhod: false });
  assert.equal(deck.some((c) => c.name === 'Обход'), false);
  assert.equal(countHarmful(deck), 3);
});
