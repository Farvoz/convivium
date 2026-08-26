// Классический скрипт (работает и с file://). Данные/движок — через глобалы,
// выставленные cards.js и engine.js. Тело обёрнуто в IIFE, чтобы локальные
// const не конфликтовали с глобальными именами из cards.js / engine.js.
(() => {
const { cards } = globalThis;
const {
  createGame, setup, getScore, getState, activate,
  runTurnStart, getTopCard, resolveTop,
} = globalThis.Convivium;

// ---------------------------------------------------------------------------
// Данные отображения
// ---------------------------------------------------------------------------
const FACE_MAP = {
  'Ваня': 'faces/face_vanya.png',
  'Оля': 'faces/face_olya.png',
  'Денис': 'faces/face_den.png',
  'Шура': 'faces/face_shurik.png',
  'Шура: бухой': 'faces/face_shurik.png',
  'Паша': 'faces/face_pavel.png',
  'Паша: бухой': 'faces/face_pavel.png',
  '3-й сосед': 'faces/face_vova.png',
};
const ICON_MAP = {
  'Обход': '🚪', 'Комната 402': '📍', 'Порванная струна': '🎸', 'Шум': '🔊',
  'Хит': '🎵', 'Плов': '🍚', 'Кровать': '🛏️', 'Конфликт': '⚡',
  'День рождения!': '🎂', 'Палёный алкоголь': '🔥', 'Тост': '🥂',
  'Большая вечеринка': '🎉', 'Старшекур': '🚬', 'Массовый перекур': '🚬',
};
const TAG_ICON = { guitarist: '🎸', man: '👨', woman: '👩', place: '📍' };

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function cloneCard(c) {
  const clone = { ...c };
  if (c.tags) clone.tags = [...c.tags];
  if (c.effects) clone.effects = c.effects.map((e) => ({ ...e }));
  if (c.activate) clone.activate = c.activate.map((e) => ({ ...e }));
  if (c.attach) clone.attach = { ...c.attach };
  return clone;
}
const isThreatTemplate = (c) => c.arrow === 'up' && c.threat !== false;
const isThreatCard = (c) => c.arrow === 'up' && c.threat !== false;

function isPerson(c) { return !!(c.tags && (c.tags.includes('man') || c.tags.includes('woman'))); }
function matches(card, m) {
  if (!m) return true;
  if (m.name && card.name !== m.name) return false;
  if (m.tags && !m.tags.every((t) => card.tags && card.tags.includes(t))) return false;
  if (m.person && !isPerson(card)) return false;
  return true;
}
function conditionMet(cond) {
  if (!cond) return true;
  const ip = [...game.home, ...game.threat];
  if (cond.name) return ip.some((c) => c.name === cond.name);
  if (cond.tags) return ip.some((c) => cond.tags.every((t) => c.tags && c.tags.includes(t)));
  return true;
}
const isBuyFree = (card) => (card.effects || []).some((e) => e.op === 'buyFreeIf' && conditionMet(e.match));

function vpStars(vp) {
  const n = Math.abs(vp);
  if (n === 0) return '';
  const stars = '★'.repeat(n);
  return vp < 0 ? `<span class="neg">−${stars}</span>` : stars;
}

// ---------------------------------------------------------------------------
// Сборка колоды (фиксированный дефолт сложности)
// ---------------------------------------------------------------------------
function buildDeck() {
  const all = cards.map(cloneCard);
  const obhod = all.find((c) => c.name === 'Обход');
  const threats = all.filter(isThreatTemplate);
  const autos = all.filter((c) => c.arrow === 'down');  // автокарты (стрелка вниз)
  const rest = all.filter((c) => !isThreatTemplate(c) && c.name !== 'Обход' && !autos.includes(c));
  shuffle(rest);
  const prep3 = rest.splice(0, 3);            // открытые 3 для подготовки
  const extraThreats = shuffle(threats.filter((c) => c.name !== 'Обход')).slice(0, 3);
  const injected = [obhod, ...extraThreats, ...autos];  // Обход + 3 угрозы + автокарты обратно в колоду
  for (const t of injected) {
    const idx = Math.floor(Math.random() * (rest.length + 1));
    rest.splice(idx, 0, t);
  }
  return [...prep3, ...rest];
}

// ---------------------------------------------------------------------------
// Состояние UI
// ---------------------------------------------------------------------------
let game = null;
let topCard = null;
let busy = false;
let currentCanBuy = false;
let autoTimer = null;
let logEntries = [];
let deckTotal = null;

const setScreen = (name) => {
  for (const s of ['start', 'prep', 'game', 'end']) {
    $('screen-' + s).classList.toggle('hidden', s !== name);
  }
};

function pushLog(msg) {
  logEntries.unshift(msg);
  if (logEntries.length > 60) logEntries.pop();
  $('last-event').textContent = msg;
  const ul = $('log-list');
  ul.innerHTML = '';
  for (const m of logEntries) {
    const li = document.createElement('li');
    li.textContent = m;
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Рендер карты
// ---------------------------------------------------------------------------
function renderCardEl(card, { compact = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (compact ? ' compact' : '');
  if (card.asleep) el.classList.add('asleep');

  const img = document.createElement('div');
  img.className = 'card-img';
  const face = FACE_MAP[card.name];
  if (face) {
    const im = document.createElement('img');
    im.src = face; im.alt = card.name;
    img.appendChild(im);
  } else {
    img.classList.add('placeholder');
    img.textContent = ICON_MAP[card.name] || '🃏';
  }
  el.appendChild(img);

  const body = document.createElement('div');
  body.className = 'card-body';

  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = card.name;
  body.appendChild(name);

  const vp = card.vpEffective != null ? card.vpEffective : (card.vp || 0);
  const stars = vpStars(vp);
  if (stars) {
    const v = document.createElement('div');
    v.className = 'card-vp';
    v.innerHTML = stars;
    body.appendChild(v);
  }
  if (card.tags && card.tags.length) {
    const t = document.createElement('div');
    t.className = 'card-tags';
    t.innerHTML = card.tags.map((tg) => `<span class="tag">${TAG_ICON[tg] || tg}</span>`).join('');
    body.appendChild(t);
  }
  if (!compact && card.description) {
    const d = document.createElement('div');
    d.className = 'card-desc';
    d.textContent = card.description;
    body.appendChild(d);
  }
  el.appendChild(body);

  // бейджи вложений / накопления
  const cnt = (card.attached && card.attached.length) || (card.accumulated && card.accumulated.length);
  if (cnt) {
    const b = document.createElement('div');
    b.className = 'card-badge-cnt';
    b.textContent = (card.attached ? '⟳' : '🂠') + cnt;
    el.appendChild(b);
  }
  return el;
}

function stripCardEl(c) {
  const el = renderCardEl(c, { compact: true });
  if (c.cost === '🔄') {
    el.classList.add('activatable');
    el.title = 'Активировать';
    el.onclick = () => onActivate(c.name);
  } else {
    el.classList.add('clickable');
    el.onclick = () => openDetail(c);
  }
  return el;
}

function render() {
  const s = getState(game);
  $('energy-val').textContent = s.energy;
  if (deckTotal == null) deckTotal = s.deck.length;
  const frac = Math.max(0, Math.min(1, s.deck.length / deckTotal));
  updateBeerGlass(frac, s.deck.length);

  const realThreats = s.threat.filter(isThreatCard).length;
  $('threat-strip').classList.toggle('warn', realThreats >= 3);

  const tw = $('threat-cards'); tw.innerHTML = '';
  for (const c of s.threat) tw.appendChild(stripCardEl(c));
  const hw = $('home-cards'); hw.innerHTML = '';
  for (const c of s.home) hw.appendChild(stripCardEl(c));
}

function updateBeerGlass(frac, count) {
  const beer = $('beer');
  if (beer) beer.style.transform = 'translateY(' + ((1 - frac) * 42) + 'px)';
  const g = $('deck-glass');
  if (g) g.setAttribute('aria-label', 'Осталось карт: ' + count);
}

function hideArrows() {
  $('play-actions').classList.add('hidden');
}

function renderCenter(card) {
  const wrap = $('center-card');
  wrap.className = 'card center pop-in';
  wrap.innerHTML = '';
  wrap.appendChild(renderCardEl(card));
}

// ---------------------------------------------------------------------------
// Подготовка
// ---------------------------------------------------------------------------
function goPrep() {
  setScreen('prep');
  const top3 = game.deck.slice(0, 3);
  const row = $('prep-cards');
  row.innerHTML = '';
  for (const c of top3) {
    const el = renderCardEl(c);
    el.classList.add('clickable');
    el.onclick = () => choosePrep(c);
    row.appendChild(el);
  }
}

async function choosePrep(card) {
  if (busy) return;
  busy = true;
  await setup(game, { choose: (opts) => opts.find((c) => c.name === card.name) || opts[0] });
  pushLog('В Доме: ' + game.home[0].name);
  busy = false;
  setScreen('game');
  startTurn();
}

// ---------------------------------------------------------------------------
// Игровой цикл
// ---------------------------------------------------------------------------
async function startTurn() {
  if (game.status !== 'playing') { endGame(); return; }
  runTurnStart(game);                 // накопление Палёного и пр.
  render();
  if (game.deck.length === 0) { game.status = 'won'; endGame(); return; }

  // Фаза активации 🔄 — ДО взятия новой карты (правила, шаг 1 хода).
  const activatable = collectActivatable();
  if (activatable.length > 0) {
    showActivationPhase(activatable);
    return;                            // ждём решения игрока -> proceedToDraw()
  }
  proceedToDraw();
}

// 🔄-карты, готовые к активации (находятся в игре: Дом или Угрозы).
function collectActivatable() {
  return [...game.home, ...game.threat].filter((c) => c.cost === '🔄');
}

function showActivationPhase() {
  document.body.classList.add('phase-activate');
  $('activation-bar').classList.remove('hidden');
  $('center-card').classList.add('hidden');
  $('btn-take').onclick = proceedToDraw;
  pushLog('Фаза активации: примени эффекты 🔄 или бери карту');
  render();
}

function proceedToDraw() {
  if (game.status !== 'playing') { endGame(); return; }
  document.body.classList.remove('phase-activate');
  $('activation-bar').classList.add('hidden');
  $('center-card').classList.remove('hidden');
  topCard = getTopCard(game);
  renderCenter(topCard);
  hideArrows();
  wait(260).then(() => enableDecision(topCard));
}

function enableDecision(card) {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  disableSwipe();
  hideArrows();

  if (card.arrow) {                   // стрелка — авто без выбора
    updatePlayInfo(card);
    setTimeout(() => resolveAndAnimate(card, null), 720);
    return;
  }
  currentCanBuy = game.energy >= 2 || isBuyFree(card);
  if (!currentCanBuy) {              // выбор только один — сброс (авто-фолбэк)
    autoTimer = setTimeout(() => resolveAndAnimate(card, 'discard'), 600);
  }
  enableSwipe(card);
  showActions(currentCanBuy);
}

function showActions(canBuy) {
  updatePlayInfo(topCard);
  $('play-actions').classList.remove('hidden');
  $('btn-buy').classList.toggle('hidden', !canBuy);
  $('btn-discard').onclick = () => resolveAndAnimate(topCard, 'discard');
  $('btn-buy').onclick = () => resolveAndAnimate(topCard, 'buy');
}

function updatePlayInfo(card) {
  const info = $('play-info');
  if (!card) { info.textContent = ''; return; }
  if (card.arrow === 'up') {
    info.innerHTML = '<span class="up">⬆ Угроза</span> — уходит в зону угроз';
  } else if (card.arrow === 'down') {
    info.innerHTML = '<span class="down">⬇ Авто</span> — сразу в Дом';
  } else {
    const buyE = isBuyFree(card) ? '<span class="pos">0⚡</span>' : '<span class="neg">−2⚡</span>';
    info.innerHTML = 'Сброс <span class="pos">+1⚡</span> · Купить ' + buyE;
  }
}

function flyDirection(card, action) {
  if (card.arrow === 'up') return 'up';
  if (card.arrow === 'down') return 'down';
  return action === 'discard' ? 'left' : 'right';
}

async function resolveAndAnimate(card, action) {
  if (busy || !card) return;
  busy = true;
  disableSwipe();
  hideArrows();

  const dir = flyDirection(card, action);
  $('center-card').classList.add('fly-' + dir);
  await wait(420);

  resolveTop(game, action);
  logResolve(card, action);
  render();

  busy = false;
  if (game.status !== 'playing') { endGame(); return; }
  startTurn();
}

function logResolve(card, action) {
  if (card.arrow === 'up') pushLog('Угроза: ' + card.name);
  else if (card.arrow === 'down') pushLog(card.name + ' → Дом');
  else if (action === 'discard') pushLog('Сброс: ' + card.name + ' (+1⚡)');
  else pushLog((isBuyFree(card) ? 'Куплено (бесплатно): ' : 'Куплено: ') + card.name + (isBuyFree(card) ? '' : ' (−2⚡)'));
}

// ---------------------------------------------------------------------------
// Свайп
// ---------------------------------------------------------------------------
function enableSwipe(card) {
  const el = $('center-card');
  let startX = null, dx = 0;
  el.onpointerdown = (e) => {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    startX = e.clientX; dx = 0;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    if (e.cancelable) e.preventDefault();
  };
  el.onpointermove = (e) => {
    if (startX == null) return;
    dx = e.clientX - startX;
    el.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    if (e.cancelable) e.preventDefault();
  };
  el.onpointerup = (e) => {
    if (startX == null) return;
    el.classList.remove('dragging');
    const decided = dx < -60 ? 'discard' : (dx > 60 && currentCanBuy ? 'buy' : null);
    el.style.transform = '';
    startX = null;
    if (decided) resolveAndAnimate(card, decided);
  };
  el.onpointercancel = () => {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    startX = null; el.classList.remove('dragging'); el.style.transform = '';
  };
}
function disableSwipe() {
  const el = $('center-card');
  el.onpointerdown = el.onpointermove = el.onpointerup = el.onpointercancel = null;
}

// ---------------------------------------------------------------------------
// Активация 🔄
// ---------------------------------------------------------------------------
async function onActivate(cardName) {
  if (busy || game.status !== 'playing') return;
  const card = [...game.home, ...game.threat].find((c) => c.name === cardName && c.cost === '🔄');
  if (!card) return;

  const needsTarget = (card.activate || []).some((e) => e.op === 'discardTarget');
  busy = true;
  let chosen = null;
  if (needsTarget) {
    chosen = await chooseFromThreats();
    if (chosen === null) { busy = false; return; }
    game.choose = () => chosen;
  }
  activate(game, cardName);
  game.choose = (opts) => opts[0];
  pushLog('Активировано: ' + cardName);
  render();
  busy = false;
}

function chooseFromThreats() {
  return new Promise((resolve) => {
    const ov = $('choice-overlay');
    const list = $('choice-cards');
    list.innerHTML = '';
    const threats = game.threat.slice();
    if (threats.length === 0) { resolve(null); return; }
    $('choice-title').textContent = 'Выбери угрозу';
    for (const t of threats) {
      const el = renderCardEl(t, { compact: true });
      el.classList.add('clickable');
      el.onclick = () => { ov.classList.add('hidden'); resolve(t); };
      list.appendChild(el);
    }
    ov.classList.remove('hidden');
  });
}

// ---------------------------------------------------------------------------
// Оверлеи
// ---------------------------------------------------------------------------
function openDetail(c) {
  const d = $('detail-card');
  d.innerHTML = '';
  d.appendChild(renderCardEl(c));
  if (c.attached && c.attached.length) {
    const sub = document.createElement('div');
    sub.className = 'card-desc';
    sub.style.marginTop = '8px';
    sub.textContent = 'Подложено: ' + c.attached.map((a) => a.name).join(', ');
    d.appendChild(sub);
  }
  $('detail-overlay').classList.remove('hidden');
}

function openDiscard() {
  const grid = $('discard-cards');
  grid.innerHTML = '';
  const s = getState(game);
  if (s.discard.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Сброс пуст.';
    grid.appendChild(p);
  }
  for (const c of s.discard) {
    const el = renderCardEl(c, { compact: true });
    grid.appendChild(el);
  }
  $('discard-overlay').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Конец игры
// ---------------------------------------------------------------------------
function endGame() {
  setScreen('end');
  const won = game.status === 'won';
  $('end-emoji').textContent = won ? '🎉' : '💤';
  $('end-title').textContent = won ? 'Победа!' : 'Поражение';
  $('end-score').textContent = 'Очки: ' + getScore(game);
  $('end-sub').textContent = won
    ? 'Ты дожил до конца колоды.'
    : 'Игра завершена эффектом карты — счёт сгорел.';
}

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------
function newGame() {
  game = createGame({ deck: buildDeck() });
  logEntries = [];
  busy = false;
  deckTotal = null;
  goPrep();
}

// ---------------------------------------------------------------------------
// Привязка событий
// ---------------------------------------------------------------------------
$('btn-start').onclick = newGame;
$('btn-again').onclick = newGame;
$('game-header').onclick = () => $('log-drawer').classList.toggle('hidden');
$('log-close').onclick = () => $('log-drawer').classList.add('hidden');
$('detail-close').onclick = () => $('detail-overlay').classList.add('hidden');
$('discard-close').onclick = () => $('discard-overlay').classList.add('hidden');
$('btn-discard-view').onclick = openDiscard;

// PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
})();
