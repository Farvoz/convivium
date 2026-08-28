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

// --- фазы хода ------------------------------------------------------------
const PHASES = ['enter', 'turnStart', 'turnEnd'];

// --- реестр примитивов DSL ------------------------------------------------
// Глубокий модуль: один источник истины про каждый op. `kind` заменяет
// ACTION/DERIVE/COND_OPS; `when` — фазу исполнения action-опа (для derive/cond
// не задаётся); `phaseable` разрешает поле `when` в эффектах; `validate` и
// `run` переносят ветки из бывших switch'ей validateEffect/runAction.
const OP_REGISTRY = {
  replace: {
    kind: 'action', when: 'enter', phaseable: true,
    validate(e, where) {
      validateMatch(e.match, where + '.replace');
      if (!['home', 'threat'].includes(e.in)) throw new Error(`${where}: replace.in home|threat`);
    },
    run(game, source, e) {
      const zone = e.in === 'threat' ? game.threat : game.home;
      const idx = zone.findIndex((c) => matches(game, c, e.match));
      if (idx >= 0) {
        const [target] = zone.splice(idx, 1);
        detachAttachments(game, target);
        game.discard.push(target);
      }
    },
  },
  pullReserve: {
    kind: 'action', when: 'enter', phaseable: true,
    validate() {},
    run(game, source, e) {
      const t = cloneThreatTemplate(game);
      t.faceDown = true;
      const idx = Math.floor(game.rng() * (game.deck.length + 1));
      game.deck.splice(idx, 0, t);
    },
  },
  accumulate: {
    kind: 'action', when: 'turnStart', phaseable: true,
    validate(e, where) { if (typeof e.max !== 'number') throw new Error(`${where}: accumulate.max number`); },
    run(game, source, e) {
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
    },
  },
  discardTarget: {
    kind: 'action', when: undefined, phaseable: true,
    validate(e, where) { validateMatch(e.filter, where + '.discardTarget'); },
    run(game, source, e) {
      const pool = game.threat.filter((c) => matches(game, c, e.filter || {}, 'threat'));
      if (pool.length) {
        const chosen = game.choose(pool);
        detachAttachments(game, chosen);
        removeFromZone(game.threat, chosen);
        game.discard.push(chosen);
      }
    },
  },
  peekReorder: {
    kind: 'action', when: undefined, phaseable: true,
    validate(e, where) { if (typeof e.count !== 'number') throw new Error(`${where}: peekReorder.count number`); },
    run(game, source, e) {
      const n = Math.min(e.count || 0, game.deck.length);
      if (n < 1) return;
      const top = game.deck.splice(0, n);
      const ordered = (typeof game.reorder === 'function') ? game.reorder(top) : top;
      game.deck.unshift(...ordered);
    },
  },
  modifyVp: {
    kind: 'derive', phaseable: false,
    validate(e, where) {
      validateMatch(e.match, where + '.modifyVp');
      if (typeof e.value !== 'number') throw new Error(`${where}: modifyVp.value number`);
    },
  },
  addVp: {
    kind: 'derive', phaseable: false,
    validate(e, where) {
      validateMatch(e.match, where + '.addVp');
      if (typeof e.amount !== 'number') throw new Error(`${where}: addVp.amount number`);
      validateCond(e.if, where + '.addVp.if');
    },
  },
  bonusVp: {
    kind: 'derive', phaseable: false,
    validate(e, where) {
      if (typeof e.amount !== 'number') throw new Error(`${where}: bonusVp.amount number`);
      validateCond(e.if, where + '.bonusVp.if');
    },
  },
  scorePerPerson: {
    kind: 'derive', phaseable: false,
    validate(e, where) { if (typeof e.amount !== 'number') throw new Error(`${where}: scorePerPerson.amount number`); },
  },
  buyFreeIf: {
    kind: 'cond', phaseable: false,
    validate(e, where) { validateMatch(e.match, where + '.buyFreeIf'); },
  },
};

const ALL_OPS = Object.keys(OP_REGISTRY);
const ACTION_OPS = ALL_OPS.filter((op) => OP_REGISTRY[op].kind === 'action');
const DERIVE_OPS = ALL_OPS.filter((op) => OP_REGISTRY[op].kind === 'derive');
const COND_OPS = ALL_OPS.filter((op) => OP_REGISTRY[op].kind === 'cond');

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

function validateEffect(e, where, inActivate) {
  if (typeof e !== 'object' || e === null) throw new Error(`${where}: effect object`);
  if (typeof e.op !== 'string') throw new Error(`${where}: effect.op string`);
  const entry = OP_REGISTRY[e.op];
  if (!entry) throw new Error(`${where}: unknown op ${e.op}`);
  if (e.when !== undefined) {
    if (inActivate) throw new Error(`${where}: op ${e.op} must not have when (activate)`);
    if (!entry.phaseable) throw new Error(`${where}: derive op ${e.op} must not have when`);
    if (!PHASES.includes(e.when)) throw new Error(`${where}: bad when ${e.when}`);
  }
  entry.validate(e, where);
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
    if (c.attach.choose !== undefined && typeof c.attach.choose !== 'boolean') throw new Error(`${where}: attach.choose boolean`);
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
    c.effects.forEach((e, i) => validateEffect(e, `${where}.effects[${i}]`, false));
  }
  if (c.activate !== undefined) {
    if (!Array.isArray(c.activate)) throw new Error(`${where}: activate array`);
    c.activate.forEach((e, i) => validateEffect(e, `${where}.activate[${i}]`, true));
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
function matches(game, card, match, zone) {
  if (!match) return true;
  if (game) {
    const asleep = deriveAsleepSet(game);
    if (asleep.has(card)) return false; // спящий «пустой»: не матчится ни по имени/тегам/человеку
  }
  if (match.zone && zone && match.zone !== zone) return false;
  if (match.name && card.name !== match.name) return false;
  if (match.tags && !match.tags.every((t) => card.tags && card.tags.includes(t))) return false;
  if (match.person && !isPerson(card)) return false;
  return true;
}
function conditionMet(game, cond) {
  if (!cond) return true;
  const asleep = deriveAsleepSet(game);
  const inPlay = inPlayCards(game).filter((c) => !asleep.has(c));
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
    reorder: g.reorder,
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

function runEnterActions(g, card) {
  applyCardActions(g, card, 'enter');
  applyAttach(g, card);
}

function applyAttach(g, card) {
  if (!card.attach) return;
  const pool = g.home.filter((c) => c !== card && matches(g, c, card.attach.match));
  if (pool.length === 0) {
    removeFromZone(g.home, card);
    g.discard.push(card);
    return;
  }
  let owner;
  if (card.attach.choose && pool.length > 1) {
    const picked = g.choose(pool);
    owner = pool.find((c) => c.name === (picked && picked.name)) || pool[0];
  } else {
    owner = pool[0];
  }
  removeFromZone(g.home, card);
  owner.attached = owner.attached || [];
  owner.attached.push(card);
  card.attachedTo = owner.name;
}

function applyCardActions(g, card, phase) {
  for (const e of card.effects || []) {
    const entry = OP_REGISTRY[e.op];
    if (!entry || entry.kind !== 'action') continue; // derive/cond-опы не исполняются
    if (entry.when === phase) entry.run(g, card, e);
  }
}

function applyPhaseActions(g, phase) {
  for (const c of inPlayCards(g)) applyCardActions(g, c, phase);
}

// --- шаблон угрозы для pullReserve ----------------------------------------

function cloneThreatTemplate(game) {
  const threats = CARDS.filter(isThreat);
  const t = threats[Math.floor(game.rng() * threats.length)];
  return cloneCard(t);
}

// --- активация 🔄 (только из игры) -----------------------------------------

function activate(game, name) {
  if (game.status !== 'playing') return game;
  const asleep = deriveAsleepSet(game);
  const card = [...game.home, ...game.threat].find((c) => c.name === name && c.cost === '🔄');
  if (!card) return game; // из сброса/вне игры — не работает
  if (asleep.has(card)) return game; // спящая карта не применяет эффекты
  const g = cloneGame(game);
  const live = [...g.home, ...g.threat].find((c) => c.name === name && c.cost === '🔄');
  for (const e of live.activate || []) {
    if (e.if && !conditionMet(g, e.if)) continue;
    const entry = OP_REGISTRY[e.op];
    if (entry && entry.kind === 'action') entry.run(g, live, e);
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

// Единый снапшот производных состояний за один проход. Раньше логика была
// размазана по deriveThreatCount/deriveThreatBreakdown/getScore/
// deriveScoreBreakdown — теперь всё считается здесь, остальные функции
// переиспользуют результат (локальность + единый источник истины).
function deriveSnapshot(game) {
  // ВАЖНО: inPlay = home + threat. Прикреплённые карты (attach) уходят из Дома в
  // owner.attached (см. applyAttach), поэтому их СОБСТВЕННЫЕ derive-эффекты
  // (modifyVp/addVp/bonusVp/scorePerPerson) здесь НЕ считаются — считается только
  // их вклад владельцу (a.vp + a.attach.bonusVp, ниже в цикле attach). Текущий
  // набор карт этим не страдает (attach-карты не имеют derive-эффектов), но
  // будущая attach-карта с таким эффектом проигнорируется — это инвариант.
  const inPlay = inPlayCards(game);
  const asleep = deriveAsleepSet(game);
  const vp = new Map();
  for (const c of inPlay) vp.set(c, c.vp || 0);
  // modifyVp — абсолютный оверрайд базы
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'modifyVp') for (const t of inPlay) if (matches(game, t, e.match)) vp.set(t, e.value);
    }
  }
  // attach — ПОСЛЕ modifyVp (Хит не теряется при Порванной струне)
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
        for (const t of inPlay) if (matches(game, t, e.match)) vp.set(t, (vp.get(t) || 0) + e.amount);
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

  // веса Угрозы — один цикл (было в deriveThreatCount / deriveThreatBreakdown)
  const threatRows = [];
  for (const c of game.threat) {
    if (!isThreat(c)) continue;
    let w = 1;
    for (const card of inPlay) {
      if (card.threatWeight && matches(game, c, card.threatWeight.match)) { w = card.threatWeight.weight; break; }
    }
    threatRows.push({ card: c, weight: w });
  }

  // итоговый счёт + вклады (один проход scorePerPerson)
  let total = 0;
  for (const c of inPlay) total += vp.get(c) || 0;
  let bonus = 0;
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op !== 'scorePerPerson') continue;
      if (e.if && !conditionMet(game, e.if)) continue;
      const persons = inPlay.filter((p) => isPerson(p) && !asleep.has(p)).length;
      bonus += e.amount * persons;
    }
  }
  total += bonus;
  const score = game.status === 'lost' ? 0 : total;
  const scoreRows = [];
  for (const c of inPlay) {
    const v = vp.get(c) || 0;
    if (v !== 0) scoreRows.push({ card: c, value: v });
  }
  if (bonus !== 0) scoreRows.push({ label: 'Бонус за гостей', value: bonus });

  return { inPlay, asleep, vpMap: vp, threatRows, score, scoreRows };
}

function deriveThreatCount(game) {
  return deriveSnapshot(game).threatRows.reduce((s, r) => s + r.weight, 0);
}

function deriveThreatBreakdown(game) {
  return deriveSnapshot(game).threatRows;
}

function deriveStatus(game) {
  for (const c of inPlayCards(game)) {
    if (c.loseIf && deriveThreatCount(game) >= (c.loseIf.threatsCount || 0)) return 'lost';
  }
  if (game.deck.length === 0) return 'won';
  return 'playing';
}

function getScore(game) {
  return deriveSnapshot(game).score;
}

// Вклады в итоговый счёт, точно суммирующиеся в getScore (для таблицы финала).
function deriveScoreBreakdown(game) {
  return deriveSnapshot(game).scoreRows;
}

// --- снапшот для UI (обогащён производными, read-only) --------------------

function getState(game) {
  const snap = deriveSnapshot(game);
  const enrich = (c) => {
    const e = { ...c };
    e.vpEffective = snap.vpMap.get(c) || 0;
    e.asleep = snap.asleep.has(c);
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

// Сборка колоды (композиция сложности) — правило, а не UI.
// all карты клонируются; prep карт открываются для подготовки;
// «Обход» + N случайных вредных (угроза/авто) инъектируются обратно в колоду.
function buildDeck(opts = {}, rng = Math.random) {
  const { prep = 3, harmful = 3, withObhod = true } = opts;
  const all = (globalThis.cards || []).map(cloneCard);
  const obhod = withObhod ? all.find((c) => c.name === 'Обход') : null;
  const harmfulCards = all.filter((c) => isThreat(c) || c.arrow === 'down');
  const rest = all.filter((c) => c.name !== 'Обход' && !harmfulCards.includes(c));
  shuffle(rest, rng);
  const prepN = rest.splice(0, prep);
  const extraArr = harmfulCards.slice();
  shuffle(extraArr, rng);
  const extra = extraArr.slice(0, harmful);
  const injected = [obhod, ...extra].filter(Boolean);
  for (const t of injected) {
    const idx = Math.floor(rng() * (rest.length + 1));
    rest.splice(idx, 0, t);
  }
  return [...prepN, ...rest];
}

// --- экспорт ---------------------------------------------------------------

globalThis.Convivium = {
  createGame, setup, takeTurn, runTurnStart, getTopCard, resolveTop, activate, getState, getScore,
  deriveThreatCount, deriveThreatBreakdown, deriveScoreBreakdown, deriveStatus, isThreat, validateCards, checkAttachInvariant,
  matches, conditionMet, deriveAsleepSet, isPerson, isBuyFree, cloneCard, buildDeck,
};
