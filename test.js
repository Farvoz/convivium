import { test } from 'node:test';
import assert from 'node:assert/strict';

// cards.js / engine.js выставляют данные и API через globalThis
import './cards.js';
import './engine.js';
const { cards } = globalThis;
const {
  createGame, setup, takeTurn, runTurnStart, resolveTop, getScore, getState, activate, deriveThreatCount, validateCards, checkAttachInvariant,
} = globalThis.Convivium;

// ---- helpers -------------------------------------------------------------

const byName = Object.fromEntries(cards.map((c) => [c.name, c]));

// Клонируем карту, чтобы каждый экземпляр в колоде был уникальной ссылкой.
function cloneCard(name) {
  const c = byName[name];
  const clone = { ...c };
  if (c.tags) clone.tags = [...c.tags];
  if (c.effects) clone.effects = c.effects.map((e) => ({ ...e }));
  if (c.activate) clone.activate = c.activate.map((e) => ({ ...e }));
  if (c.attach) clone.attach = { ...c.attach };
  return clone;
}

// Порядок колоды: индекс 0 = низ, последний элемент = верх (снимается первым).
function makeGame(order, choose, rng) {
  const deck = order.map((name) => cloneCard(name));
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

test('D5: Хит под гитаристом даёт +1 ПО', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Хит'], 'Ваня');
  game = takeTurn(game, 'buy');
  const s = getState(game);
  const vanya = s.home.find((c) => c.name === 'Ваня');
  assert.ok(vanya.attached && vanya.attached.some((c) => c.name === 'Хит'));
  assert.equal(getScore(game), 3);
});

test('D5b: Хит под не-гитаристом даёт только базу 1 ПО', () => {
  let game = makeGame(['Паша', 'Оля', 'Денис', 'Хит'], 'Паша');
  game = takeTurn(game, 'buy');
  const s = getState(game);
  const pasha = s.home.find((c) => c.name === 'Паша');
  assert.ok(pasha.attached && pasha.attached.some((c) => c.name === 'Хит'));
  assert.equal(getScore(game), 1);
});

test('D5c: Хит без человека в Доме уходит в сброс', () => {
  let game = makeGame(['Плов', 'Оля', 'Денис', 'Хит'], 'Плов');
  game = takeTurn(game, 'buy');
  const s = getState(game);
  assert.ok(!s.home.some((c) => c.name === 'Хит'));
  assert.ok(s.discard.some((c) => c.name === 'Хит'));
  assert.equal(getScore(game), 1);
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
    const action = getState(game).energy >= 2 ? 'buy' : 'discard';
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
    ['Шура', 'Оля', 'Денис', 'Хит', 'Шура: бухой'],
    'Шура'
  );
  game = takeTurn(game, 'buy'); // Хит прикрепляется к Шуре
  const s1 = getState(game);
  const shura = s1.home.find((c) => c.name === 'Шура');
  assert.ok(shura.attached && shura.attached.some((c) => c.name === 'Хит'), 'Хит должен быть прикреплён к Шуре');
  game = takeTurn(game, 'buy'); // Шура: бухой заменяет Шуру
  const s2 = getState(game);
  assert.equal(s2.home.find((c) => c.name === 'Шура'), undefined, 'Шура заменён');
  assert.ok(s2.home.find((c) => c.name === 'Шура: бухой'), 'Шура: бухой в Доме');
  assert.equal(s2.home.some((c) => c.name === 'Хит'), false, 'Хит не должен висеть в Доме');
  assert.ok(s2.discard.some((c) => c.name === 'Хит'), 'Хит должен уйти в сброс');
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
    const action = energy >= 2 ? (rng() < 0.6 ? 'buy' : 'discard') : 'discard';
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
    id: 'modifyVp+attach (BUG2)', card: 'Порванная струна + Хит',
    order: ['Ваня', 'Оля', 'Денис', 'Хит', 'Порванная струна'], choose: 'Ваня',
    run: (g) => { g = takeTurn(g, 'buy'); g = takeTurn(g, 'discard'); return g; },
    expect: (g) => {
      const s = getState(g);
      const v = s.home.find((c) => c.name === 'Ваня');
      // гитарист обнулён, но прикреплённый Хит (vp1 + bonus1) сохраняется
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
    id: 'attach', card: 'Хит',
    order: ['Ваня', 'Оля', 'Денис', 'Хит'], choose: 'Ваня',
    run: (g) => takeTurn(g, 'buy'),
    expect: (g) => {
      const s = getState(g);
      const v = s.home.find((c) => c.name === 'Ваня');
      assert.ok(v.attached && v.attached.some((c) => c.name === 'Хит'));
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
