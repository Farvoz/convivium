// Тесты автомата фаз TurnController (чистый, без DOM).
// Загрузка глобалов движка, как в test.js.
import './cards.js';
import './engine.js';
import './turnController.js';

import { test } from 'node:test';
import assert from 'node:assert';
const C = globalThis.Convivium;

function makeController() {
  const log = [];
  return {
    tc: C.createTurnController({
      render: () => {},
      log: (m) => log.push(m),
      promptChoice: async () => null,
    }),
    log,
  };
}

function freshDeck() {
  return globalThis.cards.map(C.cloneCard);
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

test('полный прогон до gameover без падений', async () => {
  const { tc } = makeController();
  tc.newSession(freshDeck());
  await tc.choosePrep(freshDeck()[0].name);
  let steps = 0;
  while (tc.state.phase !== 'gameover' && steps < 1000) {
    const card = tc.take();
    if (!card) break;
    const a = tc.assess();
    await tc.decide(a.arrow ? null : (a.canBuy ? 'buy' : 'discard'));
    steps++;
  }
  assert.equal(tc.state.phase, 'gameover');
  assert.ok(['won', 'lost'].includes(tc.state.game.status));
});
