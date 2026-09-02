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
      const idx = zone.findIndex((c) => c !== source && matches(game, c, e.match));
      if (idx >= 0) {
        const [target] = zone.splice(idx, 1);
        detachAttachments(game, target);
        game.discard.push(target);
        // источник занимает слот удалённой цели -> порядок зоны сохраняется
        const srcIdx = zone.indexOf(source);
        if (srcIdx >= 0 && srcIdx !== idx) {
          zone.splice(srcIdx, 1);
          zone.splice(idx, 0, source);
        }
      }
    },
  },
  pullReserve: {
    kind: 'action', when: 'enter', phaseable: true,
    validate() {},
    run(game, source, e) {
      const t = cloneThreatTemplate(game);
      if (!t) return; // нет свободной Угрозы — не создаём дубль
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
    kind: 'action', when: 'enter', phaseable: true,
    validate(e, where) { validateMatch(e.filter, where + '.discardTarget'); },
    run(game, source, e) {
      const pool = game.threat.filter((c) => c.threat !== false && matches(game, c, e.filter || {}, 'threat'));
      if (pool.length) {
        const chosen = game.choose(pool);
        detachAttachments(game, chosen);
        removeFromZone(game.threat, chosen);
        game.discard.push(chosen);
      }
    },
  },
  shuffleThreats: {
    kind: 'action', when: 'enter', phaseable: true,
    validate() {},
    run(game) {
      for (const c of game.threat.filter((c) => isThreat(c))) {
        removeFromZone(game.threat, c);
        c.faceDown = true;
        const idx = Math.floor(game.rng() * (game.deck.length + 1));
        game.deck.splice(idx, 0, c);
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
      const cb = (typeof game.reorder === 'function') ? game.reorder(top) : top;
      // Защита: reorder должен вернуть ровно n карт. Иначе колода молча
      // укорачивается (вплоть до опустошения -> ложная победа). Возвращаем
      // исходный top без изменения порядка — колода остаётся целой.
      const ordered = (Array.isArray(cb) && cb.length === top.length) ? cb : top;
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
  addBuyCost: {
    kind: 'derive', phaseable: false,
    validate(e, where) { if (typeof e.amount !== 'number') throw new Error(`${where}: addBuyCost.amount number`); },
  },
  buyFreeIf: {
    kind: 'cond', phaseable: false,
    validate(e, where) { validateMatch(e.match, where + '.buyFreeIf'); },
  },
  intercept: {
    kind: 'action', when: undefined, phaseable: false, reveal: true,
    validate(e, where) { if (e.match !== undefined) validateMatch(e.match, where + '.intercept'); },
    // Перехват — эффект ВЛАДЕЛЬЦА: кладёт вскрытую карту под себя.
    // card — вскрытая карта (target), owner — владелец с этим эффектом.
    run(g, owner, e, card) {
      owner.attached = owner.attached || [];
      owner.attached.push(card);
      card.attachedTo = owner.name;
    },
  },
  scorePerAttached: {
    kind: 'derive', phaseable: false,
    validate(e, where) {
      if (typeof e.amount !== 'number') throw new Error(`${where}: scorePerAttached.amount number`);
      validateMatch(e.match, where + '.scorePerAttached');
    },
  },
  discardWith: {
    kind: 'action', when: undefined, phaseable: false, reveal: true, self: true,
    validate(e, where) {
      validateMatch(e.match, where + '.discardWith');
      if (!['home', 'threat'].includes(e.in)) throw new Error(`${where}: discardWith.in home|threat`);
    },
    // Взаимный сброс: цель уже в зоне (Стол) — сбросить и её, и вскрытую карту.
    // Возвращает true, если карта «поглощена» (дальнейшее размещение не нужно).
    run(g, source, e) {
      const t = discardWithTarget(g, source);
      if (!t) return false;
      const zone = e.in === 'threat' ? g.threat : g.home;
      detachAttachments(g, t);
      removeFromZone(zone, t);
      g.discard.push(t);
      g.discard.push(source);
      return true;
    },
  },
  energyOnReveal: {
    kind: 'action', when: undefined, phaseable: false, reveal: true, post: true,
    validate(e, where) { if (typeof e.amount !== 'number') throw new Error(`${where}: energyOnReveal.amount number`); },
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
  if (c.tags && c.tags.includes('place')) {
    const dt = (c.effects || []).find((e) => e.op === 'discardTarget');
    if (!dt || !dt.filter || typeof dt.filter.name !== 'string' || !dt.filter.name) {
      throw new Error(`${where}: place card needs discardTarget with filter.name`);
    }
    if (!(c.effects || []).some((e) => e.op === 'shuffleThreats')) {
      throw new Error(`${where}: place card needs shuffleThreats effect`);
    }
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
// Возвращает список карт-перехватчиков (владельцев) для входящей карты.
// По умолчанию (без match) перехватывает только настоящие угрозы (isThreat)
// и авто-карты (arrow down); с match — любые карты, проходящие matches().
// Срабатывает, только если у владельца ещё пусто «под ним» (нет attached).
function findInterceptors(game, card) {
  const eligible = [];
  for (const owner of inPlayCards(game)) {
    if (owner.attached && owner.attached.length) continue;
    const eff = (owner.effects || []).find((e) => e.op === 'intercept');
    if (!eff) continue;
    const isTarget = eff.match
      ? matches(game, card, eff.match)
      : (isThreat(card) || card.arrow === 'down');
    if (isTarget) eligible.push(owner);
  }
  return eligible;
}

// Возвращает карту-перехватчик (владельца) для входящей карты, либо null.
// При нескольких подходящих владельцах выбор делает игрок через game.choose.
function findInterceptor(game, card) {
  const eligible = findInterceptors(game, card);
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];
  const chosen = game.choose ? game.choose(eligible) : eligible[0];
  return eligible.find((o) => o.name === (chosen && chosen.name)) || eligible[0];
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

// Цель взаимного сброса для вскрытой карты: если у карты есть эффект discardWith
// и в указанной зоне уже лежит совпадение — возвращает эту карту, иначе null.
// Используется в placeCard (сам сброс) и в UI/контроллере (детект мгновенного
// эффекта до хода игрока).
function discardWithTarget(game, card) {
  const e = (card.effects || []).find((x) => x.op === 'discardWith');
  if (!e) return null;
  const zone = e.in === 'threat' ? game.threat : game.home;
  return zone.find((t) => matches(game, t, e.match)) || null;
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
  checkPlaceInvariant(g);
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
  applyRevealPostEffects(g, card);
  applyPhaseActions(g, 'turnEnd');
  g.status = deriveStatus(g);
  g.turnPhase = 'idle';
  checkAttachInvariant(g);
  checkPlaceInvariant(g);
  return g;
}

function placeCard(g, card, action) {
  const c = cloneCard(card);
  // Эффекты вскрытия ДО размещения (discardWith / перехват) — единый диспетчер.
  const outcome = applyRevealPreEffects(g, c);
  if (outcome === 'consumed' || outcome === 'intercepted') return;
  if (c.arrow === 'up') {
    g.threat.push(c);
    runEnterActions(g, c);
  } else if (c.arrow === 'down') {
    g.home.push(c);
    runEnterActions(g, c);
  } else {
    if (action !== 'buy' && action !== 'discard') throw new Error(`invalid action for neutral card ${c.name}: ${action}`);
    const free = isBuyFree(g, c);
    const cost = deriveBuyCost(g);
    if (action === 'buy' && (free || g.energy >= cost)) {
      g.energy -= free ? 0 : cost;
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

// --- эффекты вскрытия (reveal) ----------------------------------------------
// Единая диспетчеризация «эффектов вскрытия». Op-ы помечаются reveal:true; те,
// что срабатывают ПОСЛЕ размещения, — post:true (energyOnReveal).

// Pre-placement: возвращает 'consumed' | 'intercepted' | null.
// Порядок: сначала собственные reveal-эффекты вскрытой карты (discardWith),
// затем перехват владельцем (intercept). discardWith побеждает перехват.
function applyRevealPreEffects(g, card) {
  for (const e of card.effects || []) {
    const entry = OP_REGISTRY[e.op];
    // Только self-эффекты вскрытой карты (discardWith). owner-based эффекты
    // (intercept) обрабатываются отдельно ниже — иначе карта-владелец при
    // собственном вскрытии дважды бы вызвала свой же intercept с неверной арностью.
    if (entry && entry.reveal && !entry.post && entry.self) {
      if (entry.run(g, card, e)) return 'consumed';
    }
  }
  const trap = findInterceptor(g, card);
  if (trap) {
    const e = (trap.effects || []).find((x) => x.op === 'intercept');
    OP_REGISTRY.intercept.run(g, trap, e, card);
    return 'intercepted';
  }
  return null;
}

// Post-placement: срабатывает после ЛЮБОГО размещения (в т.ч. перехвата или
// взаимного сброса), если вскрытая карта имеет стрелку. ⚡ Энергия от Стола.
function applyRevealPostEffects(g, card) {
  if (card.arrow !== 'up' && card.arrow !== 'down') return;
  for (const c of inPlayCards(g)) {
    for (const e of c.effects || []) {
      if (e.op === 'energyOnReveal') g.energy += e.amount;
    }
  }
}

// --- шаблон угрозы для pullReserve ----------------------------------------

function cloneThreatTemplate(game) {
  // Резервная Угроза не должна дублировать карту, уже присутствующую в игре.
  // Учитываем ВСЕ карты, включая вложенные (attached/accumulated), иначе
  // накопленная под Палёным алкоголем Угроза не считалась бы «присутствующей»
  // и pullReserve добавил бы её копию (дубль Дня рождения! и пр.).
  // Если свободных Угроз нет — возвращаем null (pullReserve пропускает добавление).
  const present = new Set();
  const walk = (cards) => {
    for (const c of cards) {
      present.add(c.name);
      if (c.attached) walk(c.attached);
      if (c.accumulated) walk(c.accumulated);
    }
  };
  walk(game.deck); walk(game.home); walk(game.threat); walk(game.discard);
  const threats = CARDS.filter(isThreat).filter((c) => !present.has(c.name));
  if (!threats.length) return null;
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
  checkPlaceInvariant(g);
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
  const bd = new Map();
  for (const c of inPlay) {
    vp.set(c, c.vp || 0);
    if (c.vp) bd.set(c, [{ label: 'База', value: c.vp }]);
  }
  // modifyVp — абсолютный оверрайд базы
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'modifyVp') for (const t of inPlay) {
        if (matches(game, t, e.match)) {
          vp.set(t, e.value);
          bd.set(t, [{ label: 'База', value: e.value }]);
        }
      }
    }
  }
  // attach — ПОСЛЕ modifyVp (Хит не теряется при Порванной струне).
  // Только карты с полем attach (Звёздный час и т.п.) дают владельцу ПО;
  // перехваченные угрозы (attach без поля attach) ничего не дают.
  for (const c of inPlay) {
    if (c.attached) {
      for (const a of c.attached) {
        if (!a.attach) continue;
        const add = a.vp || 0;
        if (add) {
          vp.set(c, (vp.get(c) || 0) + add);
          const row = bd.get(c) || [];
          row.push({ label: a.name, value: add });
          bd.set(c, row);
        }
        if (a.attach.bonusVp && c.tags && c.tags.includes(a.attach.bonusIfTag)) {
          vp.set(c, vp.get(c) + a.attach.bonusVp);
          const row = bd.get(c) || [];
          row.push({ label: a.name, value: a.attach.bonusVp });
          bd.set(c, row);
        }
      }
    }
  }
  // addVp
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'addVp') {
        if (e.if && !conditionMet(game, e.if)) continue;
        for (const t of inPlay) {
          if (matches(game, t, e.match)) {
            vp.set(t, (vp.get(t) || 0) + e.amount);
            const row = bd.get(t) || [];
            row.push({ label: c.name, value: e.amount });
            bd.set(t, row);
          }
        }
      }
    }
  }
  // bonusVp
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'bonusVp') {
        if (e.if && !conditionMet(game, e.if)) continue;
        vp.set(c, (vp.get(c) || 0) + e.amount);
        const row = bd.get(c) || [];
        row.push({ label: c.name, value: e.amount });
        bd.set(c, row);
      }
    }
  }
  // сон обнуляет
  for (const c of asleep) {
    vp.set(c, 0);
    bd.set(c, [{ label: 'Спит', value: 0 }]);
  }

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

  // итоговый счёт + вклады (один проход scorePerPerson/scorePerAttached)
  let total = 0;
  for (const c of inPlay) total += vp.get(c) || 0;
  const bonusByCard = new Map();
  for (const c of inPlay) {
    for (const e of c.effects || []) {
      if (e.op === 'scorePerPerson') {
        if (e.if && !conditionMet(game, e.if)) continue;
        const persons = inPlay.filter((p) => isPerson(p) && !asleep.has(p)).length;
        bonusByCard.set(c, (bonusByCard.get(c) || 0) + e.amount * persons);
      } else if (e.op === 'scorePerAttached') {
        const attached = (c.attached || []).filter((a) => matches(game, a, e.match));
        bonusByCard.set(c, (bonusByCard.get(c) || 0) + e.amount * attached.length);
      }
    }
  }
  let bonus = 0;
  for (const v of bonusByCard.values()) bonus += v;
  total += bonus;
  const score = game.status === 'lost' ? 0 : total;
  const scoreRows = [];
  for (const c of inPlay) {
    scoreRows.push({ card: c, value: vp.get(c) || 0 });
  }
  for (const [card, amount] of bonusByCard) {
    scoreRows.push({ card, value: amount });
  }

  return { inPlay, asleep, vpMap: vp, vpBreakdown: bd, threatRows, score, scoreRows };
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

// Стоимость покупки нейтральной карты: база 2 + сумма addBuyCost от карт в игре.
// Грязь и подобные карты повышают цену; free-покупки (buyFreeIf) игнорируют её.
function deriveBuyCost(game) {
  let cost = 2;
  for (const c of inPlayCards(game)) {
    for (const e of c.effects || []) {
      if (e.op === 'addBuyCost') cost += e.amount;
    }
  }
  return cost;
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
    e.vpBreakdown = snap.vpBreakdown.get(c) || [];
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

// Инвариант: в Доме одновременно не более одной карты-места (тег place).
function checkPlaceInvariant(game) {
  const n = game.home.filter((c) => c.tags && c.tags.includes('place')).length;
  if (n > 1) throw new Error(`more than one place in home: ${n}`);
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Сборка колоды (прогрессивный шафл) — правило, а не UI.
// all карты клонируются; prep карты извлекаются ДО чанковинга;
// остаток делится на N чанков (по 1 harmful/Обход в каждом), каждый тасуется отдельно, затем чанки собираются.
function buildDeck(opts = {}, rng = Math.random) {
  const { prep = 3, harmful = 4, withObhod = true } = opts;
  const all = (globalThis.cards || []).map(cloneCard);
  const obhod = withObhod ? all.find((c) => c.name === 'Обход') : null;
  const harmfulCards = all.filter((c) => isThreat(c) || c.arrow === 'down');
  const neutral = all.filter((c) => c.name !== 'Обход' && !harmfulCards.includes(c));

  const prepN = neutral.slice(0, prep);
  const forChunks = neutral.slice(prep);

  const harmfulPool = [...harmfulCards];
  shuffle(harmfulPool, rng);
  const harmfulSelected = harmfulPool.slice(0, harmful);
  const pool = [...harmfulSelected, ...(withObhod && obhod ? [obhod] : [])];
  const chunksN = pool.length;

  if (chunksN === 0) return prepN;

  const baseSize = Math.floor(forChunks.length / chunksN);
  const remainder = forChunks.length % chunksN;
  const chunkSizes = Array.from({ length: chunksN }, (_, i) =>
    baseSize + (i < remainder ? 1 : 0),
  );

  const chunks = [];
  let offset = 0;
  for (let i = 0; i < chunksN; i++) {
    chunks.push(forChunks.slice(offset, offset + chunkSizes[i]));
    offset += chunkSizes[i];
  }

  for (let i = 0; i < chunksN; i++) {
    const idx = Math.floor(rng() * (chunks[i].length + 1));
    chunks[i].splice(idx, 0, pool[i]);
  }

  for (const chunk of chunks) shuffle(chunk, rng);
  shuffle(chunks, rng);

  return [...prepN, ...chunks.flat()];
}

// --- экспорт ---------------------------------------------------------------

globalThis.Convivium = {
  createGame, setup, takeTurn, runTurnStart, getTopCard, resolveTop, activate, getState, getScore,
  deriveThreatCount, deriveThreatBreakdown, deriveScoreBreakdown, deriveStatus, deriveBuyCost, isThreat, validateCards, checkAttachInvariant,
  matches, conditionMet, deriveAsleepSet, isPerson, isBuyFree, cloneCard, buildDeck, findInterceptor, findInterceptors, discardWithTarget, applyRevealPreEffects, applyRevealPostEffects,
};
