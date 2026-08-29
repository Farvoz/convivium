// Тесты автомата фаз TurnController (чистый, без DOM).
// Загрузка глобалов движка, как в test.js.
import './cards.js';
import './engine.js';
import './turnController.js';

import { test } from 'node:test';
import assert from 'node:assert';
const C = globalThis.Convivium;

function makeController(prompt) {
  const log = [];
  return {
    tc: C.createTurnController({
      render: () => {},
      log: (m) => log.push(m),
      promptChoice: prompt || (async () => null),
    }),
    log,
  };
}

function freshDeck() {
  return globalThis.cards.map(C.cloneCard);
}

function cardByName(name) {
  return C.cloneCard(globalThis.cards.find((c) => c.name === name));
}

// promptChoice, возвращающий первую валидную цель из пула угроз.
function threatsPrompt() {
  return async (payload) => (payload.kind === 'threats' && payload.items ? payload.items[0] : null);
}

// Ставит карту(ы) в Дом/зону угроз и переводит контроллер в фазу активации.
function setupActivate(tc, { home = [], threat = [] } = {}) {
  tc.state.game.home = home.map(cardByName);
  tc.state.game.threat = threat.map(cardByName);
  tc.state.phase = 'activate';
}

test('newSession: phase prep и игра создана', () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  assert.equal(tc.state.phase, 'prep');
  assert.ok(tc.state.game);
  assert.equal(tc.state.topCard, null);
});

test('choosePrep: переход в take/activate, карта в home', async () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  assert.ok(tc.state.phase === 'take' || tc.state.phase === 'activate');
  assert.ok(Array.isArray(tc.state.game.home));
});

test('take: peek без мутации колоды, phase reveal', async () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  const before = tc.state.game.deck.length;
  const card = tc.take();
  assert.equal(tc.state.phase, 'reveal');
  assert.ok(card);
  assert.equal(tc.state.game.deck.length, before, 'колода не уменьшилась при peek');
});

test('assess: canBuy — булево', async () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  tc.take();
  const a = tc.assess();
  assert.equal(typeof a.canBuy, 'boolean');
  assert.equal(typeof a.arrow, 'boolean');
  assert.equal(typeof a.intercepted, 'boolean');
});

test('assess: нейтральная карта под Олей помечается intercepted', async () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  tc.state.game.home = [cardByName('Оля')];
  tc.state.topCard = cardByName('Тост');
  tc.state.phase = 'reveal';
  const a = tc.assess();
  assert.equal(a.intercepted, true, 'Оля (match:{}) ловит нейтральную карту');
  assert.equal(a.arrow, false);
  const owner = C.findInterceptor(tc.state.game, tc.state.topCard);
  assert.equal(owner.name, 'Оля');
});

test('assess: без перехватчика нейтральная карта НЕ intercepted', async () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  tc.state.game.home = [];
  tc.state.topCard = cardByName('Тост');
  tc.state.phase = 'reveal';
  const a = tc.assess();
  assert.equal(a.intercepted, false);
});

test('decide: перехваченная нейтральная карта уходит под Олю без выбора', async () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  tc.state.game.home = [cardByName('Оля')];
  tc.state.game.deck = [cardByName('Тост'), ...tc.state.game.deck];
  tc.take();
  const a = tc.assess();
  assert.equal(a.intercepted, true);
  const progressed = await tc.decide(null);
  assert.equal(progressed, true);
  const olya = tc.state.game.home.find((c) => c.name === 'Оля');
  assert.ok(olya.attached && olya.attached.some((c) => c.name === 'Тост'), 'Тост лежит под Олей');
});

test('decide вне фазы reveal — нет прогресса', async () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  const progressed = await tc.decide('discard');
  assert.equal(progressed, false);
  assert.equal(tc.state.phase, 'prep');
});

test('decide(discard): ход продвигается, колода уменьшается', async () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  const before = tc.state.game.deck.length;
  tc.take();
  const progressed = await tc.decide('discard');
  assert.equal(progressed, true);
  assert.ok(tc.state.game.deck.length < before);
  assert.ok(['take', 'activate', 'gameover'].includes(tc.state.phase));
});

test('activate вне фазы activate — нет прогресса', async () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  await tc.activate('несуществующая');
  assert.ok(tc.state.phase === 'take' || tc.state.phase === 'activate');
});

test('Старшекур активация: выбранная угроза уходит в сброс', async () => {
  const { tc } = makeController(threatsPrompt());
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  setupActivate(tc, { home: ['Старшекур'], threat: ['Шум'] });
  await tc.activate('Старшекур');
  const names = tc.state.game.discard.map((c) => c.name);
  assert.ok(names.includes('Шум'), 'Шум должен быть в сбросе');
  assert.ok(names.includes('Старшекур'), 'Старшекур должен уйти в сброс после 🔄');
  assert.ok(!tc.state.game.threat.some((c) => c.name === 'Шум'), 'Шум покинул зону угроз');
});

test('Натянуть струну активация: Порванная струна сбрасывается при гитаристе', async () => {
  const { tc } = makeController(threatsPrompt());
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  setupActivate(tc, { home: ['Натянуть струну', 'Ваня'], threat: ['Порванная струна'] });
  await tc.activate('Натянуть струну');
  const names = tc.state.game.discard.map((c) => c.name);
  assert.ok(names.includes('Порванная струна'), 'Порванная струна в сбросе');
  assert.ok(names.includes('Натянуть струну'), 'Натянуть струну в сбросе');
  assert.ok(tc.state.game.home.some((c) => c.name === 'Ваня'), 'Ваня остался в Дому');
});

test('Натянуть струну без гитариста: эффект не срабатывает', async () => {
  const { tc } = makeController(threatsPrompt());
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  setupActivate(tc, { home: ['Натянуть струну'], threat: ['Порванная струна'] });
  await tc.activate('Натянуть струну');
  assert.ok(!tc.state.game.discard.some((c) => c.name === 'Порванная струна'), 'Порванная струна не сброшена');
  assert.ok(tc.state.game.threat.some((c) => c.name === 'Порванная струна'), 'Порванная струна осталась в зоне угроз');
});

test('полный прогон до gameover без падений', async () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  let steps = 0;
  while (tc.state.phase !== 'gameover' && steps < 1000) {
    const card = tc.take();
    if (!card) break;
    const a = tc.assess();
    await tc.decide(a.arrow || a.intercepted ? null : (a.canBuy ? 'buy' : 'discard'));
    steps++;
  }
  assert.equal(tc.state.phase, 'gameover');
  assert.ok(['won', 'lost'].includes(tc.state.game.status));
});

