import { test } from 'node:test';
import assert from 'node:assert/strict';

// cards.js / engine.js выставляют данные и API через globalThis
import './cards.js';
import './engine.js';
const { cards } = globalThis;
const {
  createGame, setup, takeTurn, runTurnStart, resolveTop, getScore, getState, activate, deriveThreatCount, deriveScoreBreakdown, deriveBuyCost, validateCards, checkAttachInvariant, cloneCard,
} = globalThis.Convivium;

// ---- helpers -------------------------------------------------------------

const byName = Object.fromEntries(cards.map((c) => [c.name, c]));

// Порядок колоды: индекс 0 = низ, последний элемент = верх (снимается первым).
function makeGame(order, choose, rng) {
  const deck = order.map((name) => cloneCard(byName[name]));
  const game = createGame({ deck, rng });
  const chooseFn = typeof choose === 'function'
    ? choose
    : (opts) => opts.find((c) => c.name === choose) || opts[0];
  return setup(game, { choose: chooseFn });
}

// Снять карты, пока игра не закончится (для тестов победы/поражения).
function runToEnd(game, action = 'buy') {
  let guard = 0;
  while (game.status === 'playing' && guard++ < 1000) {
    game = takeTurn(game, action);
  }
  return game;
}

// ---- A. Подготовка / setup ----------------------------------------------

test('A1: после подготовки энергия равна 2', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  assert.equal(getState(game).energy, 2);
});

test('A2: ровно 1 из 3 открытых карт в Доме, остальные 2 в сбросе', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  const s = getState(game);
  assert.equal(s.home.length, 1);
  assert.equal(s.home[0].name, 'Ваня');
  assert.equal(s.discard.length, 2);
  const names = s.discard.map((c) => c.name).sort();
  assert.deepEqual(names, ['Денис', 'Оля']);
});

test('A3: свободная карта в Дом не тратит энергию', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  assert.equal(getState(game).energy, 2);
});

// ---- B. Общий флоу хода --------------------------------------------------

test('B1: сброс обычной карты даёт +1 энергия и кладёт в сброс', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  const before = getState(game).energy;
  game = takeTurn(game, 'discard');
  const s = getState(game);
  assert.equal(s.energy, before + 1);
  assert.equal(s.discard.some((c) => c.name === 'Комната 402'), true);
  assert.equal(s.home.some((c) => c.name === 'Комната 402'), false);
});

test('B2: покупка тратит 2 энергии и кладёт в Дом', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Тост'], 'Ваня');
  const before = getState(game).energy;
  game = takeTurn(game, 'buy');
  const s = getState(game);
  assert.equal(s.energy, before - 2);
  assert.equal(s.home.some((c) => c.name === 'Тост'), true);
});

test('B3: при энергии < 2 покупка недоступна — выбрасывается ошибка', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Тост', 'Комната 402'], 'Ваня');
  game = takeTurn(game, 'buy');
  assert.equal(getState(game).energy, 0);
  assert.throws(() => takeTurn(game, 'buy'), /energy/i);
});

test('B4: карта со стрелкой вверх (Угроза) уходит в Зону Угрозы без траты энергии', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Шум'], 'Ваня');
  const before = getState(game).energy;
  game = takeTurn(game, 'buy');
  const s = getState(game);
  assert.equal(s.energy, before);
  assert.equal(s.threat.some((c) => c.name === 'Шум'), true);
});

test('B5: карта со стрелкой вниз (Авто) уходит в Дом автоматически', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Шура: бухой'], 'Ваня');
  const before = getState(game).energy;
  game = takeTurn(game, 'buy');
  const s = getState(game);
  assert.equal(s.energy, before);
  assert.equal(s.home.some((c) => c.name === 'Шура: бухой'), true);
});

// ---- C. Конец игры -------------------------------------------------------

test('C1: пустая колода — победа, счёт = сумма ПО Дом + Угрозы', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'День рождения!', 'Тост'],
    'Ваня'
  );
  game = runToEnd(game, 'buy');
  const s = getState(game);
  assert.equal(s.status, 'won');
  assert.equal(getScore(game), 5);
});

test('C2: Обход + 3 Угрозы в конце хода — поражение, счёт 0', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Шум', 'Порванная струна', 'Шум', 'Обход', 'Шум'],
    'Ваня'
  );
  game = runToEnd(game, 'discard');
  const s = getState(game);
  assert.equal(s.status, 'lost');
  assert.equal(getScore(game), 0);
});

test('C3: Обход сам не считается Угрозой для счётчика', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Шум', 'Обход', 'Шум'],
    'Ваня'
  );
  game = runToEnd(game, 'discard');
  const s = getState(game);
  assert.equal(s.threat.filter((c) => c.arrow === 'up' && c.threat !== false).length, 2);
  assert.notEqual(s.status, 'lost');
});

// ---- D. Ключевые эффекты карт -------------------------------------------

test('D1: Кровать накрывает самого левого человека -> он "спит" (0 ПО)', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Кровать'], 'Ваня');
  game = takeTurn(game, 'buy');
  const s = getState(game);
  const vanya = s.home.find((c) => c.name === 'Ваня');
  assert.equal(vanya.asleep, true);
  assert.equal(getScore(game), 0);
});

test('D2: Палёный алкоголь копит по 1 карте с верха каждый ход, при 3 сбрасывает себя и кучу', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Палёный алкоголь', 'Комната 402', 'Тост', 'Оля', 'Денис', '3-й сосед'],
    'Ваня'
  );
  game = takeTurn(game, 'discard');
  game = takeTurn(game, 'discard');
  game = takeTurn(game, 'discard');
  game = takeTurn(game, 'discard');
  const s = getState(game);
  const burnt = s.threat.find((c) => c.name === 'Палёный алкоголь');
  assert.equal(burnt, undefined);
  const discardedNames = s.discard.map((c) => c.name);
  assert.equal(discardedNames.includes('Оля'), true);
  assert.equal(discardedNames.includes('Тост'), true);
  assert.equal(discardedNames.includes('Денис'), true);
});

test('D3: Шура: бухой заменяет Шуру и делает Шум = 2 Угрозы (threatWeight)', () => {
  let game = makeGame(['Шура', 'Оля', 'Денис', 'Шум', 'Шура: бухой'], 'Шура');
  game = takeTurn(game, 'discard'); // Шум -> Угроза
  game = takeTurn(game, 'buy'); // Шура: бухой заменяет Шуру
  const s = getState(game);
  assert.equal(s.home.find((c) => c.name === 'Шура'), undefined);
  assert.ok(s.home.find((c) => c.name === 'Шура: бухой'));
  assert.equal(deriveThreatCount(game), 2); // Шум весит 2 из-за Шура: бухой
});

test('D4: Паша: бухой заменяет Пашу и замешивает 1 Угрозу взакрытую', () => {
  let game = makeGame(['Паша', 'Оля', 'Денис', 'Паша: бухой'], 'Паша');
  game = takeTurn(game, 'buy');
  const s = getState(game);
  assert.equal(s.home.find((c) => c.name === 'Паша'), undefined);
  assert.ok(s.home.find((c) => c.name === 'Паша: бухой'));
  assert.ok(s.deck.some((c) => c.arrow === 'up'), 'ожидалась замещённая Угроза в колоде');
});

test('D4b: Шура заменяет Шура: бухой, если бухой уже в игре (симметрия)', () => {
  let game = makeGame(['Оля', 'Денис', 'Шура: бухой', 'Шура'], 'Оля');
  game = takeTurn(game, 'buy'); // Шура: бухой -> Дом
  game = takeTurn(game, 'buy'); // Шура заходит после бухого -> заменяет
  const s = getState(game);
  assert.equal(s.home.find((c) => c.name === 'Шура: бухой'), undefined);
  assert.ok(s.home.find((c) => c.name === 'Шура'));
});

test('D4c: Паша заменяет Паша: бухой, если бухой уже в игре (симметрия)', () => {
  // rng=0.99 -> pullReserve кладёт Угрозу ПОСЛЕ Паши, чтобы Паша гарантированно дотянулась
  let game = makeGame(['Оля', 'Денис', 'Паша: бухой', 'Паша'], 'Оля', () => 0.99);
  game = takeTurn(game, 'buy'); // Паша: бухой -> Дом (+замешивает Угрозу)
  game = takeTurn(game, 'buy'); // Паша заходит после бухого -> заменяет
  const s = getState(game);
  assert.equal(s.home.find((c) => c.name === 'Паша: бухой'), undefined);
  assert.ok(s.home.find((c) => c.name === 'Паша'));
});

test('D5: Звёздный час под гитаристом даёт +1 ПО', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Звёздный час'], 'Ваня');
  game = takeTurn(game, 'buy');
  const s = getState(game);
  const vanya = s.home.find((c) => c.name === 'Ваня');
  assert.ok(vanya.attached && vanya.attached.some((c) => c.name === 'Звёздный час'));
  assert.equal(getScore(game), 3);
});

test('D5b: Звёздный час под не-гитаристом даёт только базу 1 ПО', () => {
  let game = makeGame(['Паша', 'Оля', 'Денис', 'Звёздный час'], 'Паша');
  game = takeTurn(game, 'buy');
  const s = getState(game);
  const pasha = s.home.find((c) => c.name === 'Паша');
  assert.ok(pasha.attached && pasha.attached.some((c) => c.name === 'Звёздный час'));
  assert.equal(getScore(game), 1);
});

test('D5c: Звёздный час без человека в Доме уходит в сброс', () => {
  let game = makeGame(['Плов', 'Оля', 'Денис', 'Звёздный час'], 'Плов');
  game = takeTurn(game, 'buy');
  const s = getState(game);
  assert.ok(!s.home.some((c) => c.name === 'Звёздный час'));
  assert.ok(s.discard.some((c) => c.name === 'Звёздный час'));
  assert.equal(getScore(game), 1);
});

test('D5d: Звёздный час можно выбрать не самого левого человека', () => {
  const chooseFn = (opts) => opts.find((c) => c.name === 'Оля') || opts[0];
  const g = createGame({ deck: [cloneCard(byName['Звёздный час'])], choose: chooseFn });
  g.home = [cloneCard(byName['Ваня']), cloneCard(byName['Оля'])];
  g.energy = 2;
  const after = takeTurn(g, 'buy');
  const s = getState(after);
  const vanya = s.home.find((c) => c.name === 'Ваня');
  const olya = s.home.find((c) => c.name === 'Оля');
  assert.ok(!(vanya.attached || []).some((c) => c.name === 'Звёздный час'), 'Звёздный час не должен быть у левого Вани');
  assert.ok(olya.attached && olya.attached.some((c) => c.name === 'Звёздный час'), 'Звёздный час должен быть у выбранной Оли');
  assert.equal(getScore(after), 2); // Ваня(1) + Оля(1) + Звёздный час база под Олей(1)
});

test('D6: Порванная струна обнуляет ПО гитаристов', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Порванная струна'], 'Ваня');
  game = takeTurn(game, 'discard');
  assert.equal(getScore(game), 0);
});

test('D7: Натянуть струну (🔄) сбрасывает Порванную струну при наличии гитариста', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Порванная струна', 'Натянуть струну', 'Комната 402'],
    'Ваня'
  );
  game = takeTurn(game, 'discard');
  game = takeTurn(game, 'buy');
  game = activate(game, 'Натянуть струну');
  const s = getState(game);
  assert.equal(s.threat.find((c) => c.name === 'Порванная струна'), undefined);
});

test('D8: Большая вечеринка даёт +1 ПО за каждого человека в игре (в конце)', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Комната 402', 'Оля', 'Денис', 'Большая вечеринка'],
    'Ваня'
  );
  game = takeTurn(game, 'discard');
  game = takeTurn(game, 'buy');
  game = takeTurn(game, 'discard');
  game = takeTurn(game, 'buy');
  assert.equal(getScore(game), 3);
});

// ---- L. Грязь (динамическая стоимость покупки) ---------------------------

test('L1: Грязь (arrow up) уходит в Зону Угрозы и повышает стоимость покупки до 3', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Грязь', 'Комната 402'], 'Ваня');
  game = takeTurn(game, 'buy'); // Грязь -> Зона Угрозы автоматически
  const s = getState(game);
  assert.ok(s.threat.find((c) => c.name === 'Грязь'), 'Грязь должна быть в Зоне Угрозы');
  assert.equal(s.energy, 2, 'Грязь не тратит энергию при входе');
  // энергии 2 < 3 -> покупка недоступна
  assert.throws(() => takeTurn(game, 'buy'), /energy/i);
});

test('L1b: при 3+ энергии покупка под Грязь тратит ровно 3', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Грязь', 'Комната 402', 'Комната 402'],
    'Ваня'
  );
  game = takeTurn(game, 'buy');   // Грязь -> Дом, energy 2
  game = takeTurn(game, 'discard'); // +1 -> 3
  const before = getState(game).energy;
  game = takeTurn(game, 'buy');   // покупка Комната 402 за 3
  assert.equal(getState(game).energy, before - 3);
});

test('L1c: deriveBuyCost равен 2 без Грязь и 3 с Грязь', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  assert.equal(deriveBuyCost(game), 2);
  game = takeTurn(game, 'buy'); // Комната 402 (arrow down) -> Дом, не Грязь
  assert.equal(deriveBuyCost(game), 2);
  const g2 = makeGame(['Ваня', 'Оля', 'Денис', 'Грязь'], 'Ваня');
  const g2b = takeTurn(g2, 'buy'); // Грязь -> Зона Угрозы
  assert.equal(deriveBuyCost(g2b), 3);
});

test('L2: Грязь считается Угрозой для Обхода (3 угрозы -> поражение)', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Шум', 'Грязь', 'Шум', 'Обход'],
    'Ваня'
  );
  game = runToEnd(game, 'discard');
  assert.equal(getState(game).status, 'lost');
  assert.equal(getScore(game), 0);
});

// ---- D9. Активация 🔄 ----------------------------------------------------

test('D9: активация 🔄 из Дома применяет эффект и уходит в сброс без энергии', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Порванная струна', 'Натянуть струну', 'Комната 402'],
    'Ваня'
  );
  game = takeTurn(game, 'discard');
  game = takeTurn(game, 'buy');
  const before = getState(game).energy;
  game = activate(game, 'Натянуть струну');
  const s = getState(game);
  assert.equal(s.threat.find((c) => c.name === 'Порванная струна'), undefined, 'Порванная струна не сброшена');
  assert.equal(s.home.find((c) => c.name === 'Натянуть струну'), undefined, 'карта-источник осталась в Доме');
  assert.ok(s.discard.some((c) => c.name === 'Натянуть струну'), 'карта-источник не в сбросе');
  assert.equal(s.energy, before, 'активация дала энергию (не должна)');
});

test('D9b: 🔄 из сброса НЕ работает (карта вне игры -> no-op)', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Порванная струна', 'Натянуть струну', 'Комната 402'],
    'Ваня'
  );
  game = takeTurn(game, 'discard');
  game = takeTurn(game, 'buy');
  const beforeThreat = getState(game).threat.length;
  game = activate(game, 'Натянуть струну'); // из Дома -> сброс (Порванная уходит)
  const afterFirst = getState(game);
  assert.equal(afterFirst.threat.find((c) => c.name === 'Порванная струна'), undefined);
  // повторная активация — карта уже в сбросе, не в игре -> не должна ничего сделать
  const snapshot = JSON.stringify(getState(game).threat.map((c) => c.name));
  game = activate(game, 'Натянуть струну');
  const afterSecond = getState(game);
  assert.equal(afterSecond.threat.find((c) => c.name === 'Натянуть струну'), undefined);
  assert.equal(JSON.stringify(afterSecond.threat.map((c) => c.name)), snapshot, 'повтор из сброса изменил состояние');
  assert.equal(afterSecond.threat.length, 0); // Порванная уже сброшена, новых нет
  void beforeThreat;
});

// ---- E. Инварианты -------------------------------------------------------

function topLevelCards(game) {
  return [...game.deck, ...game.home, ...game.threat, ...game.discard];
}

function countAllCards(game) {
  let n = 0;
  const walk = (zone) => {
    for (const c of zone) {
      n++;
      if (c.attached) walk(c.attached);
      if (c.accumulated) walk(c.accumulated);
    }
  };
  walk(game.deck);
  walk(game.home);
  walk(game.threat);
  walk(game.discard);
  return n;
}

function assertInvariants(game) {
  const s = game;
  assert.equal(Number.isInteger(s.energy), true, 'energy not integer');
  assert.ok(s.energy >= 0, `energy negative: ${s.energy}`);
  assert.ok(['playing', 'won', 'lost'].includes(s.status), `bad status: ${s.status}`);

  const ALL = new Set(cards.map((c) => c.name));
  for (const c of topLevelCards(s)) {
    assert.ok(ALL.has(c.name), `unknown card in play: ${c.name}`);
  }

  const seen = new Set();
  for (const c of topLevelCards(s)) {
    assert.ok(!seen.has(c), `card in two zones: ${c.name}`);
    seen.add(c);
  }

  const realThreats = s.threat.filter((c) => c.arrow === 'up' && c.threat !== false);
  assert.ok(!s.threat.some((c) => c.name === 'Обход' && c.arrow === 'up' && c.threat !== false), 'Обход учтён как Угроза');

  const score = getScore(game);
  assert.equal(Number.isInteger(score), true, 'score not integer');
  if (s.status === 'lost') assert.equal(score, 0, 'lost but score != 0');

  checkAttachInvariant(game);

  return { realThreats: realThreats.length, total: countAllCards(s) };
}

test('E1: инварианты держатся в ручной партии (победа)', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'День рождения!', 'Тост', 'Комната 402'],
    'Ваня'
  );
  assertInvariants(game);
  let guard = 0;
  while (game.status === 'playing' && guard++ < 100) {
    const action = getState(game).energy >= deriveBuyCost(game) ? 'buy' : 'discard';
    game = takeTurn(game, action);
    assertInvariants(game);
  }
  assert.equal(game.status, 'won');
});

test('E2: инварианты держатся при накоплении Палёного алкоголя', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Палёный алкоголь', 'Комната 402', 'Тост', 'Денис', 'Оля'],
    'Ваня'
  );
  game = takeTurn(game, 'discard');
  assertInvariants(game);
  game = takeTurn(game, 'discard');
  assertInvariants(game);
  game = takeTurn(game, 'discard');
  assertInvariants(game);
  game = takeTurn(game, 'discard');
  assertInvariants(game);
});

test('E3: при замене владельца прикреплённая аттач-карта уходит в сброс', () => {
  let game = makeGame(
    ['Шура', 'Оля', 'Денис', 'Звёздный час', 'Шура: бухой'],
    'Шура'
  );
  game = takeTurn(game, 'buy'); // Звёздный час прикрепляется к Шуре
  const s1 = getState(game);
  const shura = s1.home.find((c) => c.name === 'Шура');
  assert.ok(shura.attached && shura.attached.some((c) => c.name === 'Звёздный час'), 'Звёздный час должен быть прикреплён к Шуре');
  game = takeTurn(game, 'buy'); // Шура: бухой заменяет Шуру
  const s2 = getState(game);
  assert.equal(s2.home.find((c) => c.name === 'Шура'), undefined, 'Шура заменён');
  assert.ok(s2.home.find((c) => c.name === 'Шура: бухой'), 'Шура: бухой в Доме');
  assert.equal(s2.home.some((c) => c.name === 'Звёздный час'), false, 'Звёздный час не должен висеть в Доме');
  assert.ok(s2.discard.some((c) => c.name === 'Звёздный час'), 'Звёздный час должен уйти в сброс');
  assertInvariants(game);
});

// ---- F. Property-based / fuzz --------------------------------------------

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CARD_POOL = cards.map((c) => c.name);

function simulate(seed) {
  const rng = lcg(seed);
  const n = 20 + Math.floor(rng() * 25);
  const order = [];
  for (let i = 0; i < n; i++) {
    order.push(CARD_POOL[Math.floor(rng() * CARD_POOL.length)]);
  }
  const top3 = order.slice(0, 3);
  const choose = top3[Math.floor(rng() * 3)];
  let game = makeGame(order, choose, rng);
  assertInvariants(game);
  let turns = 0;
  while (game.status === 'playing' && turns < 20000) {
    const energy = getState(game).energy;
    const cost = deriveBuyCost(game);
    const action = energy >= cost ? (rng() < 0.6 ? 'buy' : 'discard') : 'discard';
    game = takeTurn(game, action);
    assertInvariants(game);
    turns++;
  }
  assert.ok(turns < 20000, `seed ${seed}: игра не завершилась`);
  const s = getState(game);
  return { seed, status: s.status, score: getScore(game), turns };
}

test('F1: fuzz — 300 случайных партий сохраняют инварианты и завершаются', () => {
  for (let seed = 1; seed <= 300; seed++) {
    simulate(seed);
  }
});

// ---- G. Метаморфное / детерминизм ----------------------------------------

test('G1: детерминизм — тот же seed даёт идентичный финал', () => {
  const a = simulate(424242);
  const b = simulate(424242);
  assert.deepEqual(a, b);
});

test('G2: разные seed обычно дают разные партии', () => {
  const results = new Set();
  for (let seed = 1000; seed < 1010; seed++) {
    const r = simulate(seed);
    results.add(`${r.status}:${r.score}:${r.turns}`);
  }
  assert.ok(results.size >= 2, 'fuzz выдаёт одинаковые партии независимо от seed');
});

// ---- H. Golden-сценарии --------------------------------------------------

const GOLDEN = [
  {
    id: 'arrow-up', card: 'Шум',
    order: ['Ваня', 'Оля', 'Денис', 'Шум'], choose: 'Ваня',
    run: (g) => takeTurn(g, 'discard'),
    expect: (g) => {
      const s = getState(g);
      assert.ok(s.threat.some((c) => c.name === 'Шум'));
      assert.equal(s.energy, 2);
    },
  },
  {
    id: 'arrow-down', card: 'Шура: бухой',
    order: ['Ваня', 'Оля', 'Денис', 'Шура: бухой'], choose: 'Ваня',
    run: (g) => takeTurn(g, 'buy'),
    expect: (g) => {
      const s = getState(g);
      assert.ok(s.home.some((c) => c.name === 'Шура: бухой'));
      assert.equal(s.energy, 2);
    },
  },
  {
    id: 'replace', card: 'Шура: бухой',
    order: ['Шура', 'Оля', 'Денис', 'Шура: бухой'], choose: 'Шура',
    run: (g) => takeTurn(g, 'buy'),
    expect: (g) => {
      const s = getState(g);
      assert.ok(s.home.some((c) => c.name === 'Шура: бухой'));
      assert.equal(s.home.find((c) => c.name === 'Шура'), undefined);
    },
  },
  {
    id: 'threatWeight+loseIf', card: 'Шура: бухой + Обход',
    order: ['Ваня', 'Оля', 'Денис', 'Шум', 'Шура: бухой', 'Шум', 'Обход'], choose: 'Ваня',
    run: (g) => { while (g.status === 'playing') g = takeTurn(g, 'discard'); return g; },
    expect: (g) => {
      const s = getState(g);
      assert.equal(deriveThreatCount(g), 4); // 2 Шум по весу 2
      assert.equal(s.status, 'lost');
      assert.equal(getScore(g), 0);
    },
  },
  {
    id: 'sleep', card: 'Кровать',
    order: ['Ваня', 'Оля', 'Денис', 'Кровать'], choose: 'Ваня',
    run: (g) => takeTurn(g, 'buy'),
    expect: (g) => {
      const s = getState(g);
      const v = s.home.find((c) => c.name === 'Ваня');
      assert.equal(v.asleep, true);
      assert.equal(getScore(g), 0);
    },
  },
  {
    id: 'pullReserve', card: 'Паша: бухой',
    order: ['Паша', 'Оля', 'Денис', 'Паша: бухой'], choose: 'Паша',
    run: (g) => takeTurn(g, 'buy'),
    expect: (g) => {
      const s = getState(g);
      assert.ok(s.home.find((c) => c.name === 'Паша: бухой'));
      assert.ok(s.deck.some((c) => c.arrow === 'up'), 'замешана Угроза в колоду');
    },
  },
  {
    id: 'accumulate', card: 'Палёный алкоголь',
    order: ['Ваня', 'Оля', 'Денис', 'Палёный алкоголь', 'Комната 402', 'Тост', 'Оля', 'Денис', '3-й сосед'],
    choose: 'Ваня',
    run: (g) => { for (let i = 0; i < 4; i++) g = takeTurn(g, 'discard'); return g; },
    expect: (g) => {
      const s = getState(g);
      assert.equal(s.threat.find((c) => c.name === 'Палёный алкоголь'), undefined);
      const names = s.discard.map((c) => c.name);
      assert.ok(names.includes('Оля') && names.includes('Тост') && names.includes('Денис'));
    },
  },
  {
    id: 'modifyVp', card: 'Порванная струна',
    order: ['Ваня', 'Оля', 'Денис', 'Порванная струна'], choose: 'Ваня',
    run: (g) => takeTurn(g, 'discard'),
    expect: (g) => {
      const s = getState(g);
      assert.equal(s.home.find((c) => c.name === 'Ваня').vpEffective, 0);
      assert.equal(getScore(g), 0);
    },
  },
  {
    id: 'modifyVp+attach (BUG2)', card: 'Порванная струна + Звёздный час',
    order: ['Ваня', 'Оля', 'Денис', 'Звёздный час', 'Порванная струна'], choose: 'Ваня',
    run: (g) => { g = takeTurn(g, 'buy'); g = takeTurn(g, 'discard'); return g; },
    expect: (g) => {
      const s = getState(g);
      const v = s.home.find((c) => c.name === 'Ваня');
      // гитарист обнулён, но прикреплённый Звёздный час (vp1 + bonus1) сохраняется
      assert.equal(v.vpEffective, 2);
      assert.equal(getScore(g), 2);
    },
  },
  {
    id: 'addVp', card: 'Конфликт',
    order: ['Паша', 'Оля', 'Денис', 'Паша: бухой', 'Комната 402', 'Шура', 'Конфликт'],
    choose: 'Паша',
      run: (g) => {
        g = takeTurn(g, 'buy');
        while (g.status === 'playing') {
          const a = getState(g).energy >= 2 ? 'buy' : 'discard';
          g = takeTurn(g, a);
        }
        return g;
      },
    expect: (g) => {
      const pb = getState(g).home.find((c) => c.name === 'Паша: бухой');
      assert.equal(pb.vpEffective, -1);
    },
  },
  {
    id: 'bonusVp', card: 'Тост',
    order: ['Ваня', 'Оля', 'Денис', 'День рождения!', 'Тост'], choose: 'Ваня',
    run: (g) => {
      while (g.status === 'playing') {
        const a = getState(g).energy >= 2 ? 'buy' : 'discard';
        g = takeTurn(g, a);
      }
      return g;
    },
    expect: (g) => {
      const s = getState(g);
      assert.equal(s.home.find((c) => c.name === 'Тост').vpEffective, 2);
    },
  },
  {
    id: 'buyFreeIf', card: 'Плов',
    order: ['Паша', 'Оля', 'Денис', 'Плов', 'Комната 402'], choose: 'Паша',
    run: (g) => {
      g = takeTurn(g, 'buy');
      g = takeTurn(g, 'discard');
      return g;
    },
    expect: (g) => {
      const s = getState(g);
      assert.ok(s.home.find((c) => c.name === 'Плов'));
      assert.equal(s.energy, 3);
    },
  },
  {
    id: 'scorePerPerson', card: 'Большая вечеринка',
    order: ['Ваня', 'Оля', 'Денис', 'Большая вечеринка', 'Комната 402', 'Оля', 'Денис'],
    choose: 'Ваня',
    run: (g) => {
      while (g.status === 'playing') {
        const a = getState(g).energy >= 2 ? 'buy' : 'discard';
        g = takeTurn(g, a);
      }
      return g;
    },
    expect: (g) => { assert.equal(getScore(g), 3); },
  },
  {
    id: 'attach', card: 'Звёздный час',
    order: ['Ваня', 'Оля', 'Денис', 'Звёздный час'], choose: 'Ваня',
    run: (g) => takeTurn(g, 'buy'),
    expect: (g) => {
      const s = getState(g);
      const v = s.home.find((c) => c.name === 'Ваня');
      assert.ok(v.attached && v.attached.some((c) => c.name === 'Звёздный час'));
      assert.equal(getScore(g), 3);
    },
  },
  {
    id: 'loseIf', card: 'Обход',
    order: ['Ваня', 'Оля', 'Денис', 'Шум', 'Порванная струна', 'Шум', 'Обход', 'Шум'],
    choose: 'Ваня',
    run: (g) => { while (g.status === 'playing') g = takeTurn(g, 'discard'); return g; },
    expect: (g) => {
      assert.equal(getState(g).status, 'lost');
      assert.equal(getScore(g), 0);
    },
  },
  {
    id: 'discardTarget(activate)', card: 'Старшекур',
    order: ['Ваня', 'Оля', 'Денис', 'Старшекур', 'Шум', 'Комната 402'], choose: 'Ваня',
    run: (g) => {
      g = takeTurn(g, 'buy');
      g = takeTurn(g, 'discard');
      g = activate(g, 'Старшекур');
      return g;
    },
    expect: (g) => {
      const s = getState(g);
      assert.equal(s.threat.find((c) => c.name === 'Шум'), undefined);
      assert.ok(s.discard.some((c) => c.name === 'Шум'));
    },
  },
  {
    id: 'peekReorder(activate)', card: 'Массовый перекур',
    order: ['Ваня', 'Оля', 'Денис', 'Массовый перекур', 'Комната 402', 'Тост', 'Денис'],
    choose: 'Ваня',
    run: (g) => {
      g = takeTurn(g, 'discard');
      g = takeTurn(g, 'discard');
      g = takeTurn(g, 'buy');
      const before = getState(g).deck.length;
      g = activate(g, 'Массовый перекур');
      assert.equal(getState(g).deck.length, before);
      return g;
    },
    expect: () => { assert.ok(true); },
  },
];

for (const sc of GOLDEN) {
  test(`H: ${sc.id} (${sc.card})`, () => {
    let g = makeGame(sc.order, sc.choose, lcg(0xc0ffee));
    assertInvariants(g);
    g = sc.run(g);
    assertInvariants(g);
    sc.expect(g);
  });
}

// ---- K. Итоговый счёт финала (snap-shot) ----------------------------------

test('K1: итоговый счёт финала — attach-бонус + угроза + scorePerPerson суммируются корректно', () => {
  const g = createGame({ deck: [] });
  g.home = [cloneCard(byName['Ваня']), cloneCard(byName['Денис']), cloneCard(byName['Оля'])];
  g.threat = [cloneCard(byName['День рождения!']), cloneCard(byName['Большая вечеринка'])];
  // прикрепляем Звёздный час к Ване вручную (аналог applyAttach)
  const vanya = g.home[0];
  const star = cloneCard(byName['Звёздный час']);
  star.attachedTo = vanya.name;
  vanya.attached = [star];
  g.status = 'won';
  // Ваня: 1(база) +1(Звёздный час) +1(бонус гитаристу) = 3
  // День рождения!: 2 ; Денис/Оля/Большая вечеринка: 0
  // scorePerPerson: 3 человека в игре * 1 = 3
  // итого: 3 + 2 + 3 = 8
  assert.equal(getScore(g), 8);
  const rows = deriveScoreBreakdown(g);
  const sum = rows.reduce((s, r) => s + (r.value || 0), 0);
  assert.equal(sum, getScore(g), 'breakdown не суммируется в getScore');
});

test('K2: итоговый счёт финала равен 0 при поражении (loseIf), даже если ПО в игре есть', () => {
  const g = createGame({ deck: [] });
  // Обход + 3 Угрозы + пара гитаристов с ПО — но поражение обнуляет счёт
  g.home = [cloneCard(byName['Ваня']), cloneCard(byName['Оля'])];
  g.threat = [
    cloneCard(byName['Обход']),
    cloneCard(byName['Шум']),
    cloneCard(byName['Шум']),
    cloneCard(byName['Порванная струна']),
  ];
  g.status = 'lost';
  assert.equal(getScore(g), 0);
});

// ---- J. Сон = «пустая» карта / peekReorder -------------------------------

test('J1: Звёздный час не прикрепляется к спящему человеку (идёт к бодрствующему)', () => {
  const g = createGame({ deck: [cloneCard(byName['Звёздный час'])] });
  g.home = [cloneCard(byName['Ваня']), cloneCard(byName['Оля'])];
  const bed = cloneCard(byName['Кровать']);
  g.home[0].attached = [bed];
  bed.attachedTo = g.home[0].name; // Ваня (гитарист) спит
  g.energy = 2;
  const after = takeTurn(g, 'buy');
  const s = getState(after);
  const vanya = s.home.find((c) => c.name === 'Ваня');
  const olya = s.home.find((c) => c.name === 'Оля');
  assert.ok(!(vanya.attached || []).some((c) => c.name === 'Звёздный час'), 'Звёздный час не должен быть у спящего Вани');
  assert.ok(olya.attached && olya.attached.some((c) => c.name === 'Звёздный час'), 'Звёздный час должен быть у бодрствующей Оли');
  assert.equal(getScore(after), 1);
});

test('J2: 🔄 спящей карты не работает (no-op, возврат того же game)', () => {
  const g = createGame({ deck: [cloneCard(byName['Шум'])] });
  g.home = [cloneCard(byName['Ваня']), cloneCard(byName['Старшекур'])];
  const bed = cloneCard(byName['Кровать']);
  g.home[1].attached = [bed];
  bed.attachedTo = g.home[1].name; // Старшекур спит
  const before = getState(g).home.map((c) => c.name).join(',');
  const after = activate(g, 'Старшекур');
  assert.equal(after, g, 'activate спящей карты возвращает тот же game');
  const s = getState(after);
  assert.equal(s.home.map((c) => c.name).join(','), before, 'состояние не изменилось');
  assert.equal(s.threat.length, 0, 'Шум не сброшен (активация не сработала)');
});

test('J3: conditionMet ложно для спящего гитариста (Натянуть струну не срабатывает)', () => {
  const g = createGame({ deck: [cloneCard(byName['Порванная струна'])] });
  g.home = [cloneCard(byName['Ваня']), cloneCard(byName['Оля']), cloneCard(byName['Натянуть струну'])];
  const bed = cloneCard(byName['Кровать']);
  g.home[0].attached = [bed];
  bed.attachedTo = g.home[0].name; // Ваня (гитарист) спит
  g.threat = [cloneCard(byName['Порванная струна'])];
  const after = activate(g, 'Натянуть струну');
  const s = getState(after);
  assert.ok(s.threat.some((c) => c.name === 'Порванная струна'), 'Порванная струна не сброшена: гитарист спит');
});

test('J4: peekReorder через game.reorder реально меняет порядок верхних карт', () => {
  const g = createGame({ deck: [cloneCard(byName['Комната 402']), cloneCard(byName['Тост']), cloneCard(byName['Плов']), cloneCard(byName['Звёздный час'])] });
  g.home = [cloneCard(byName['Ваня']), cloneCard(byName['Массовый перекур'])];
  g.reorder = (top) => [...top].reverse();
  const before = g.deck.map((c) => c.name).join(',');
  const after = activate(g, 'Массовый перекур');
  const afterDeck = after.deck.map((c) => c.name).join(',');
  assert.equal(after.deck.length, 4, 'колода той же длины');
  assert.notEqual(afterDeck, before, 'порядок верхних карт изменился');
});

// ---- I. Иммутабельность / строгие фазы / валидация -----------------------

test('I1: takeTurn не мутирует входной game', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  const snap = JSON.stringify(getState(game));
  const beforeEnergy = game.energy;
  const after = takeTurn(game, 'discard');
  assert.notEqual(after, game, 'должен вернуть НОВЫЙ объект');
  assert.equal(game.energy, beforeEnergy, 'вход не изменился');
  assert.equal(JSON.stringify(getState(game)), snap, 'вход не изменился (снапшот)');
  assert.equal(getState(after).energy, beforeEnergy + 1);
});

test('I2: 🔄 из сброса не работает (activate возвращает тот же game при отсутствии в игре)', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Натянуть струну'], 'Ваня');
  // Натянуть струну в сбросе (никогда не в игре) -> activate не меняет состояние
  const after = activate(game, 'Натянуть струну');
  assert.equal(after, game);
});

test('I3: строгий автомат фаз — runTurnStart дважды бросает', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  const g2 = runTurnStart(game);
  assert.throws(() => runTurnStart(g2), /phase/i);
});

test('I4: строгий автомат фаз — resolveTop до runTurnStart бросает', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  assert.throws(() => resolveTop(game, 'discard'), /phase/i);
});

test('I5: takeTurn при не-idle бросает (после runTurnStart)', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  const g2 = runTurnStart(game);
  assert.throws(() => takeTurn(g2, 'discard'), /phase/i);
});

test('I6: setup проигрывает enter-эффекты стартовой карты (Паша: бухой замешивает Угрозу)', () => {
  let game = makeGame(['Паша: бухой', 'Оля', 'Денис'], 'Паша: бухой');
  assert.ok(getState(game).deck.some((c) => c.arrow === 'up'), 'стартовая Паша: бухой замешивает Угрозу');
});

test('I7: нейтральная карта без action -> ошибка', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  assert.throws(() => takeTurn(game, undefined), /invalid action/i);
  assert.throws(() => takeTurn(game, 'fly'), /invalid action/i);
});

test('I8: валидация DSL — неизвестный op бросает', () => {
  assert.throws(() => validateCards([{ name: 'X', effects: [{ op: 'frobnicate' }] }]), /unknown op/);
});

test('I9: валидация DSL — неверный тип поля бросает', () => {
  assert.throws(() => validateCards([{ name: 'X', sleep: 'yes' }]), /sleep/);
  assert.throws(() => validateCards([{ name: 'X', effects: [{ op: 'modifyVp', value: 'z' }] }]), /modifyVp/);
});

test('I10: валидация DSL — дубликат имени бросает', () => {
  assert.throws(() => validateCards([{ name: 'X' }, { name: 'X' }]), /duplicate/);
});
