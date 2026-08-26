// Convivium — headless-движок.
// Универсальный: вся логика карт живёт в cards.js как DSL; здесь — интерпретатор
// примитивов, фазы хода и подсчёт. Новые фазы добавляются в PHASES + handler.

const CARDS = globalThis.cards;

// Порядок фаз хода. Расширяется добавлением имени + обработчика в runPhase/applyEffect.
const PHASES = ['turnStart', 'enter', 'turnEnd'];

function isThreat(c) {
  return c.arrow === 'up' && c.threat !== false;
}
function isPerson(c) {
  return !!(c.tags && (c.tags.includes('man') || c.tags.includes('woman')));
}
function inPlayCards(game) {
  return [...game.home, ...game.threat];
}

// selector/match/condition — единый язык фильтрации карт (зона фильтруется вызывающим кодом).
function matches(card, match) {
  if (!match) return true;
  if (match.name && card.name !== match.name) return false;
  if (match.tags && !match.tags.every((t) => card.tags && card.tags.includes(t))) return false;
  if (match.person && !isPerson(card)) return false;
  return true;
}

function conditionMet(game, cond) {
  if (!cond) return true;
  const inPlay = inPlayCards(game);
  if (cond.name) return inPlay.some((c) => c.name === cond.name);
  if (cond.tags) return inPlay.some((c) => cond.tags.every((t) => c.tags && c.tags.includes(t)));
  return true;
}

// --- состояние ------------------------------------------------------------

function createGame({ deck, reserve, choose, rng } = {}) {
  const game = {
    deck: deck ? deck.slice() : [],
    home: [],
    threat: [],
    discard: [],
    reserve: reserve ? reserve.slice() : defaultReserve(),
    energy: 0,
    status: 'playing', // 'playing' | 'won' | 'lost'
    flags: {},
    log: [],
    choose: choose || ((opts) => opts[0]),
    rng: rng || Math.random,
  };
  return game;
}

function defaultReserve() {
  // Бесконечный концептуальный запас Угроз (карты со стрелкой вверх, кроме Обхода).
  return CARDS.filter((c) => isThreat(c)).map((c) => templateClone(c));
}

function templateClone(c) {
  const clone = { ...c };
  if (c.tags) clone.tags = [...c.tags];
  if (c.effects) clone.effects = c.effects.map((e) => ({ ...e }));
  if (c.activate) clone.activate = c.activate.map((e) => ({ ...e }));
  if (c.attach) clone.attach = { ...c.attach };
  return clone;
}

function cloneThreatTemplate(game) {
  const threats = CARDS.filter((c) => isThreat(c));
  const t = threats[Math.floor(game.rng() * threats.length)];
  return templateClone(t);
}

// --- подготовка -----------------------------------------------------------

function setup(game, { choose } = {}) {
  // Верх колоды = начало массива (индекс 0). Преп открывает первые 3.
  const top3 = game.deck.splice(0, 3);
  let chosen;
  if (choose) {
    chosen = choose(top3);
  } else {
    chosen = game.choose(top3);
  }
  game.home.push(chosen);
  for (const c of top3) if (c !== chosen) game.discard.push(c);
  game.energy = 2;
  recompute(game);
  return game;
}

// --- ход ------------------------------------------------------------------

function takeTurn(game, action) {
  if (game.status !== 'playing') return game;
  runTurnStart(game);
  return resolveTop(game, action);
}

// --- интерактивные примитивы (для пошагового UI) -------------------------
// Разбивают takeTurn на фазы, чтобы UI мог показать карту и дать решение
// до её размещения (важно из-за фазы turnStart, съедающей верх колоды).

function runTurnStart(game) {
  if (game.status !== 'playing') return game;
  runPhase(game, 'turnStart');
  return game;
}

function getTopCard(game) {
  return game.deck[0] || null;
}

function resolveTop(game, action) {
  if (game.status !== 'playing') return game;
  if (game.deck.length === 0) {
    finishIfWon(game);
    return game;
  }
  const card = game.deck.shift();
  placeCard(game, card, action);
  recompute(game);
  runPhase(game, 'turnEnd');
  if (game.status === 'playing' && game.deck.length === 0) game.status = 'won';
  return game;
}

function placeCard(game, card, action) {
  if (card.arrow === 'up') {
    game.threat.push(card);
    runEnter(game, card);
  } else if (card.arrow === 'down') {
    game.home.push(card);
    runEnter(game, card);
  } else {
    const free = isBuyFree(game, card);
    if (action === 'buy' && (free || game.energy >= 2)) {
      game.energy -= free ? 0 : 2;
      game.home.push(card);
      runEnter(game, card);
    } else if (action === 'discard') {
      game.discard.push(card);
      game.energy += 1;
    } else {
      // покупка запрошена, но недоступна (energy<2 и не бесплатно)
      throw new Error('not enough energy to buy');
    }
  }
}

function isBuyFree(game, card) {
  return (card.effects || []).some((e) => e.op === 'buyFreeIf' && conditionMet(game, e.match));
}

function runEnter(game, card) {
  applyEffects(game, card, 'enter');
  if (card.attach) {
    const owner = game.home.find((c) => c !== card && matches(c, card.attach.match));
    if (owner) {
      removeFromZone(game.home, card);
      owner.attached = owner.attached || [];
      owner.attached.push(card);
      card.attachedTo = owner.name;
    } else {
      removeFromZone(game.home, card);
      game.discard.push(card);
    }
  }
}

function runPhase(game, phase) {
  const inPlay = inPlayCards(game);
  for (const c of inPlay) applyEffects(game, c, phase);
}

function applyEffects(game, card, phase) {
  for (const e of card.effects || []) {
    if (e.when && e.when !== phase) continue;
    if (['modifyVp', 'addVp', 'bonusVp', 'scorePerPerson'].includes(e.op)) continue; // derive/score — отдельно
    runEffect(game, card, e);
  }
}

// --- активация 🔄 ---------------------------------------------------------

function activate(game, name) {
  const inPlay = [...game.home, ...game.threat];
  let card = inPlay.find((c) => c.name === name && c.cost === '🔄');
  let fromPlay = true;
  if (!card) {
    card = game.discard.find((c) => c.name === name && c.cost === '🔄');
    fromPlay = false;
  }
  if (!card) return game;
  for (const e of card.activate || []) {
    if (e.if && !conditionMet(game, e.if)) continue;
    runEffect(game, card, e);
  }
  // 🔄 — «цена» сброса: активируемая карта уходит в сброс (без начисления энергии).
  if (fromPlay) {
    const zone = game.home.includes(card) ? game.home : game.threat;
    removeFromZone(zone, card);
    game.discard.push(card);
  }
  recompute(game);
  return game;
}

// --- интерпретатор примитивов --------------------------------------------

function runEffect(game, source, e) {
  switch (e.op) {
    case 'replace': {
      const zone = e.in === 'threat' ? game.threat : game.home;
      const idx = zone.findIndex((c) => matches(c, e.match));
      if (idx >= 0) {
        const [target] = zone.splice(idx, 1);
        game.discard.push(target);
      }
      break;
    }
    case 'setFlag': {
      game.flags[e.key] = e.value;
      break;
    }
    case 'sleep': {
      if (e.selector === 'leftmostPerson') {
        const p = game.home.find((c) => isPerson(c) && !c.asleep);
        if (p) p.asleep = true;
      }
      break;
    }
    case 'pullReserve': {
      const t = cloneThreatTemplate(game);
      t.faceDown = true;
      const idx = Math.floor(game.rng() * (game.deck.length + 1));
      game.deck.splice(idx, 0, t);
      break;
    }
    case 'accumulate': {
      source.accumulated = source.accumulated || [];
      if (source.accumulated.length < e.max && game.deck.length > 0) {
        const taken = game.deck.shift();
        taken.faceDown = true;
        source.accumulated.push(taken);
      }
      if (source.accumulated.length >= e.max) {
        removeCard(game, source);
        game.discard.push(source);
        for (const a of source.accumulated) game.discard.push(a);
        source.accumulated = [];
      }
      break;
    }
    case 'endGameIf': {
      const need = (e.condition && e.condition.threatsCount) || 0;
      let count = 0;
      for (const c of game.threat) {
        if (c.threat === false) continue; // Обход не Угроза
        if (isThreat(c)) {
          count += c.name === 'Шум' && game.flags.shumCountsAsTwoThreats ? 2 : 1;
        }
      }
      if (count >= need) game.status = e.result === 'loss' ? 'lost' : 'won';
      break;
    }
    case 'discardTarget': {
      const pool = game.threat.filter((c) => matches(c, e.filter || {}));
      if (pool.length) {
        const chosen = game.choose(pool);
        removeFromZone(game.threat, chosen);
        game.discard.push(chosen);
      }
      break;
    }
    case 'peekReorder': {
      const n = Math.min(e.count || 0, game.deck.length);
      const top = game.deck.splice(0, n);
      for (let i = top.length - 1; i > 0; i--) {
        const j = Math.floor(game.rng() * (i + 1));
        [top[i], top[j]] = [top[j], top[i]];
      }
      game.deck.unshift(...top);
      break;
    }
    default:
      // неизвестный примитив — игнорируем (расширяемость)
      break;
  }
}

// --- производные ПО (пересчёт от текущих карт в игре) --------------------

function recompute(game) {
  const inPlay = inPlayCards(game);
  for (const c of inPlay) c.vpEffective = c.asleep ? 0 : c.vp || 0;
  for (const c of inPlay) {
    if (c.attached) for (const a of c.attached) {
      c.vpEffective += a.vp || 0;
      if (a.attach?.bonusVp && c.tags?.includes('guitarist')) c.vpEffective += a.attach.bonusVp;
    }
  }
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'modifyVp') {
        for (const t of inPlay) if (matches(t, e.match)) t.vpEffective = e.value;
      }
    }
  }
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'addVp') {
        if (e.if && !conditionMet(game, e.if)) continue;
        for (const t of inPlay) if (matches(t, e.match)) t.vpEffective += e.amount;
      }
    }
  }
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'bonusVp') {
        if (!e.if || conditionMet(game, e.if)) c.vpEffective += e.amount;
      }
    }
  }
  for (const c of inPlay) if (c.asleep) c.vpEffective = 0;
}

// --- подсчёт очков --------------------------------------------------------

function getScore(game) {
  if (game.status === 'lost') return 0;
  recompute(game);
  const inPlay = inPlayCards(game);
  let total = 0;
  for (const c of inPlay) total += c.vpEffective || 0;
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'scorePerPerson') {
        const persons = inPlay.filter((p) => isPerson(p) && !p.asleep).length;
        total += e.amount * persons;
      }
    }
  }
  return total;
}

// --- утилиты --------------------------------------------------------------

function removeFromZone(zone, card) {
  const i = zone.indexOf(card);
  if (i >= 0) zone.splice(i, 1);
}

// Удаляет карту из той зоны, где она реально находится (home/threat/discard/deck).
function removeCard(game, card) {
  for (const zone of [game.home, game.threat, game.discard, game.deck]) {
    const i = zone.indexOf(card);
    if (i >= 0) {
      zone.splice(i, 1);
      return;
    }
  }
}

function finishIfWon(game) {
  if (game.status === 'playing' && game.deck.length === 0) game.status = 'won';
}

function getState(game) {
  return {
    deck: game.deck,
    home: game.home,
    threat: game.threat,
    discard: game.discard,
    energy: game.energy,
    status: game.status,
    flags: game.flags,
    log: game.log,
  };
}

// Браузер (классический скрипт, file://) получает API через глобал.
globalThis.Convivium = {
  createGame, setup, takeTurn, runTurnStart, getTopCard, resolveTop, activate, getState, getScore,
};
