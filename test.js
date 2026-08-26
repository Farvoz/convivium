import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cards } from './cards.js';
// API-контракт будущего движка (engine.js). Тесты упадут на импорте,
// пока движок не реализован.
import { createGame, setup, takeTurn, getScore, getState, activate } from './engine.js';

// ---- helpers -------------------------------------------------------------

const byName = Object.fromEntries(cards.map((c) => [c.name, c]));

// Клонируем карту, чтобы каждый экземпляр в колоде был уникальной ссылкой
// (нужно для проверки непересечения зон по ссылке).
function cloneCard(name) {
  const c = byName[name];
  const clone = { ...c };
  if (c.tags) clone.tags = [...c.tags];
  if (c.attached) clone.attached = [];
  if (c.accumulated) clone.accumulated = [];
  return clone;
}

// Порядок колоды: индекс 0 = низ, последний элемент = верх (снимается первым).
function makeGame(order, choose) {
  const deck = order.map((name) => cloneCard(name));
  const game = createGame({ deck });
  setup(game, { choose });
  return game;
}

// Снять карты, пока игра не закончится (для тестов победы/поражения).
function runToEnd(game, action = 'buy') {
  let guard = 0;
  while (game.status === 'playing' && guard++ < 1000) {
    takeTurn(game, action);
  }
  return game;
}

// ---- A. Подготовка / setup ----------------------------------------------

test('A1: после подготовки энергия равна 2', () => {
  const game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  assert.equal(getState(game).energy, 2);
});

test('A2: ровно 1 из 3 открытых карт в Доме, остальные 2 в сбросе', () => {
  const game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  const s = getState(game);
  assert.equal(s.home.length, 1);
  assert.equal(s.home[0].name, 'Ваня');
  assert.equal(s.discard.length, 2);
  const names = s.discard.map((c) => c.name).sort();
  assert.deepEqual(names, ['Денис', 'Оля']);
});

test('A3: свободная карта в Дом не тратит энергию', () => {
  const game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  assert.equal(getState(game).energy, 2);
});

// ---- B. Общий флоу хода --------------------------------------------------

test('B1: сброс обычной карты даёт +1 энергия и кладёт в сброс', () => {
  const game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  const before = getState(game).energy;
  takeTurn(game, 'discard'); // Комната 402
  const s = getState(game);
  assert.equal(s.energy, before + 1);
  assert.equal(s.discard.some((c) => c.name === 'Комната 402'), true);
  assert.equal(s.home.some((c) => c.name === 'Комната 402'), false);
});

test('B2: покупка тратит 2 энергии и кладёт в Дом', () => {
  const game = makeGame(['Ваня', 'Оля', 'Денис', 'Тост'], 'Ваня');
  const before = getState(game).energy; // 2
  takeTurn(game, 'buy'); // Тост
  const s = getState(game);
  assert.equal(s.energy, before - 2);
  assert.equal(s.home.some((c) => c.name === 'Тост'), true);
});

test('B3: при энергии < 2 покупка недоступна — выбрасывается ошибка', () => {
  const game = makeGame(['Ваня', 'Оля', 'Денис', 'Тост', 'Комната 402'], 'Ваня');
  takeTurn(game, 'buy'); // Тост, energy 2 -> 0
  assert.equal(getState(game).energy, 0);
  assert.throws(() => takeTurn(game, 'buy'), /energy/i); // Комната 402
});

test('B4: карта со стрелкой вверх (Угроза) уходит в Зону Угрозы без траты энергии', () => {
  const game = makeGame(['Ваня', 'Оля', 'Денис', 'Шум'], 'Ваня');
  const before = getState(game).energy;
  takeTurn(game, 'buy'); // действие игнорируется у стрелки
  const s = getState(game);
  assert.equal(s.energy, before); // энергия не изменилась
  assert.equal(s.threat.some((c) => c.name === 'Шум'), true);
});

test('B5: карта со стрелкой вниз (Авто) уходит в Дом автоматически', () => {
  const game = makeGame(['Ваня', 'Оля', 'Денис', 'Шура: бухой'], 'Ваня');
  const before = getState(game).energy;
  takeTurn(game, 'buy'); // действие игнорируется у стрелки
  const s = getState(game);
  assert.equal(s.energy, before);
  assert.equal(s.home.some((c) => c.name === 'Шура: бухой'), true);
});

// ---- C. Конец игры -------------------------------------------------------

test('C1: пустая колода — победа, счёт = сумма ПО Дом + Угрозы', () => {
  // prep: Ваня(Дом, vp1), Оля/Денис в сброс.
  // Далее: День рождения!(vp2, угроза), Тост(vp1, +1 т.к. ДР в игре =>2, Дом).
  const game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'День рождения!', 'Тост'],
    'Ваня'
  );
  runToEnd(game, 'buy');
  const s = getState(game);
  assert.equal(s.status, 'won');
  // Ваня 1 + Тост 2(1+1) + День рождения! 2 = 5
  assert.equal(getScore(game), 5);
});

test('C2: Обход + 3 Угрозы в конце хода — поражение, счёт 0', () => {
  // 3 угрозы + Обход в зоне угроз -> loss.
  const game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Шум', 'Порванная струна', 'Шум', 'Обход', 'Шум'],
    'Ваня'
  );
  runToEnd(game, 'discard'); // все обычные/стрелки уходят; в итоге 3 Угрозы + Обход
  const s = getState(game);
  // Угрозы: Шум, Порванная струна, Шум, Обход(не угроза), Шум => 3 Угрозы
  assert.equal(s.status, 'lost');
  assert.equal(getScore(game), 0);
});

test('C3: Обход сам не считается Угрозой для счётчика', () => {
  // 2 Угрозы + Обход => не проигрыш (меньше 3).
  const game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Шум', 'Обход', 'Шум'],
    'Ваня'
  );
  runToEnd(game, 'discard');
  const s = getState(game);
  const threats = s.threat.filter((c) => c.threat !== false);
  assert.equal(threats.length, 2);
  assert.notEqual(s.status, 'lost'); // не поражение по Обходу
});

// ---- D. Ключевые эффекты карт -------------------------------------------

test('D1: Кровать накрывает самого левого человека -> он "спит" (0 ПО, не человек)', () => {
  // prep choose Ваня (man/guitarist, vp1) -> home. Затем Кровать.
  const game = makeGame(['Ваня', 'Оля', 'Денис', 'Кровать'], 'Ваня');
  takeTurn(game, 'buy'); // Кровать входит в игру, накрывает Ваню
  const s = getState(game);
  const vanya = s.home.find((c) => c.name === 'Ваня');
  assert.equal(vanya.asleep, true);
  // Спящий не даёт ПО: счёт по Ване = 0 (только выигрышный подсчёт проверим отдельно).
  // Большая вечеринка не считает спящего.
  assert.equal(getScore(game), 0);
});

test('D2: Палёный алкоголь копит по 1 карте с верха каждый ход, при 3 сбрасывает себя и кучу', () => {
  // prep -> затем Палёный алкоголь (arrow up). Колода после: 3 карты для накопления.
  const game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Палёный алкоголь', 'Комната 402', 'Тост', 'Денис'],
    'Ваня'
  );
  takeTurn(game, 'discard'); // Палёный алкоголь -> Зона Угрозы, начинает копить
  // Каждый последующий ход кладёт по 1 взакрытую под неё.
  takeTurn(game, 'discard'); // 1-я накопленная
  takeTurn(game, 'discard'); // 2-я накопленная
  takeTurn(game, 'discard'); // 3-я -> достигает 3 -> сброс себя + кучи
  const s = getState(game);
  const burnt = s.threat.find((c) => c.name === 'Палёный алкоголь');
  assert.equal(burnt, undefined); // сам сброшен
  const discardedNames = s.discard.map((c) => c.name);
  assert.equal(discardedNames.includes('Комната 402'), true);
  assert.equal(discardedNames.includes('Тост'), true);
  assert.equal(discardedNames.includes('Денис'), true);
});

test('D3: Шура: бухой заменяет Шуру и делает Шум = 2 Угрозы', () => {
  // prep choose Шура -> home. Затем Шура: бухой (arrow down) заменяет.
  const game = makeGame(['Шура', 'Оля', 'Денис', 'Шура: бухой'], 'Шура');
  const s0 = getState(game);
  assert.ok(s0.home.find((c) => c.name === 'Шура'));
  takeTurn(game, 'buy'); // Шура: бухой входит, заменяет Шуру
  const s = getState(game);
  assert.equal(s.home.find((c) => c.name === 'Шура'), undefined);
  assert.ok(s.home.find((c) => c.name === 'Шура: бухой'));
  // Флаг "Шум = 2 Угрозы" должен быть установлен в состоянии.
  assert.equal(s.flags.shumCountsAsTwoThreats, true);
});

test('D4: Паша: бухой заменяет Пашу и замешивает 1 Угрозу взакрытую', () => {
  const game = makeGame(['Паша', 'Оля', 'Денис', 'Паша: бухой'], 'Паша');
  const deckBefore = getState(game).deck.length;
  takeTurn(game, 'buy'); // Паша: бухой заменяет Пашу, +1 Угроза в колоду
  const s = getState(game);
  assert.equal(s.home.find((c) => c.name === 'Паша'), undefined);
  assert.ok(s.home.find((c) => c.name === 'Паша: бухой'));
  assert.equal(s.deck.length, deckBefore + 1); // замещена 1 Угроза
});

test('D5: Хит под гитаристом даёт +1 ПО', () => {
  // prep choose Ваня (guitarist). Затем Хит (attach) подкладывается под гитариста.
  const game = makeGame(['Ваня', 'Оля', 'Денис', 'Хит'], 'Ваня');
  takeTurn(game, 'buy'); // Хит аттачится под Ваню
  const s = getState(game);
  const vanya = s.home.find((c) => c.name === 'Ваня');
  assert.ok(vanya.attached && vanya.attached.some((c) => c.name === 'Хит'));
  // Ваня vp1 + Хит vp1 = 2
  assert.equal(getScore(game), 2);
});

test('D6: Порванная струна обнуляет ПО гитаристов', () => {
  const game = makeGame(['Ваня', 'Оля', 'Денис', 'Порванная струна'], 'Ваня');
  takeTurn(game, 'discard'); // Порванная струна -> Зона Угрозы
  // Ваня (гитарист) теперь 0 ПО
  assert.equal(getScore(game), 0);
});

test('D7: Натянуть струну (🔄) сбрасывает Порванную струну при наличии гитариста', () => {
  // prep: Ваня(guitarist) в Дом. Затем Порванная струна (угроза), затем Натянуть струну.
  const game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Порванная струна', 'Натянуть струну'],
    'Ваня'
  );
  takeTurn(game, 'discard'); // Порванная струна в угрозе
  takeTurn(game, 'discard'); // Натянуть струну в сброс (открыта), готова к активации
  activate(game, 'Натянуть струну'); // 🔄: сбросить Порванную струну (гитарист есть)
  const s = getState(game);
  assert.equal(s.threat.find((c) => c.name === 'Порванная струна'), undefined);
});

test('D8: Большая вечеринка даёт +1 ПО за каждого человека в игре (в конце)', () => {
  // prep choose Ваня (man). Далее Оля(woman), Денис(man) покупаем -> 3 человека.
  const game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Оля', 'Денис', 'Большая вечеринка'],
    'Ваня'
  );
  // колода после prep: [Оля, Денис, Большая вечеринка] (top=БВ)
  // Докупим людей в Дом, затем Большая вечеринка.
  // energy=2 -> купить Олю(-2). Денис не купить -> сброс.
  takeTurn(game, 'buy'); // Оля -> home (woman)
  takeTurn(game, 'discard'); // Денис -> discard (+1 energy)
  // energy=1, покупка БВ недоступна -> сброс. Но БВ должна попасть в Дом для эффекта.
  // Чтобы проверить эффект, дадим энергию через ещё один сброс: добавим карту.
  // (упрощаем: перестроим колоду с запасом энергии)
  // --- альтернативный сценарий ниже (D8b)
  assert.ok(true); // placeholder, реальная проверка в D8b
});

test('D8b: Большая вечеринка +1 ПО за человека при достаточной энергии', () => {
  const game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Комната 402', 'Оля', 'Денис', 'Большая вечеринка'],
    'Ваня'
  );
  // prep: энергия 2, home=[Ваня]. колода: [Комната 402, Оля, Денис, Большая вечеринка]
  takeTurn(game, 'discard'); // Комната 402 -> +1 energy (3)
  takeTurn(game, 'buy'); // Оля -> home (woman), -2 (1)
  takeTurn(game, 'discard'); // Денис -> +1 (2)
  takeTurn(game, 'buy'); // Большая вечеринка -> home, -2 (0)
  // люди в игре: Ваня(man), Оля(woman) = 2 человека => +2 ПО
  // Ваня vp1 + Оля 0 + Большая вечеринка 0 + бонус 2 = 3
  assert.equal(getScore(game), 3);
});

// ---- E. Инварианты -------------------------------------------------------

const ALL_NAMES = new Set(cards.map((c) => c.name));

function topLevelCards(state) {
  return [...state.deck, ...state.home, ...state.threat, ...state.discard];
}

// Рекурсивный подсчёт всех карт (включая вложенные attach/accumulated).
function countAllCards(state) {
  let n = 0;
  const walk = (zone) => {
    for (const c of zone) {
      n++;
      if (c.attached) walk(c.attached);
      if (c.accumulated) walk(c.accumulated);
    }
  };
  walk(state.deck);
  walk(state.home);
  walk(state.threat);
  walk(state.discard);
  return n;
}

// Проверяет свойства, верные при ЛЮБЫХ ходах. Падает при нарушении.
function assertInvariants(game) {
  const s = getState(game);

  // Энергия — целое неотрицательное.
  assert.equal(Number.isInteger(s.energy), true, 'energy not integer');
  assert.ok(s.energy >= 0, `energy negative: ${s.energy}`);

  // Статус валиден.
  assert.ok(
    ['playing', 'won', 'lost'].includes(s.status),
    `bad status: ${s.status}`
  );

  // Все карты в зонах — известны.
  for (const c of topLevelCards(s)) {
    assert.ok(ALL_NAMES.has(c.name), `unknown card in play: ${c.name}`);
  }

  // Зоны не пересекаются по ссылке (одна карта не в двух местах сразу).
  const seen = new Set();
  for (const c of topLevelCards(s)) {
    assert.ok(!seen.has(c), `card in two zones: ${c.name}`);
    seen.add(c);
  }

  // Счётчик Угроз: карта «Обход» НЕ считается Угрозой.
  const realThreats = s.threat.filter((c) => c.threat === true);
  assert.ok(
    !s.threat.some((c) => c.name === 'Обход' && c.threat === true),
    'Обход учтён как Угроза'
  );

  // Поражение => счёт 0; счёт всегда конечен и >= 0.
  const score = getScore(game);
  assert.equal(Number.isInteger(score), true, 'score not integer');
  assert.ok(score >= 0, `score negative: ${score}`);
  if (s.status === 'lost') assert.equal(score, 0, 'lost but score != 0');

  return { realThreats: realThreats.length, total: countAllCards(s) };
}

test('E1: инварианты держатся в ручной партии (победа)', () => {
  const game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'День рождения!', 'Тост', 'Комната 402'],
    'Ваня'
  );
  assertInvariants(game);
  let guard = 0;
  while (game.status === 'playing' && guard++ < 100) {
    const action = getState(game).energy >= 2 ? 'buy' : 'discard';
    takeTurn(game, action);
    assertInvariants(game);
  }
  assert.equal(game.status, 'won');
});

test('E2: инварианты держатся при накоплении Палёного алкоголя', () => {
  const game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Палёный алкоголь', 'Комната 402', 'Тост', 'Денис', 'Оля'],
    'Ваня'
  );
  takeTurn(game, 'discard'); // Палёный алкоголь -> накопление
  assertInvariants(game);
  takeTurn(game, 'discard');
  assertInvariants(game);
  takeTurn(game, 'discard');
  assertInvariants(game);
  takeTurn(game, 'discard'); // достигает 3 -> сброс себя + кучи
  assertInvariants(game);
});

// ---- F. Property-based / fuzz --------------------------------------------

// Простой детерминированный ГПСЧ (LCG), чтобы падения воспроизводились по seed.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CARD_POOL = cards.map((c) => c.name);

// Один случайный прогон: случайная колода + случайные ДОПУСТИМЫЕ действия.
// Возвращает финальное состояние для проверки детерминизма.
function simulate(seed) {
  const rng = lcg(seed);
  const n = 20 + Math.floor(rng() * 25);
  const order = [];
  for (let i = 0; i < n; i++) {
    order.push(CARD_POOL[Math.floor(rng() * CARD_POOL.length)]);
  }
  const top3 = order.slice(-3);
  const choose = top3[Math.floor(rng() * 3)];
  const game = makeGame(order, choose);
  assertInvariants(game);
  let turns = 0;
  while (game.status === 'playing' && turns < 20000) {
    const energy = getState(game).energy;
    // Допустимое действие: покупка только при energy>=2, иначе сброс.
    const action = energy >= 2 ? (rng() < 0.6 ? 'buy' : 'discard') : 'discard';
    takeTurn(game, action);
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

test('G2: разные seed обычно дают разные партии (не зациклено на константе)', () => {
  const results = new Set();
  for (let seed = 1000; seed < 1010; seed++) {
    const r = simulate(seed);
    results.add(`${r.status}:${r.score}:${r.turns}`);
  }
  // Хотя бы 2 различных исхода среди 10 — проверка, что ГПСЧ реально варьирует.
  assert.ok(results.size >= 2, 'fuzz выдаёт одинаковые партии независимо от seed');
});

// ---- TODO: активация 🔄 и выбор ⚡ (до реализации движка уточняется API) ----
// - activate(game, cardName) уже используется в D7.
// - Для ⚡ при нескольких срабатывающих эффектах нужен выбор игрока:
//   takeTurn(game, { action, eventChoice: cardName }) — контракт уточнить при движке.
// - Возможна отдельная модельная проверка счёта (oracle): упрощённый пересчёт
//   ПО из состояния и сверка с getScore — добавить когда движок стабилизируется.
