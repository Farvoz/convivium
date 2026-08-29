// Классический скрипт (работает и с file://). Данные/движок — через глобалы,
// выставленные cards.js и engine.js. Тело обёрнуто в IIFE, чтобы локальные
// const не конфликтовали с глобальными именами из cards.js / engine.js.
//
// UI-слой тонкий: рендер DOM, анимации, ввод пальцем и тайминги. Логика фаз
// хода живёт в TurnController (turnController.js) — чистый автомат, который
// мы дёргаем через инъектированные колбэки.
(() => {
const {
  createGame, setup, getScore, getState, activate,
  runTurnStart, getTopCard, resolveTop, deriveThreatBreakdown, deriveScoreBreakdown,
  deriveThreatCount, isThreat, matches, conditionMet, deriveAsleepSet, isPerson, isBuyFree, deriveBuyCost, findInterceptor,
  createTurnController, buildDeck, enableGesture, disableGesture,
} = globalThis.Convivium;

// ---------------------------------------------------------------------------
// Данные отображения
// ---------------------------------------------------------------------------
const FACE_MAP = {
  'Ваня': 'faces/face_vanya.jpg',
  'Оля': 'faces/face_olya.jpg',
  'Денис': 'faces/face_den.jpg',
  'Шура': 'faces/face_shurik.jpg',
  'Шура: бухой': 'faces/face_shurik.jpg',
  'Паша': 'faces/face_pavel.jpg',
  'Паша: бухой': 'faces/face_pavel.jpg',
  '3-й сосед': 'faces/face_vova.jpg',
};
const ICON_MAP = {
  'Обход': '🚪', 'Комната 402': '🚪', 'Дворик': '🏡', 'Порванная струна': '🎸', 'Шум': '📢',
  'Звёздный час': '🌟', 'Плов': '🍚', 'Кровать': '🛏️', 'Конфликт': '💢',
  'День рождения!': '🎂', 'Палёный алкоголь': '🥃', 'Тост': '🥂',
  'Большая вечеринка': '🎉', 'Старшекур': '🧓', 'Массовый перекур': '🚬', 'Грязь': '🤢',
};
const TAG_ICON = { guitarist: '🎸', man: '👨', woman: '👩', place: '📍' };

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function vpStars(vp) {
  const n = Math.abs(vp);
  if (n === 0) return '';
  const stars = '★'.repeat(n);
  return vp < 0 ? `<span class="neg">−${stars}</span>` : stars;
}

// ---------------------------------------------------------------------------
// UI-состояние (только то, что про DOM/тайминги — фазы живут в контроллере)
// ---------------------------------------------------------------------------
let busy = false;
let autoTimer = null;
let logEntries = [];
let deckTotal = null;
let tc = null;
let targetMode = null;

const clearAutoTimer = () => { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } };

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
function renderCardEl(card, { compact = false, detail = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (compact ? ' compact' : '') + (detail ? ' detail' : '');
  el.dataset.name = card.name;
  if (card.asleep) el.classList.add('asleep');
  if (card.arrow === 'up') el.classList.add('neg', 'threat');
  else if (card.arrow === 'down') el.classList.add('neg', 'auto');

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

  const head = document.createElement('div');
  head.className = 'card-head';
  body.appendChild(head);

  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = card.name;
  head.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'card-head-meta';

  const vp = card.vpEffective != null ? card.vpEffective : (card.vp || 0);
  const stars = vpStars(vp);
  if (stars) {
    const v = document.createElement('div');
    v.className = 'card-vp';
    v.innerHTML = stars;
    meta.appendChild(v);
  }
  if (card.tags && card.tags.length) {
    const t = document.createElement('div');
    t.className = 'card-tags';
    t.innerHTML = card.tags.map((tg) => `<span class="tag">${TAG_ICON[tg] || tg}</span>`).join('');
    meta.appendChild(t);
  }
  if (card.attach) {
    const t = document.createElement('div');
    t.className = 'card-tags';
    const who = card.attach.match && (card.attach.match.name || (card.attach.match.tags && card.attach.match.tags.join('/')));
    t.innerHTML = '<span class="tag attach">📎 аттач' + (who ? ' → ' + who : '') + '</span>';
    meta.appendChild(t);
  }
  if (meta.childNodes.length) head.appendChild(meta);

  if (!compact && card.description) {
    const d = document.createElement('div');
    d.className = 'card-desc';
    if ((card.effects || []).some((e) => e.op === 'intercept')) {
      const badge = document.createElement('span');
      badge.className = 'intercept-badge';
      badge.textContent = '🤚';
      d.appendChild(badge);
    }
    d.appendChild(document.createTextNode(card.description));
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

// ---------------------------------------------------------------------------
// CardView — единая точка отрисовки карточки (data-driven, без спецкейсов)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Card  Карта (структура из cards.js; поля читаются data-driven)
 * @property {string} name
 * @property {number} [vp]
 * @property {string[]} [tags]
 * @property {boolean} [asleep]
 * @property {'up'|'down'|null} [arrow]
 */

/**
 * @typedef {Object} CardViewOptions
 * @property {'compact'|'detail'|'strip'} [variant='strip']  Размер/контекст
 * @property {'none'|'click'|'activate'}   [interactive='none']
 *   'click' → открыть детали; 'activate' → tc.activate; 'none' → пассивно
 * @property {(card: Card) => void} [onClick]  Перехват клика (вместо openDetail)
 */

/**
 * @param {Card} card
 * @param {CardViewOptions} [opts]
 * @returns {HTMLElement}
 */
function CardView(card, opts = {}) {
  const { variant = 'strip', interactive = 'none', onClick } = opts;
  const el = renderCardEl(card, { compact: variant === 'compact', detail: variant === 'detail' });
  if (interactive === 'activate') {
    el.classList.add('activatable');
    el.title = 'Активировать';
    el.onclick = () => tc.activate(card.name);
  } else if (interactive === 'click') {
    el.classList.add('clickable');
    el.onclick = () => (onClick ? onClick(card) : openDetail(card));
  }
  return el;
}

function stripCardEl(c) {
  const activate = tc.state.phase === 'activate' && tc.state.activatable.has(c.name);
  return CardView(c, { variant: 'strip', interactive: activate ? 'activate' : 'click' });
}

function render() {
  if (tc.state.phase === 'gameover') { endGame(); return; }
  const s = getState(tc.state.game);
  const screen = tc.state.phase === 'prep' ? 'prep'
    : tc.state.phase === 'gameover' ? 'end' : 'game';
  setScreen(screen);
  document.body.classList.toggle('phase-activate', tc.state.phase === 'activate');

  $('energy-val').textContent = s.energy;
  if (deckTotal == null) deckTotal = s.deck.length;
  const frac = Math.max(0, Math.min(1, s.deck.length / deckTotal));
  updateBeerGlass(frac, s.deck.length);
  renderDeckPile(s.deck.length);

  const realThreats = s.threat.filter(isThreat).length;
  $('threat-strip').classList.toggle('warn', realThreats >= 3);

  const tw = $('threat-cards'); tw.innerHTML = '';
  for (const c of s.threat) tw.appendChild(stripCardEl(c));
  const hw = $('home-cards'); hw.innerHTML = '';
  for (const c of s.home) hw.appendChild(stripCardEl(c));

  if (tc.state.phase === 'take' || tc.state.phase === 'activate') showTakePhaseUI();
  applyTargetMode();
}

// Режим выбора цели прямым тычком по карте на столе (без оверлея).
// targetMode = { names:Set, cancelName:string|null, resolve }
function enterBoardTarget(items, resolve, cancelName) {
  if (!items || items.length === 0) { resolve(null); return; }
  targetMode = { names: new Set(items.map((c) => c.name)), cancelName: cancelName || null, resolve };
  render();
}

function pickTarget(name) {
  if (!targetMode) return;
  const res = targetMode.resolve;
  targetMode = null;
  res([...tc.state.game.threat, ...tc.state.game.home].find((c) => c.name === name) || { name });
}

function cancelTarget() {
  if (!targetMode) return;
  const res = targetMode.resolve;
  targetMode = null;
  render();
  res(null);
}

function applyTargetMode() {
  if (!targetMode) return;
  for (const el of document.querySelectorAll('#threat-cards .card, #home-cards .card')) {
    const n = el.dataset.name;
    el.onclick = null;
    el.classList.remove('targetable', 'dimmed', 'cancelable');
    if (targetMode.names.has(n)) {
      el.classList.add('targetable');
      el.onclick = () => pickTarget(n);
    } else if (targetMode.cancelName && n === targetMode.cancelName) {
      el.classList.add('cancelable');
      el.onclick = cancelTarget;
    } else {
      el.classList.add('dimmed');
    }
  }
}

function updateBeerGlass(frac, count) {
  const beer = $('beer');
  if (beer) beer.style.transform = 'translateY(' + ((1 - frac) * 42) + 'px)';
  const g = $('deck-glass');
  if (g) g.setAttribute('aria-label', 'Осталось карт: ' + count);
}

// Визуальная колода под картой: стопка рубашек, толщина ~ остатку.
function renderDeckPile(count) {
  const backs = $('deck-backs');
  if (!backs) return;
  backs.innerHTML = '';
  const MAX = 6;
  const n = Math.max(0, Math.min(count, MAX));
  for (let i = n - 1; i >= 0; i--) {
    const b = renderCardBack();
    b.style.transform = 'translate(' + (i * 1.5) + 'px,' + (i * 3) + 'px)';
    backs.appendChild(b);
  }
  const badge = $('deck-count');
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('hidden', count <= 0);
  }
}

function hideArrows() {
  $('btn-discard').classList.add('hidden');
  $('btn-buy').classList.add('hidden');
}

// Рубашка карты (фон центра перед взятием).
function renderCardBack() {
  const el = document.createElement('div');
  el.className = 'card card-back';
  el.innerHTML =
    '<div class="back-emblem">🥂</div>' +
    '<div class="back-title">Convivium</div>';
  return el;
}

function renderCenterBack() {
  const wrap = $('center-card');
  wrap.className = 'pop-in tappable';
  wrap.innerHTML = '';
  wrap.appendChild(renderCardBack());
}

// 3D-переворот рубашки → лицо верхней карты колоды.
function flipReveal(card) {
  return new Promise((resolve) => {
    const wrap = $('center-card');
    wrap.className = '';
    wrap.innerHTML = '';
    const flip = document.createElement('div');
    flip.className = 'flip';
    flip.appendChild(renderCardBack());
    wrap.appendChild(flip);

    requestAnimationFrame(() => { flip.style.transform = 'rotateY(90deg)'; });
    setTimeout(() => {
       flip.innerHTML = '';
       flip.appendChild(CardView(card, { variant: 'detail' }));
      flip.style.transition = 'none';
      flip.style.transform = 'rotateY(-90deg)';
      requestAnimationFrame(() => {
        flip.style.transition = '';
        flip.style.transform = 'rotateY(0deg)';
      });
    }, 270);
    setTimeout(() => { resolve(); }, 580);
  });
}

// ---------------------------------------------------------------------------
// Подготовка
// ---------------------------------------------------------------------------
function goPrep() {
  setScreen('prep');
  const top3 = tc.state.game.deck.slice(0, 3);
  const row = $('prep-cards');
  row.innerHTML = '';
  for (const c of top3) {
    const el = CardView(c, {
      variant: 'detail',
      interactive: 'click',
      onClick: () => { pushLog('Открыта: ' + c.name); openDetail(c, { onConfirm: choosePrepUI, confirmLabel: 'Взять в Дом' }); },
    });
    el.classList.add('prep-card');
    row.appendChild(el);
  }
}

async function choosePrepUI(card) {
  if (busy) return;
  busy = true;
  await tc.choosePrep(card.name);
  busy = false;
}

// ---------------------------------------------------------------------------
// Взятие карты (флип-переход) — вызывается свайпом/кнопкой
// ---------------------------------------------------------------------------
async function drawAndReveal() {
  if (busy) return;
  if (tc.state.game.status !== 'playing') { endGame(); return; }
  busy = true;
  disableSwipe();
  document.body.classList.remove('phase-activate');
  const buy = $('btn-buy');
  buy.querySelector('.lbl').textContent = 'Купить';
  $('buy-e').style.display = '';
  $('center-card').classList.remove('hidden');
  const card = tc.take();          // peek, переход в 'reveal', рендер рубашки
  pushLog('Открыта: ' + card.name);
  await flipReveal(card);
  busy = false;
  enableDecisionUI(card);
}

function showTakePhaseUI() {
  renderCenterBack();
  $('center-card').classList.remove('hidden');

  $('btn-discard').classList.add('hidden');
  const buy = $('btn-buy');
  buy.classList.remove('hidden');
  buy.querySelector('.lbl').textContent = 'Взять';
  $('buy-e').style.display = 'none';
  buy.onclick = drawAndReveal;

  enableGesture($('center-card'), {
    threshold: 60,
    decide: (dx) => (dx > 60 ? 'take' : null),
    perform: () => drawAndReveal(),
    onTap: () => drawAndReveal(),
    onStart: clearAutoTimer,
  });
}



function enableDecisionUI(card) {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  disableSwipe();
  hideArrows();

  const a = tc.assess();
  const interceptor = a.intercepted ? findInterceptor(tc.state.game, card) : null;
  if (a.arrow || interceptor || a.instant) {    // стрелка / перехват / мгновенный эффект — авто без выбора
    setTimeout(() => submitDecision(null), 720);
    return;
  }
  if (!a.canBuy) {                 // выбор только один — сброс (авто-фолбэк)
    autoTimer = setTimeout(() => submitDecision('discard'), 600);
  }
  enableGesture($('center-card'), {
    threshold: 60,
    decide: (dx) => (dx < -60 ? 'discard' : (dx > 60 && tc.state.canBuy ? 'buy' : null)),
    perform: (action) => submitDecision(action),
    onStart: clearAutoTimer,
  });
  showActions(a.canBuy);
}

function showActions(canBuy) {
  const buyE = $('buy-e');
  if (buyE) buyE.innerHTML = isBuyFree(tc.state.game, tc.state.topCard)
    ? '<span class="pos">0⚡</span>'
    : '<span class="neg">−' + deriveBuyCost(tc.state.game) + '⚡</span>';
  $('btn-discard').classList.remove('hidden');
  $('btn-buy').classList.toggle('hidden', !canBuy);
  $('btn-discard').onclick = () => submitDecision('discard');
  $('btn-buy').onclick = () => submitDecision('buy');
}

function flyDirection(card, action) {
  if (card.arrow === 'up') return 'up';
  if (card.arrow === 'down') return 'down';
  return action === 'discard' ? 'left' : 'right';
}

async function submitDecision(action) {
  if (busy) return;
  busy = true;
  const card = tc.state.topCard;
  const interceptor = findInterceptor(tc.state.game, card);
  const dir = (interceptor && !tc.state.instant) ? 'intercept' : flyDirection(card, action);
  $('center-card').classList.add('fly-' + dir);
  await wait(420);
  const progressed = await tc.decide(action);
  busy = false;
  if (interceptor && !tc.state.instant) {
    const ownerEl = $('home-cards').querySelector('[data-name="' + interceptor.name + '"]');
    if (ownerEl) {
      ownerEl.classList.add('intercept-owner');
      setTimeout(() => ownerEl.classList.remove('intercept-owner'), 900);
    }
  }
  if (!progressed) enableDecisionUI(tc.state.topCard);
}

// ---------------------------------------------------------------------------
// Свайп
// ---------------------------------------------------------------------------
function disableSwipe() {
  disableGesture($('center-card'));
}

// ---------------------------------------------------------------------------
// Оверлеи выбора — реализация инъектированного promptChoice контроллера
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// ChoiceOverlay — единый оверлей выбора (заменяет 3 дублирующихся функции)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ChoiceOverlayOptions
 * @property {string} title
 * @property {Card[]} items
 * @property {'select'|'reorder'} [mode='select']
 * @property {'compact'|'detail'|'strip'} [variant='compact']
 */

/**
 * Показать оверлей выбора.
 * - mode 'select'  → resolve(выбранный элемент) или null, если items пуст
 * - mode 'reorder' → resolve(упорядоченный массив выбранных)
 * @param {ChoiceOverlayOptions} o
 * @returns {Promise<any>}
 */
function ChoiceOverlay(o) {
  return new Promise((resolve) => {
    const ov = $('choice-overlay');
    const list = $('choice-cards');
    const title = $('choice-title');
    const variant = o.variant || 'compact';

    if (o.mode === 'reorder') {
      const working = o.items.slice();
      const ordered = [];
      const draw = () => {
        list.innerHTML = '';
        if (working.length === 0) { ov.classList.add('hidden'); resolve(ordered); return; }
        title.textContent = o.title;
        for (const c of working) {
          const el = CardView(c, { variant, interactive: 'click', onClick: () => {
            ordered.push(c);
            working.splice(working.indexOf(c), 1);
            draw();
          } });
          list.appendChild(el);
        }
        ov.classList.remove('hidden');
      };
      draw();
      return;
    }

    if (o.items.length === 0) { resolve(null); return; }
    title.textContent = o.title;
    list.innerHTML = '';
    for (const item of o.items) {
      const el = CardView(item, { variant, interactive: 'click', onClick: () => {
        ov.classList.add('hidden');
        resolve(item);
      } });
      list.appendChild(el);
    }
    ov.classList.remove('hidden');
  });
}

async function promptChoiceAdapter(payload) {
  if (payload.kind === 'threats') {
    const items = payload.items || tc.state.game.threat.slice();
    return new Promise((res) => enterBoardTarget(items, res, payload.source || null));
  }
  if (payload.kind === 'persons') {
    const match = payload.match || {};
    const items = tc.state.game.home.filter((c) => matches(tc.state.game, c, match));
    return new Promise((res) => enterBoardTarget(items, res, null));
  }
  if (payload.kind === 'reorder') {
    const n = Math.min(payload.count || 0, tc.state.game.deck.length);
    if (n < 1) return [];
    const working = tc.state.game.deck.slice(0, n);
    return ChoiceOverlay({ title: 'Расставь карты: выбери верхнюю', items: working, mode: 'reorder', variant: 'detail' });
  }
  if (payload.kind === 'interceptors') {
    const items = payload.items || [];
    return new Promise((res) => enterBoardTarget(items, res, null));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Оверлеи деталей/сброса
// ---------------------------------------------------------------------------
function openDetail(c, opts = {}) {
  const d = $('detail-card');
  d.innerHTML = '';
  d.appendChild(CardView(c, { variant: 'detail' }));
  if (c.attached && c.attached.length) {
    const sub = document.createElement('div');
    sub.className = 'card-desc';
    sub.style.marginTop = '8px';
    sub.textContent = 'Подложено: ' + c.attached.map((a) => a.name).join(', ');
    d.appendChild(sub);
  }

  const vp = c.vpEffective != null ? c.vpEffective : (c.vp || 0);
  let hintText = '';
  if (vp) hintText += 'ПО — победные очки. ';
  if (c.asleep) {
    const sleeper = (c.attached || []).find((a) => a.sleep);
    hintText += 'Спит: накрыт(а) картой «' + (sleeper ? sleeper.name : '?') + '».';
  }
  if (hintText) {
    const hint = document.createElement('div');
    hint.className = 'detail-hint';
    hint.textContent = hintText;
    d.appendChild(hint);
  }
  $('detail-overlay').classList.remove('hidden');

  const confirmBtn = $('detail-confirm');
  if (opts.onConfirm) {
    confirmBtn.textContent = opts.confirmLabel || 'Взять в Дом';
    confirmBtn.classList.remove('hidden');
    confirmBtn.onclick = () => {
      $('detail-overlay').classList.add('hidden');
      opts.onConfirm(c);
    };
  } else {
    confirmBtn.classList.add('hidden');
    confirmBtn.onclick = null;
  }
}

function openDiscard() {
  const grid = $('discard-cards');
  grid.innerHTML = '';
  const s = getState(tc.state.game);
  if (s.discard.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Сброс пуст.';
    grid.appendChild(p);
  }
  for (const c of s.discard) {
    const el = CardView(c, { variant: 'compact' });
    grid.appendChild(el);
  }
  $('discard-overlay').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Конец игры
// ---------------------------------------------------------------------------
function endGame() {
  setScreen('end');
  const won = tc.state.game.status === 'won';
  const s = getState(tc.state.game);
  $('end-emoji').textContent = won ? '🎉' : '🤢';
  $('end-title').textContent = won ? 'Победа!' : 'Поражение';
  $('end-score').textContent = 'Очки: ' + getScore(tc.state.game);
  $('end-sub').textContent = won
    ? 'Ура, твою вечеринку запомнят надолго!'
    : 'Лучше такое не вспоминать...';

  const table = $('end-table');
  table.innerHTML = '';
  if (won) {
    renderEndTable(table, 'Очки', deriveScoreBreakdown(tc.state.game), getScore(tc.state.game));
  } else {
    const rows = deriveThreatBreakdown(tc.state.game).map((r) => ({ card: r.card, value: r.weight }));
    renderEndTable(table, 'Угроза', rows, deriveThreatCount(tc.state.game));
  }
}

function renderEndTable(container, valLabel, rows, total) {
  if (rows.length === 0) return;
  const table = document.createElement('table');
  table.className = 'end-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Карта</th><th class="num">' + valLabel + '</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    const tdC = document.createElement('td');
    if (r.card) {
      tdC.appendChild(CardView(r.card, { variant: 'compact' }));
    } else {
      tdC.textContent = r.label || '';
      tdC.classList.add('end-row-label');
    }
    const tdV = document.createElement('td');
    tdV.className = 'num';
    tdV.textContent = r.value;
    tr.appendChild(tdC);
    tr.appendChild(tdV);
    tbody.appendChild(tr);
  }
  const tr = document.createElement('tr');
  tr.className = 'end-table-total';
  tr.innerHTML = '<td>Итого</td><td class="num">' + total + '</td>';
  tbody.appendChild(tr);
  table.appendChild(tbody);
  container.appendChild(table);
}

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------
function newGame() {
  logEntries = [];
  busy = false;
  deckTotal = null;
  autoTimer = null;
  tc.newSession(buildDeck());
  goPrep();
}

// ---------------------------------------------------------------------------
// Привязка событий
// ---------------------------------------------------------------------------
tc = createTurnController({ render, log: pushLog, promptChoice: promptChoiceAdapter });

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
