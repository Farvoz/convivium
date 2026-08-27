// Convivium — headless-движок (иммутабельный, DSL-валидируемый).
//
// Контракт:
//  - каждый transition возвращает НОВЫЙ объект game; вход никогда не мутируется;
//  - производные состояния (ПО карты, «сон», вес Угрозы, статус) НЕ хранятся на
//    картах, а вычисляются чистыми функциями derive* при необходимости;
//  - ход идёт строго по автомату фаз: idle -> (runTurnStart) -> turnStarted
//    -> (resolveTop) -> idle. Нарушение порядка -> ошибка;
//  - 🔄 активируется только из игры (home/threat); из сброса не работает.

const CARDS = globalThis.cards;

// --- категории примитивов DSL ---------------------------------------------
const ACTION_OPS = ['replace', 'pullReserve', 'accumulate', 'discardTarget', 'peekReorder'];
const DERIVE_OPS = ['modifyVp', 'addVp', 'bonusVp', 'scorePerPerson'];
const COND_OPS = ['buyFreeIf'];
const ALL_OPS = [...ACTION_OPS, ...DERIVE_OPS, ...COND_OPS];
const PHASES = ['enter', 'turnStart', 'turnEnd'];

// --- валидация DSL ---------------------------------------------------------

function validateMatch(m, where) {
  if (m === undefined) return;
  if (typeof m !== 'object' || m === null) throw new Error(`${where}: match must be object`);
  for (const k of Object.keys(m)) {
    if (!['name', 'tags', 'person', 'zone'].includes(k)) throw new Error(`${where}: unknown match key ${k}`);
  }
  if (m.name !== undefined && typeof m.name !== 'string') throw new Error(`${where}: match.name string`);
  if (m.tags !== undefined) {
    if (!Array.isArray(m.tags) || !m.tags.every((t) => typeof t === 'string')) throw new Error(`${where}: match.tags string[]`);
  }
  if (m.person !== undefined && typeof m.person !== 'boolean') throw new Error(`${where}: match.person boolean`);
  if (m.zone !== undefined && !['home', 'threat'].includes(m.zone)) throw new Error(`${where}: match.zone home|threat`);
}

function validateCond(c, where) {
  if (c === undefined) return;
  if (typeof c !== 'object' || c === null) throw new Error(`${where}: cond object`);
  for (const k of Object.keys(c)) {
    if (!['name', 'tags'].includes(k)) throw new Error(`${where}: unknown cond key ${k}`);
  }
  if (c.name !== undefined && typeof c.name !== 'string') throw new Error(`${where}: cond.name string`);
  if (c.tags !== undefined && (!Array.isArray(c.tags) || !c.tags.every((t) => typeof t === 'string'))) {
    throw new Error(`${where}: cond.tags string[]`);
  }
}

function validateEffect(e, where, allowWhen) {
  if (typeof e !== 'object' || e === null) throw new Error(`${where}: effect object`);
  if (typeof e.op !== 'string') throw new Error(`${where}: effect.op string`);
  if (!ALL_OPS.includes(e.op)) throw new Error(`${where}: unknown op ${e.op}`);
  if (e.when !== undefined) {
    if (!PHASES.includes(e.when)) throw new Error(`${where}: bad when ${e.when}`);
    if (!allowWhen) throw new Error(`${where}: op ${e.op} must not have when (activate)`);
    if (DERIVE_OPS.includes(e.op)) throw new Error(`${where}: derive op ${e.op} must not have when`);
  }
  switch (e.op) {
    case 'replace':
      validateMatch(e.match, where + '.replace');
      if (!['home', 'threat'].includes(e.in)) throw new Error(`${where}: replace.in home|threat`);
      break;
    case 'pullReserve':
      break;
    case 'accumulate':
      if (typeof e.max !== 'number') throw new Error(`${where}: accumulate.max number`);
      break;
    case 'discardTarget':
      validateMatch(e.filter, where + '.discardTarget');
      break;
    case 'peekReorder':
      if (typeof e.count !== 'number') throw new Error(`${where}: peekReorder.count number`);
      break;
    case 'modifyVp':
      validateMatch(e.match, where + '.modifyVp');
      if (typeof e.value !== 'number') throw new Error(`${where}: modifyVp.value number`);
      break;
    case 'addVp':
      validateMatch(e.match, where + '.addVp');
      if (typeof e.amount !== 'number') throw new Error(`${where}: addVp.amount number`);
      validateCond(e.if, where + '.addVp.if');
      break;
    case 'bonusVp':
      if (typeof e.amount !== 'number') throw new Error(`${where}: bonusVp.amount number`);
      validateCond(e.if, where + '.bonusVp.if');
      break;
    case 'scorePerPerson':
      if (typeof e.amount !== 'number') throw new Error(`${where}: scorePerPerson.amount number`);
      break;
    case 'buyFreeIf':
      validateMatch(e.match, where + '.buyFreeIf');
      break;
  }
}

function validateCard(c, idx) {
  const where = `card[${idx}] ${c && c.name ? c.name : ''}`;
  if (typeof c !== 'object' || c === null) throw new Error(`${where}: not object`);
  if (typeof c.name !== 'string' || !c.name) throw new Error(`card[${idx}]: name required string`);
  if (c.arrow !== undefined && !['up', 'down'].includes(c.arrow)) throw new Error(`${where}: arrow up|down`);
  if (c.threat !== undefined && typeof c.threat !== 'boolean') throw new Error(`${where}: threat boolean`);
  if (c.vp !== undefined && typeof c.vp !== 'number') throw new Error(`${where}: vp number`);
  if (c.tags !== undefined && (!Array.isArray(c.tags) || !c.tags.every((t) => typeof t === 'string'))) {
    throw new Error(`${where}: tags string[]`);
  }
  if (c.cost !== undefined && c.cost !== '🔄') throw new Error(`${where}: cost 🔄`);
  if (c.attach !== undefined) {
    if (typeof c.attach !== 'object') throw new Error(`${where}: attach object`);
    validateMatch(c.attach.match, where + '.attach');
    if (c.attach.bonusVp !== undefined && typeof c.attach.bonusVp !== 'number') throw new Error(`${where}: attach.bonusVp number`);
    if (c.attach.bonusIfTag !== undefined && typeof c.attach.bonusIfTag !== 'string') throw new Error(`${where}: attach.bonusIfTag string`);
  }
  if (c.sleep !== undefined && typeof c.sleep !== 'boolean') throw new Error(`${where}: sleep boolean`);
  if (c.threatWeight !== undefined) {
    if (typeof c.threatWeight !== 'object') throw new Error(`${where}: threatWeight object`);
    validateMatch(c.threatWeight.match, where + '.threatWeight');
    if (typeof c.threatWeight.weight !== 'number') throw new Error(`${where}: threatWeight.weight number`);
  }
  if (c.loseIf !== undefined) {
    if (typeof c.loseIf !== 'object') throw new Error(`${where}: loseIf object`);
    if (typeof c.loseIf.threatsCount !== 'number') throw new Error(`${where}: loseIf.threatsCount number`);
  }
  if (c.effects !== undefined) {
    if (!Array.isArray(c.effects)) throw new Error(`${where}: effects array`);
    c.effects.forEach((e, i) => validateEffect(e, `${where}.effects[${i}]`, true));
  }
  if (c.activate !== undefined) {
    if (!Array.isArray(c.activate)) throw new Error(`${where}: activate array`);
    c.activate.forEach((e, i) => validateEffect(e, `${where}.activate[${i}]`, false));
  }
}

function validateCards(cards) {
  if (!Array.isArray(cards)) throw new Error('cards must be array');
  const seen = new Set();
  cards.forEach((c, i) => {
    validateCard(c, i);
    if (seen.has(c.name)) throw new Error(`duplicate card name ${c.name}`);
    seen.add(c.name);
  });
}

validateCards(CARDS);

// --- предикаты/фильтры -----------------------------------------------------

function isThreat(c) {
  return c.arrow === 'up' && c.threat !== false;
}
function isPerson(c) {
  return !!(c.tags && (c.tags.includes('man') || c.tags.includes('woman')));
}
function inPlayCards(game) {
  return [...game.home, ...game.threat];
}
function matches(card, match, zone) {
  if (!match) return true;
  if (match.zone && zone && match.zone !== zone) return false;
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

// --- иммутабельное копирование --------------------------------------------

function cloneCard(card) {
  const c = { ...card };
  if (card.tags) c.tags = [...card.tags];
  if (card.effects) c.effects = card.effects.map((e) => ({ ...e }));
  if (card.activate) c.activate = card.activate.map((e) => ({ ...e }));
  if (card.attach) c.attach = { ...card.attach };
  if (card.attached) c.attached = card.attached.map(cloneCard);
  if (card.accumulated) c.accumulated = card.accumulated.map(cloneCard);
  return c;
}

function cloneGame(g) {
  return {
    deck: g.deck.map(cloneCard),
    home: g.home.map(cloneCard),
    threat: g.threat.map(cloneCard),
    discard: g.discard.map(cloneCard),
    energy: g.energy,
    status: g.status,
    turnPhase: g.turnPhase,
    log: g.log,
    choose: g.choose,
    rng: g.rng,
  };
}

// --- состояние -------------------------------------------------------------

function createGame({ deck, choose, rng } = {}) {
  return {
    deck: deck ? deck.map(cloneCard) : [],
    home: [],
    threat: [],
    discard: [],
    energy: 0,
    status: 'playing',
    turnPhase: 'idle',
    log: [],
    choose: choose || ((opts) => opts[0]),
    rng: rng || Math.random,
  };
}

function setup(game, { choose } = {}) {
  const g = cloneGame(game);
  const top3 = g.deck.splice(0, 3);
  const chosen = choose ? choose(top3) : g.choose(top3);
  const card = cloneCard(chosen);
  g.home.push(card);
  for (const c of top3) if (c !== chosen) g.discard.push(c);
  g.energy = 2;
  runEnterActions(g, card); // стартовая карта тоже проигрывает enter-эффекты
  g.status = deriveStatus(g);
  g.turnPhase = 'idle';
  checkAttachInvariant(g);
  return g;
}

// --- фазы хода (строгий автомат) ------------------------------------------

function takeTurn(game, action) {
  if (game.status !== 'playing') return game;
  if (game.turnPhase !== 'idle') throw new Error('phase violation: takeTurn only when idle');
  const g = cloneGame(game);
  applyPhaseActions(g, 'turnStart');
  g.turnPhase = 'turnStarted';
  return resolveTop(g, action);
}

function runTurnStart(game) {
  if (game.status !== 'playing') return game;
  if (game.turnPhase !== 'idle') throw new Error('phase violation: runTurnStart only when idle');
  const g = cloneGame(game);
  applyPhaseActions(g, 'turnStart');
  g.turnPhase = 'turnStarted';
  return g;
}

function getTopCard(game) {
  return game.deck[0] || null;
}

function resolveTop(game, action) {
  if (game.status !== 'playing') return game;
  if (game.turnPhase !== 'turnStarted') throw new Error('phase violation: resolveTop only after runTurnStart');
  const g = cloneGame(game);
  if (g.deck.length === 0) {
    g.status = 'won';
    g.turnPhase = 'idle';
    return g;
  }
  const card = g.deck.shift();
  placeCard(g, card, action);
  applyPhaseActions(g, 'turnEnd');
  g.status = deriveStatus(g);
  g.turnPhase = 'idle';
  checkAttachInvariant(g);
  return g;
}

function placeCard(g, card, action) {
  const c = cloneCard(card);
  if (c.arrow === 'up') {
    g.threat.push(c);
    runEnterActions(g, c);
  } else if (c.arrow === 'down') {
    g.home.push(c);
    runEnterActions(g, c);
  } else {
    if (action !== 'buy' && action !== 'discard') throw new Error(`invalid action for neutral card ${c.name}: ${action}`);
    const free = isBuyFree(g, c);
    if (action === 'buy' && (free || g.energy >= 2)) {
      g.energy -= free ? 0 : 2;
      g.home.push(c);
      runEnterActions(g, c);
    } else if (action === 'discard') {
      g.discard.push(c);
      g.energy += 1;
    } else {
      throw new Error(`not enough energy to buy ${c.name}`);
    }
  }
}

function isBuyFree(game, card) {
  return (card.effects || []).some((e) => e.op === 'buyFreeIf' && conditionMet(game, e.match));
}

function effectPhase(e) {
  if (e.when) return e.when;
  if (e.op === 'accumulate') return 'turnStart';
  if (e.op === 'replace' || e.op === 'pullReserve') return 'enter';
  return null; // activate-опы
}

function runEnterActions(g, card) {
  applyCardActions(g, card, 'enter');
  applyAttach(g, card);
}

function applyAttach(g, card) {
  if (!card.attach) return;
  const owner = g.home.find((c) => c !== card && matches(c, card.attach.match));
  if (owner) {
    removeFromZone(g.home, card);
    owner.attached = owner.attached || [];
    owner.attached.push(card);
    card.attachedTo = owner.name;
  } else {
    removeFromZone(g.home, card);
    g.discard.push(card);
  }
}

function applyCardActions(g, card, phase) {
  for (const e of card.effects || []) {
    if (!ACTION_OPS.includes(e.op)) continue; // derive/cond-опы не исполняются
    if (effectPhase(e) === phase) runAction(g, card, e);
  }
}

function applyPhaseActions(g, phase) {
  for (const c of inPlayCards(g)) applyCardActions(g, c, phase);
}

// --- интерпретатор action-примитивов ---------------------------------------

function runAction(game, source, e) {
  switch (e.op) {
    case 'replace': {
      const zone = e.in === 'threat' ? game.threat : game.home;
      const idx = zone.findIndex((c) => matches(c, e.match));
      if (idx >= 0) {
        const [target] = zone.splice(idx, 1);
        detachAttachments(game, target);
        game.discard.push(target);
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
        detachAttachments(game, source);
        removeCard(game, source);
        game.discard.push(source);
        for (const a of source.accumulated) game.discard.push(a);
        source.accumulated = [];
      }
      break;
    }
    case 'discardTarget': {
      const pool = game.threat.filter((c) => matches(c, e.filter || {}, 'threat'));
      if (pool.length) {
        const chosen = game.choose(pool);
        detachAttachments(game, chosen);
        removeFromZone(game.threat, chosen);
        game.discard.push(chosen);
      }
      break;
    }
    case 'peekReorder': {
      const n = Math.min(e.count || 0, game.deck.length);
      const top = game.deck.splice(0, n);
      game.deck.unshift(...top);
      break;
    }
    default:
      break;
  }
}

function cloneThreatTemplate(game) {
  const threats = CARDS.filter(isThreat);
  const t = threats[Math.floor(game.rng() * threats.length)];
  return cloneCard(t);
}

// --- активация 🔄 (только из игры) -----------------------------------------

function activate(game, name) {
  if (game.status !== 'playing') return game;
  const card = [...game.home, ...game.threat].find((c) => c.name === name && c.cost === '🔄');
  if (!card) return game; // из сброса/вне игры — не работает
  const g = cloneGame(game);
  const live = [...g.home, ...g.threat].find((c) => c.name === name && c.cost === '🔄');
  for (const e of live.activate || []) {
    if (e.if && !conditionMet(g, e.if)) continue;
    runAction(g, live, e);
  }
  const zone = g.home.includes(live) ? g.home : g.threat;
  detachAttachments(g, live);
  removeFromZone(zone, live);
  g.discard.push(live);
  g.status = deriveStatus(g);
  checkAttachInvariant(g);
  return g;
}

// --- деривация (чистые функции, без хранения флагов) -----------------------

function deriveAsleepSet(game) {
  const set = new Set();
  for (const owner of game.home) {
    if (owner.attached && owner.attached.some((a) => a.sleep)) set.add(owner);
  }
  return set;
}

function deriveThreatCount(game) {
  let count = 0;
  for (const c of game.threat) {
    if (!isThreat(c)) continue;
    let w = 1;
    for (const card of inPlayCards(game)) {
      if (card.threatWeight && matches(c, card.threatWeight.match)) {
        w = card.threatWeight.weight;
        break;
      }
    }
    count += w;
  }
  return count;
}

function deriveThreatBreakdown(game) {
  const rows = [];
  for (const c of game.threat) {
    if (!isThreat(c)) continue;
    let w = 1;
    for (const card of inPlayCards(game)) {
      if (card.threatWeight && matches(c, card.threatWeight.match)) {
        w = card.threatWeight.weight;
        break;
      }
    }
    rows.push({ card: c, weight: w });
  }
  return rows;
}

function deriveStatus(game) {
  for (const c of inPlayCards(game)) {
    if (c.loseIf && deriveThreatCount(game) >= (c.loseIf.threatsCount || 0)) return 'lost';
  }
  if (game.deck.length === 0) return 'won';
  return 'playing';
}

function deriveVpMap(game) {
  const inPlay = inPlayCards(game);
  const asleep = deriveAsleepSet(game);
  const vp = new Map();
  for (const c of inPlay) vp.set(c, c.vp || 0);
  // modifyVp — absolute override базы
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'modifyVp') for (const t of inPlay) if (matches(t, e.match)) vp.set(t, e.value);
    }
  }
  // attach — добавляется ПОСЛЕ modifyVp (Хит не теряется при Порванной струне)
  for (const c of inPlay) {
    if (c.attached) {
      for (const a of c.attached) {
        vp.set(c, (vp.get(c) || 0) + (a.vp || 0));
        if (a.attach && a.attach.bonusVp && c.tags && c.tags.includes(a.attach.bonusIfTag)) {
          vp.set(c, vp.get(c) + a.attach.bonusVp);
        }
      }
    }
  }
  // addVp
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'addVp') {
        if (e.if && !conditionMet(game, e.if)) continue;
        for (const t of inPlay) if (matches(t, e.match)) vp.set(t, (vp.get(t) || 0) + e.amount);
      }
    }
  }
  // bonusVp
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'bonusVp') {
        if (e.if && !conditionMet(game, e.if)) continue;
        vp.set(c, (vp.get(c) || 0) + e.amount);
      }
    }
  }
  // сон обнуляет
  for (const c of asleep) vp.set(c, 0);
  return vp;
}

function getScore(game) {
  if (game.status === 'lost') return 0;
  const inPlay = inPlayCards(game);
  const vp = deriveVpMap(game);
  const asleep = deriveAsleepSet(game);
  let total = 0;
  for (const c of inPlay) total += vp.get(c) || 0;
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'scorePerPerson') {
        const persons = inPlay.filter((p) => isPerson(p) && !asleep.has(p)).length;
        total += e.amount * persons;
      }
    }
  }
  return total;
}

// --- снапшот для UI (обогащён производными, read-only) --------------------

function getState(game) {
  const vp = deriveVpMap(game);
  const asleep = deriveAsleepSet(game);
  const enrich = (c) => {
    const e = { ...c };
    e.vpEffective = vp.get(c) || 0;
    e.asleep = asleep.has(c);
    return e;
  };
  return {
    deck: game.deck.map(enrich),
    home: game.home.map(enrich),
    threat: game.threat.map(enrich),
    discard: game.discard.map(enrich),
    energy: game.energy,
    status: game.status,
    turnPhase: game.turnPhase,
    log: game.log,
  };
}

// --- утилиты ---------------------------------------------------------------

function removeFromZone(zone, card) {
  const i = zone.indexOf(card);
  if (i >= 0) zone.splice(i, 1);
}

function removeCard(game, card) {
  for (const zone of [game.home, game.threat, game.discard, game.deck]) {
    const i = zone.indexOf(card);
    if (i >= 0) {
      zone.splice(i, 1);
      return;
    }
  }
}

// Аттач-карта не может лежать отдельно: уходит в сброс вместе с владельцем.
function detachAttachments(game, card) {
  if (!card.attached || card.attached.length === 0) return;
  for (const a of card.attached) {
    delete a.attachedTo;
    game.discard.push(a);
  }
  card.attached = [];
}

// Инвариант: аттач-карта не бывает самостоятельной в Доме/Угрозе.
function checkAttachInvariant(game) {
  for (const c of game.home) {
    if (c.attach) throw new Error(`attach card ${c.name} lies separately in home`);
  }
  for (const c of game.threat) {
    if (c.attach) throw new Error(`attach card ${c.name} lies separately in threat`);
  }
  for (const c of game.home) {
    if (c.attached) {
      for (const a of c.attached) {
        if (a.attachedTo !== c.name) throw new Error(`attached card ${a.name} has wrong attachedTo (${a.attachedTo} != ${c.name})`);
      }
    }
  }
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// --- экспорт ---------------------------------------------------------------

globalThis.Convivium = {
  createGame, setup, takeTurn, runTurnStart, getTopCard, resolveTop, activate, getState, getScore,
  deriveThreatCount, deriveThreatBreakdown, deriveStatus, isThreat, validateCards, checkAttachInvariant,
};
