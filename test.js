import { test } from 'node:test';
import assert from 'node:assert/strict';

// cards.js / engine.js выставляют данные и API через globalThis
import './cards.js';
import './engine.js';
import './turnController.js';
const { cards } = globalThis;
const {
  createGame, setup, takeTurn, runTurnStart, resolveTop, getScore, getState, activate, deriveThreatCount, deriveScoreBreakdown, deriveBuyCost, validateCards, checkAttachInvariant, cloneCard, buildDeck, applyRevealPreEffects, applyRevealPostEffects,
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
    ['Ваня', 'Оля', 'Денис', 'Шум', 'Порванная струна', 'Грязь', 'Обход'],
    'Ваня'
  );
  game = runToEnd(game, 'discard');
  const s = getState(game);
  assert.equal(s.status, 'lost');
  assert.equal(getScore(game), 0);
});

test('C3: Обход сам не считается Угрозой для счётчика', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Шум', 'Обход', 'Порванная струна'],
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
    ['Ваня', 'Оля', 'Денис', 'Палёный алкоголь', 'Комната 402', 'Тост', 'Плов', 'Паша', '3-й сосед'],
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

test('D4a: Шура: бухой заменяет Шуру на том же месте в Доме (порядок сохраняется)', () => {
  // Дом до замены: [Ваня, Шура, Паша]; Шура не на краю. Без перехватчиков (Оля/Денис),
  // иначе авто-карта ушла бы под них и replace не сработал.
  const g = createGame({ deck: [cloneCard(byName['Шура: бухой'])] });
  g.home = [
    cloneCard(byName['Ваня']),
    cloneCard(byName['Шура']),
    cloneCard(byName['Паша']),
  ];
  g.energy = 2;
  const after = takeTurn(g, 'buy'); // Шура: бухой заходит -> заменяет Шуру
  const order = getState(after).home.map((c) => c.name);
  assert.deepEqual(order, ['Ваня', 'Шура: бухой', 'Паша'], 'порядок Дома должен сохраниться');
});

test('D4b: Шура заменяет Шура: бухой на том же месте в Доме (симметрия, порядок)', () => {
  const g = createGame({ deck: [cloneCard(byName['Шура'])] });
  g.home = [
    cloneCard(byName['Ваня']),
    cloneCard(byName['Шура: бухой']),
    cloneCard(byName['Паша']),
  ];
  g.energy = 2;
  const after = takeTurn(g, 'buy'); // Шура заходит -> заменяет Шура: бухой
  const order = getState(after).home.map((c) => c.name);
  assert.deepEqual(order, ['Ваня', 'Шура', 'Паша'], 'порядок Дома должен сохраниться');
});

test('D4b: Шура заменяет Шура: бухой, если бухой уже в игре (симметрия)', () => {
  const g = createGame({ deck: [cloneCard(byName['Шура'])] });
  g.home = [cloneCard(byName['Шура: бухой'])];
  g.energy = 2;
  const after = takeTurn(g, 'buy'); // Шура заходит -> заменяет Шура: бухой
  const s = getState(after);
  assert.equal(s.home.find((c) => c.name === 'Шура: бухой'), undefined);
  assert.ok(s.home.find((c) => c.name === 'Шура'));
});

test('D4c: Паша заменяет Паша: бухой, если бухой уже в игре (симметрия)', () => {
  // rng=0.99 -> pullReserve кладёт Угрозу ПОСЛЕ Паши, чтобы Паша гарантированно дотянулась
  const g = createGame({ deck: [cloneCard(byName['Паша'])], rng: () => 0.99 });
  g.home = [cloneCard(byName['Паша: бухой'])];
  g.energy = 2;
  const after = takeTurn(g, 'buy'); // Паша заходит -> заменяет Паша: бухой
  const s = getState(after);
  assert.equal(s.home.find((c) => c.name === 'Паша: бухой'), undefined);
  assert.ok(s.home.find((c) => c.name === 'Паша'));
});

test('D4d: pullReserve не дублирует уже присутствующую карту (День рождения!)', () => {
  // День рождения! — один экземпляр в колоде; Паша: бухой замешивает резервную
  // Угрозу, но не вторую День рождения!.
  const g = createGame({
    deck: [cloneCard(byName['Паша: бухой']), cloneCard(byName['День рождения!'])],
    rng: () => 0.99,
  });
  g.home = [cloneCard(byName['Паша'])];
  g.energy = 2;
  let game = takeTurn(g, 'buy');
  const s = getState(game);
  const names = [...s.deck, ...s.home, ...s.threat, ...s.discard].map((c) => c.name);
  assert.equal(names.filter((n) => n === 'День рождения!').length, 1, 'День рождения! не должен дублироваться');
  assertInvariants(game);
  // доводим партию до конца — уникальность сохраняется
  let guard = 0;
  while (game.status === 'playing' && guard++ < 100) {
    const cost = deriveBuyCost(game);
    game = takeTurn(game, getState(game).energy >= cost ? 'buy' : 'discard');
    assertInvariants(game);
  }
  const finalNames = [...game.deck, ...game.home, ...game.threat, ...game.discard].map((c) => c.name);
  assert.equal(finalNames.filter((n) => n === 'День рождения!').length, 1, 'День рождения! не должен дублироваться до конца игры');
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
  const rng = () => 0.99; // pullReserve вставит угрозу после Звёздного часа
  let game = makeGame(['Плов', 'Оля', 'Денис', 'Звёздный час'], 'Плов', rng);
  game = takeTurn(game, 'buy');
  const s = getState(game);
  assert.ok(!s.home.some((c) => c.name === 'Звёздный час'));
  assert.ok(s.discard.some((c) => c.name === 'Звёздный час'));
  assert.equal(getScore(game), 2);
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

test('D5e: Шура (гитарист) + Звёздный час = 3 ПО', () => {
  let game = makeGame(['Шура', 'Оля', 'Денис', 'Звёздный час'], 'Шура');
  game = takeTurn(game, 'buy');
  const s = getState(game);
  const shura = s.home.find((c) => c.name === 'Шура');
  assert.ok(shura.attached && shura.attached.some((c) => c.name === 'Звёздный час'));
  assert.equal(getScore(game), 3); // Шура(1) + Звёздный час(1) + бонус гитариста(1)
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
  // Без Оли/Дениса в колоде, чтобы перехват не искажал подсчёт персон
  const g = createGame({ deck: [cloneCard(byName['Большая вечеринка'])] });
  g.home = [
    cloneCard(byName['Ваня']), cloneCard(byName['Паша']), cloneCard(byName['3-й сосед']),
  ];
  g.energy = 2;
  const after = takeTurn(g, 'buy'); // Большая вечеринка -> Дом
  const s = getState(after);
  assert.ok(s.home.find((c) => c.name === 'Большая вечеринка'), 'Большая вечеринка в игре');
  // persons: Ваня + Паша + 3-й сосед = 3 => scorePerPerson +3; их ПО: Ваня 1, Паша 0, 3-й 0 => 4
  assert.equal(getScore(after), 4);
});

// ---- S. Вова + 3-й сосед (взаимный сброс / энергия при вскрытии) ----------

test('S1: Вова в Доме + вскрыта Угроза -> +1 энергия', () => {
  let game = makeGame(['Вова', 'Ваня', 'Оля', 'Шум', 'Денис'], 'Вова');
  game = takeTurn(game, 'discard'); // Шум (arrow up) -> Зона Угрозы
  const s = getState(game);
  assert.equal(s.energy, 3, 'Вова дал +1 энергии за вскрытую Угрозу');
  assert.ok(s.threat.some((c) => c.name === 'Шум'));
});

test('S2: Вова в Доме + вскрыта авто-карта -> +1 энергия', () => {
  let game = makeGame(['Вова', 'Ваня', 'Оля', 'Кровать', 'Денис'], 'Вова');
  game = takeTurn(game, 'buy'); // Кровать (arrow down) -> Дом автоматически
  const s = getState(game);
  assert.equal(s.energy, 3, 'Вова дал +1 энергии за вскрытую авто-карту');
});

test('S3: Вова в Доме + вскрыта нейтральная карта -> энергия без бонуса', () => {
  let game = makeGame(['Вова', 'Ваня', 'Оля', 'Плов', 'Денис'], 'Вова');
  game = takeTurn(game, 'buy'); // Плов нейтральный -> покупка, бонуса нет
  assert.equal(getState(game).energy, 0, 'бонуса энергии быть не должно (нейтральная)');
});

test('S4: вскрыт 3-й сосед при Вовае в Доме -> оба в сброс', () => {
  let game = makeGame(['Вова', 'Ваня', 'Оля', '3-й сосед', 'Денис'], 'Вова');
  game = takeTurn(game, 'buy'); // 3-й сосед вскрыт -> взаимный сброс
  const s = getState(game);
  assert.equal(s.home.some((c) => c.name === 'Вова'), false, 'Вова ушёл в сброс');
  assert.equal(s.home.some((c) => c.name === '3-й сосед'), false, '3-й сосед не в Доме');
  assert.ok(s.discard.some((c) => c.name === 'Вова'), 'Вова в сбросе');
  assert.ok(s.discard.some((c) => c.name === '3-й сосед'), '3-й сосед в сбросе');
  assert.equal(s.energy, 2, 'энергия не изменилась (сброс автоматический)');
  assertInvariants(game);
});

test('S5: вскрыт 3-й сосед БЕЗ Воваа -> обычная покупка', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', '3-й сосед'], 'Ваня');
  game = takeTurn(game, 'buy');
  const s = getState(game);
  assert.ok(s.home.some((c) => c.name === '3-й сосед'), '3-й сосед в Доме (куплен)');
  assert.equal(s.energy, 0, 'покупка потратила 2 энергии');
});

test('S6: 3-й сосед уже в Доме + вскрыт Вова -> Вова остаётся (нет симметрии)', () => {
  let game = makeGame(['3-й сосед', 'Ваня', 'Оля', 'Вова', 'Денис'], '3-й сосед');
  game = takeTurn(game, 'buy'); // Вова вскрыт и куплен
  const s = getState(game);
  assert.ok(s.home.some((c) => c.name === 'Вова'), 'Вова остался в Доме');
  assert.ok(s.home.some((c) => c.name === '3-й сосед'), '3-й сосед остался в Доме');
});

test('S7: контроллер — вскрыт 3-й сосед при Вовае в Доме даёт instant=true и сбрасывает обе', async () => {
  const { createTurnController } = globalThis.Convivium;
  const tc = createTurnController({ render() {}, log() {}, promptChoice() { return null; } });
  const deck = ['Вова', 'Ваня', 'Оля', '3-й сосед'].map((n) => cloneCard(byName[n]));
  tc.newSession(deck);
  await tc.choosePrep('Вова');
  tc.take();
  const a = tc.assess();
  assert.equal(a.instant, true, 'ожидался мгновенный эффект');
  assert.equal(a.arrow, false);
  assert.equal(a.intercepted, false);
  await tc.decide(null);
  const s = getState(tc.state.game);
  assert.equal(s.home.some((c) => c.name === 'Вова'), false, 'Вова ушёл в сброс');
  assert.ok(s.discard.some((c) => c.name === 'Вова'), 'Вова в сбросе');
  assert.ok(s.discard.some((c) => c.name === '3-й сосед'), '3-й сосед в сбросе');
});

test('S7b: контроллер — без Воваа instant=false, 3-й сосед покупается', async () => {
  const { createTurnController } = globalThis.Convivium;
  const tc = createTurnController({ render() {}, log() {}, promptChoice() { return null; } });
  const deck = ['Ваня', 'Оля', 'Денис', '3-й сосед'].map((n) => cloneCard(byName[n]));
  tc.newSession(deck);
  await tc.choosePrep('Ваня');
  tc.take();
  const a = tc.assess();
  assert.equal(a.instant, false, 'без Воваа мгновенного эффекта нет');
  await tc.decide('buy');
  const s = getState(tc.state.game);
  assert.ok(s.home.some((c) => c.name === '3-й сосед'), '3-й сосед куплен в Дом');
});

// ---- S8. Унифицированные reveal-эффекты (applyRevealPre/PostEffects) ------

test('S8a: applyRevealPreEffects — 3-й сосед со Воваом в Доме => consumed, обе в сбросе', () => {
  const g = createGame({ deck: [] });
  g.home = [cloneCard(byName['Вова'])];
  const c = cloneCard(byName['3-й сосед']);
  const outcome = applyRevealPreEffects(g, c);
  assert.equal(outcome, 'consumed');
  assert.ok(g.discard.some((x) => x.name === 'Вова'), 'Вова в сбросе');
  assert.ok(g.discard.some((x) => x.name === '3-й сосед'), '3-й сосед в сбросе');
  assert.equal(g.home.length, 0);
});

test('S8b: applyRevealPreEffects — Угроза под Денисом => intercepted, легла под Дениса', () => {
  const g = createGame({ deck: [] });
  g.home = [cloneCard(byName['Денис'])];
  const c = cloneCard(byName['Шум']);
  const outcome = applyRevealPreEffects(g, c);
  assert.equal(outcome, 'intercepted');
  const denis = g.home.find((x) => x.name === 'Денис');
  assert.ok(denis.attached && denis.attached.some((a) => a.name === 'Шум'), 'Шум под Денисом');
});

test('S8c: applyRevealPreEffects — нейтральная без Воваа/перехвата => null', () => {
  const g = createGame({ deck: [] });
  const c = cloneCard(byName['Плов']);
  assert.equal(applyRevealPreEffects(g, c), null);
});

test('S8d: applyRevealPostEffects — Вова даёт +1 при вскрытии Угрозы', () => {
  const g = createGame({ deck: [] });
  g.home = [cloneCard(byName['Вова'])];
  const before = g.energy;
  applyRevealPostEffects(g, cloneCard(byName['Шум'])); // arrow up
  assert.equal(g.energy, before + 1);
});

test('S8e: applyRevealPostEffects — нейтральная не даёт энергии', () => {
  const g = createGame({ deck: [] });
  g.home = [cloneCard(byName['Вова'])];
  const before = g.energy;
  applyRevealPostEffects(g, cloneCard(byName['Плов'])); // без стрелки
  assert.equal(g.energy, before);
});

// ---- P. Механика place (ликвидация угрозы + замешивание + 1 место) --------

test('P1: покупка Комнаты 402 нейтрализует Порванную струну (вес=0), замешивает Шум', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Ваня');
  game.threat = [
    cloneCard(byName['Порванная струна']),
    cloneCard(byName['Шум']),
    cloneCard(byName['Обход']),
  ];
  game.energy = 2;
  game = takeTurn(game, 'buy');
  const s = getState(game);
  assert.ok(s.threat.some((c) => c.name === 'Порванная струна'), 'Порванная струна остаётся в зоне (weight=0)');
  assert.ok(s.threat.some((c) => c.name === 'Обход'), 'Обход остаётся в зоне (не isThreat)');
  assert.equal(s.threat.some((c) => c.name === 'Шум'), false, 'Шум замешан в колоду');
  assert.equal(deriveThreatCount(game), 0, 'Порванная струна нейтрализована (вес 0), Обход не считается');
  assert.ok(s.home.some((c) => c.name === 'Комната 402'), 'место в Доме');
  assert.equal(s.home.filter((c) => c.tags && c.tags.includes('place')).length, 1, 'ровно 1 место в Доме');
});

test('P2: покупка Дворика замешивает старую Комнату 402 (replace), нейтрализует Шум (вес=0)', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Дворик'], 'Ваня');
  game.home = [cloneCard(byName['Комната 402'])];
  game.threat = [cloneCard(byName['Шум']), cloneCard(byName['Обход'])];
  game.energy = 2;
  game = takeTurn(game, 'buy');
  const s = getState(game);
  assert.equal(s.home.find((c) => c.name === 'Комната 402'), undefined, 'старая Комната 402 сброшена (replace)');
  assert.ok(s.discard.some((c) => c.name === 'Комната 402'), 'Комната 402 в сбросе');
  assert.ok(s.home.some((c) => c.name === 'Дворик'), 'Дворик в Доме');
  assert.ok(s.threat.some((c) => c.name === 'Шум'), 'Шум остаётся в зоне (weight=0, нейтрализован)');
  assert.ok(s.threat.some((c) => c.name === 'Обход'), 'Обход остаётся в зоне');
  assert.equal(deriveThreatCount(game), 0, 'Шум нейтрализован (вес 0), Обход не считается');
  assert.equal(s.home.filter((c) => c.tags && c.tags.includes('place')).length, 1, 'ровно 1 место в Доме');
});

test('P3: валидация — place без threatWeightSet(match.name) бросает', () => {
  assert.throws(
    () => validateCards([{ name: 'X', tags: ['place'], effects: [{ when: 'enter', op: 'shuffleThreats' }] }]),
    /threatWeightSet/
  );
});

test('P4: валидация — place без shuffleThreats бросает', () => {
  assert.throws(
    () => validateCards([{ name: 'X', tags: ['place'], effects: [{ op: 'threatWeightSet', match: { name: 'Шум' }, value: 0 }] }]),
    /shuffleThreats/
  );
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

// ---- M. Денис (перехват угрозы/авто под себя) ----------------------------

test('M1: Денис перехватывает следующую угрозу под себя, эффект не считается', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Шум', 'Грязь', 'Конфликт'], 'Денис');
  game = runToEnd(game, 'discard');
  const s = getState(game);
  const denis = s.home.find((c) => c.name === 'Денис');
  assert.ok(denis.attached && denis.attached.some((a) => a.name === 'Шум'), 'Шум должен быть под Денисом');
  assert.equal(s.threat.length, 2, 'ровно 2 Угрозы в Зоне (перехваченный Шум не в зоне)');
  assert.equal(deriveThreatCount(game), 2, 'перехваченный Шум не считается угрозой');
});

test('M2: перехваченная Грязь не повышает цену покупки', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Грязь'], 'Денис');
  game = takeTurn(game, 'buy'); // Грязь -> под Дениса, эффект пропущен
  assert.equal(deriveBuyCost(game), 2, 'addBuyCost перехваченной Грязи не действует');
  const s = getState(game);
  assert.ok(s.home.find((c) => c.name === 'Денис').attached.some((a) => a.name === 'Грязь'));
});

test('M3: после первой перехваченной карты Денис больше не ловит', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Шум', 'Шум'], 'Денис');
  game = takeTurn(game, 'discard'); // 1-й Шум -> под Дениса
  game = takeTurn(game, 'discard'); // 2-й Шум -> в Зону Угрозы (Денис уже не пуст)
  const s = getState(game);
  assert.equal(s.threat.filter((c) => c.name === 'Шум').length, 1, 'второй Шум в зоне угроз');
});

test('M4: Денис перехватывает авто-карту (Паша: бухой), replace не срабатывает', () => {
  const g = createGame({ deck: [cloneCard(byName['Паша: бухой'])] });
  g.home = [cloneCard(byName['Паша']), cloneCard(byName['Денис'])];
  g.energy = 2;
  const after = takeTurn(g, 'buy'); // Паша: бухой -> под Дениса, replace пропущен
  const s = getState(after);
  assert.ok(s.home.find((c) => c.name === 'Паша'), 'Паша остался (не заменён)');
  const denis = s.home.find((c) => c.name === 'Денис');
  assert.ok(denis.attached && denis.attached.some((a) => a.name === 'Паша: бухой'));
});

test('M5: Денис не перехватывает нейтральную карту (покупку/сброс)', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Комната 402'], 'Денис');
  game = takeTurn(game, 'discard'); // Комната 402 — нейтральная, не перехватывается
  const s = getState(game);
  assert.ok(s.discard.some((c) => c.name === 'Комната 402'), 'нейтральная карта в сбросе, не под Денисом');
  assert.ok(!s.home.find((c) => c.name === 'Денис').attached, 'под Денисом пусто');
});

// ---- N. Оля (ловит любую следующую карту под себя, эффект не срабатывает) --

test('N1: Оля ловит следующую угрозу под себя, эффект не считается', () => {
  let game = makeGame(['Ваня', 'Оля', 'Денис', 'Шум', 'Грязь', 'Конфликт'], 'Оля');
  game = runToEnd(game, 'discard');
  const s = getState(game);
  const olya = s.home.find((c) => c.name === 'Оля');
  assert.ok(olya.attached && olya.attached.some((a) => a.name === 'Шум'), 'Шум должен быть под Олей');
  assert.equal(s.threat.length, 2, 'ровно 2 Угрозы в Зоне (перехваченный Шум не в зоне)');
  assert.equal(deriveThreatCount(game), 2, 'перехваченный Шум не считается угрозой');
});

test('N2: Оля даёт +1 ПО за каждого мужчину под ней', () => {
  const g = createGame({ deck: [cloneCard(byName['Ваня'])] });
  g.home = [cloneCard(byName['Оля'])];
  g.energy = 2;
  const after = takeTurn(g, 'discard');
  const s = getState(after);
  const olya = s.home.find((c) => c.name === 'Оля');
  assert.ok(olya.attached && olya.attached.some((a) => a.name === 'Ваня'), 'Ваня под Олей');
  assert.equal(getScore(after), 1, 'Оля +1 ПО за пойманного мужчину (Ваня)');
});

test('N3: Оля ловит только одну карту, пока под ней пусто', () => {
  const g = createGame({ deck: [cloneCard(byName['Ваня']), cloneCard(byName['Паша'])] });
  g.home = [cloneCard(byName['Оля'])];
  g.energy = 2;
  let game = takeTurn(g, 'discard'); // Ваня -> под Олю
  game = takeTurn(game, 'buy');      // Паша -> Дом (слот Оли занят)
  const s = getState(game);
  const olya = s.home.find((c) => c.name === 'Оля');
  assert.equal(olya.attached.length, 1, 'под Олей ровно одна карта');
  assert.ok(s.home.some((c) => c.name === 'Паша'), 'Паша ушёл в Дом, а не под Олю');
});

test('N4: при конфликте Денис+Оля игрок выбирает владельца (Оля)', () => {
  const g = createGame({ deck: [cloneCard(byName['Паша: бухой'])] });
  g.home = [cloneCard(byName['Паша']), cloneCard(byName['Денис']), cloneCard(byName['Оля'])];
  g.energy = 2;
  g.choose = (opts) => opts.find((c) => c.name === 'Оля') || opts[0];
  const after = takeTurn(g, 'buy');
  const s = getState(after);
  const olya = s.home.find((c) => c.name === 'Оля');
  const denis = s.home.find((c) => c.name === 'Денис');
  assert.ok(olya.attached && olya.attached.some((a) => a.name === 'Паша: бухой'), 'Паша: бухой под Олей');
  assert.ok(!denis.attached || denis.attached.length === 0, 'под Денисом пусто');
  assert.ok(s.home.find((c) => c.name === 'Паша'), 'Паша остался (replace Дениса не сработал)');
});

test('N5: не-мужчина под Олей не даёт бонуса ПО', () => {
  const g = createGame({ deck: [cloneCard(byName['Комната 402'])] });
  g.home = [cloneCard(byName['Оля'])];
  g.energy = 2;
  const after = takeTurn(g, 'discard'); // Комната 402 -> под Олю (любая)
  const s = getState(after);
  const olya = s.home.find((c) => c.name === 'Оля');
  assert.ok(olya.attached && olya.attached.some((a) => a.name === 'Комната 402'), 'Комната 402 под Олей');
  assert.equal(getScore(after), 0, 'не-мужчина не даёт бонуса, Оля без ПО');
});

test('L1b: при 3+ энергии покупка под Грязь тратит ровно 3', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Грязь', 'Комната 402', 'Дворик'],
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
    ['Ваня', 'Оля', 'Денис', 'Шум', 'Грязь', 'Порванная струна', 'Обход'],
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

test('D9c: costType energy — Ваня остаётся в Доме и тратит 2⚡', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Звёздный час'],
    'Ваня'
  );
  game.discard = [cloneCard(byName['Звёздный час'])];
  game.energy = 5;
  game = activate(game, 'Ваня');
  const s = getState(game);
  assert.ok(s.home.some((c) => c.name === 'Ваня'), 'Ваня в Доме');
  assert.equal(s.home.find((c) => c.name === 'Ваня').attached.some((c) => c.name === 'Звёздный час'), true, 'Звёздный час под Ваней');
  assert.equal(s.energy, 3, 'тратит 2⚡');
});

test('D9d: costType energy — энергии мало, эффект не срабатывает', () => {
  let game = makeGame(
    ['Ваня', 'Оля', 'Денис', 'Звёздный час'],
    'Ваня'
  );
  game.discard = [cloneCard(byName['Звёздный час'])];
  game.energy = 1; // мало для 2⚡
  game = activate(game, 'Ваня');
  const s = getState(game);
  assert.ok(s.home.some((c) => c.name === 'Ваня'), 'Ваня в Доме');
  assert.equal(s.discard.some((c) => c.name === 'Звёздный час'), true, 'Звёздный час остался в сбросе');
  assert.equal(s.energy, 1, 'энергия не потрачена');
});

test('D9e: costType energy — Шура остаётся в Доме и тратит 1⚡', () => {
  let game = makeGame(
    ['Шура', 'Оля', 'Денис', 'Звёздный час'],
    'Шура'
  );
  game.discard = [cloneCard(byName['Звёздный час'])];
  game.energy = 4;
  game = activate(game, 'Шура');
  const s = getState(game);
  assert.ok(s.home.some((c) => c.name === 'Шура'), 'Шура в Доме');
  assert.equal(s.home.find((c) => c.name === 'Шура').attached.some((c) => c.name === 'Звёздный час'), true, 'Звёздный час под Шурой');
  assert.equal(s.energy, 3, 'тратит 1⚡');
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

  // Все карты в игре уникальны по имени (дубли запрещены — см. День рождения!).
  // Учитываем вложенные (attached/accumulated), иначе перехваченная/накопленная
  // карта не считалась бы и дубль прошёл бы незамеченным.
  const nameSeen = new Set();
  const walkNames = (cards) => {
    for (const c of cards) {
      assert.ok(!nameSeen.has(c.name), `duplicate card name in game: ${c.name}`);
      nameSeen.add(c.name);
      if (c.attached) walkNames(c.attached);
      if (c.accumulated) walkNames(c.accumulated);
    }
  };
  walkNames(s.deck); walkNames(s.home); walkNames(s.threat); walkNames(s.discard);

  const realThreats = s.threat.filter((c) => c.arrow === 'up' && c.threat !== false);
  assert.ok(!s.threat.some((c) => c.name === 'Обход' && c.arrow === 'up' && c.threat !== false), 'Обход учтён как Угроза');

  const score = getScore(game);
  assert.equal(Number.isInteger(score), true, 'score not integer');
  if (s.status === 'lost') assert.equal(score, 0, 'lost but score != 0');

  checkAttachInvariant(game);

  const placeCount = s.home.filter((c) => c.tags && c.tags.includes('place')).length;
  assert.ok(placeCount <= 1, `more than one place in home: ${placeCount}`);

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
    ['Ваня', 'Оля', 'Денис', 'Палёный алкоголь', 'Комната 402', 'Тост', '3-й сосед', 'Плов'],
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

test('E3b: Шура заменён → итог = 0 (гитарист потерян, Звёздный час в сбросе)', () => {
  let game = makeGame(
    ['Шура', 'Оля', 'Денис', 'Звёздный час', 'Шура: бухой'],
    'Шура'
  );
  game = takeTurn(game, 'buy'); // Звёздный час → Шура
  assert.equal(getScore(game), 3); // Шура(1) + ЗВ(1) + бонус(1)
  game = takeTurn(game, 'buy'); // Шура: бухой заменяет Шуру
  assert.equal(getScore(game), 0); // Шура: бухой(0) + Оля(0) + Денис(0)
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
  // Колода без повторов имён (как в реальной игре через buildDeck).
  const pool = [...CARD_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const n = Math.min(pool.length, 20 + Math.floor(rng() * 25));
  const order = pool.slice(0, n);
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

test('U1: buildDeck + полная партия — имена карт уникальны во всех зонах', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rng = lcg(seed);
    const deck = buildDeck({}, rng).map(cloneCard);
    let game = createGame({ deck, rng });
    game = setup(game, { choose: (opts) => opts[0] });
    assertInvariants(game);
    let turns = 0;
    while (game.status === 'playing' && turns++ < 5000) {
      const cost = deriveBuyCost(game);
      game = takeTurn(game, getState(game).energy >= cost ? 'buy' : 'discard');
      assertInvariants(game);
    }
  }
});

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
    order: ['Ваня', 'Оля', 'Денис', 'Шум', 'Шура: бухой', 'Порванная струна', 'Обход'], choose: 'Ваня',
    run: (g) => { while (g.status === 'playing') g = takeTurn(g, 'discard'); return g; },
    expect: (g) => {
      const s = getState(g);
      assert.equal(deriveThreatCount(g), 3); // Шум по весу 2 + Порванная струна
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
    order: ['Ваня', 'Оля', 'Денис', 'Палёный алкоголь', 'Комната 402', 'Тост', 'Плов', 'Паша', '3-й сосед'],
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
    order: ['Ваня', 'Оля', 'Денис', 'Большая вечеринка', 'Комната 402', 'Плов', '3-й сосед'],
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
    id: 'scoreRows: Большая вечеринка — одна строка, не две',
    card: 'Большая вечеринка',
    order: ['Ваня', 'Оля', 'Денис', 'Большая вечеринка', 'Комната 402', 'Плов', '3-й сосед'],
    choose: 'Ваня',
    run: (g) => {
      while (g.status === 'playing') {
        const a = getState(g).energy >= 2 ? 'buy' : 'discard';
        g = takeTurn(g, a);
      }
      return g;
    },
    expect: (g) => {
      const rows = deriveScoreBreakdown(g);
      const partyRows = rows.filter((r) => r.card && r.card.name === 'Большая вечеринка');
      assert.equal(partyRows.length, 1, 'Большая вечеринка должна появиться ровно 1 раз в scoreRows');
      assert.ok(partyRows[0].value > 0, 'Бонус за гостей должен быть > 0');
    },
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
    order: ['Ваня', 'Оля', 'Денис', 'Шум', 'Порванная струна', 'Грязь', 'Обход'],
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
    id: 'discardTarget(activate): Обход не сбрасывается', card: 'Старшекур',
    order: ['Ваня', 'Оля', 'Денис', 'Старшекур', 'Обход', 'Комната 402'], choose: 'Ваня',
    run: (g) => {
      g = takeTurn(g, 'buy');
      g = takeTurn(g, 'discard');
      g = activate(g, 'Старшекур');
      return g;
    },
    expect: (g) => {
      const s = getState(g);
      assert.ok(s.threat.some((c) => c.name === 'Обход'), 'Обход остаётся в зоне угроз');
      assert.equal(s.discard.some((c) => c.name === 'Обход'), false, 'Обход не попал в сброс');
    },
  },
  {
    id: 'peekReorder(activate)', card: 'Массовый перекур',
    order: ['Ваня', 'Оля', 'Денис', 'Массовый перекур', 'Комната 402', 'Тост', 'Плов'],
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
  g.home = [cloneCard(byName['Ваня']), cloneCard(byName['Оля']), cloneCard(byName['Массовый перекур'])];
  g.reorder = (top) => [...top].reverse();
  const before = g.deck.map((c) => c.name).join(',');
  const after = activate(g, 'Массовый перекур');
  const afterDeck = after.deck.map((c) => c.name).join(',');
  assert.equal(after.deck.length, 4, 'колода той же длины');
  assert.notEqual(afterDeck, before, 'порядок верхних карт изменился');
});

test('J5: peekReorder с reorder, вернувшим [] (дефектный промпт), НЕ опустошает колоду и не даёт победу', () => {
  const g = createGame({ deck: [cloneCard(byName['Комната 402']), cloneCard(byName['Тост']), cloneCard(byName['Плов'])] });
  g.home = [cloneCard(byName['Ваня']), cloneCard(byName['Массовый перекур'])];
  g.reorder = () => [];
  const after = activate(g, 'Массовый перекур');
  assert.equal(after.deck.length, 3, 'колода не укоротилась при пустом reorder');
  assert.equal(after.status, 'playing', 'не должно быть ложной победы');
});

test('J6: peekReorder с reorder, вернувшим неверное число карт, сохраняет длину колоды', () => {
  const g = createGame({ deck: [cloneCard(byName['Комната 402']), cloneCard(byName['Тост']), cloneCard(byName['Плов'])] });
  g.home = [cloneCard(byName['Ваня']), cloneCard(byName['Массовый перекур'])];
  g.reorder = (top) => [top[0]]; // вернул меньше, чем взял
  const after = activate(g, 'Массовый перекур');
  assert.equal(after.deck.length, 3, 'колода той же длины (fallback на top)');
  assert.equal(after.status, 'playing', 'статус playing');
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
