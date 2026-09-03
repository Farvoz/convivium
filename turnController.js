// Классический скрипт (работает и с file://). Чистый автомат фаз соло-партии.
// Владеет логическим состоянием хода и переходами; вызывает чистые функции
// движка. Отображение, анимации и тайминги (DOM) остаются в UI-слое (app.js),
// который общается с контроллером через инъектированные колбэки render/log/promptChoice.
(function () {
  const {
    createGame, setup, runTurnStart, getTopCard, resolveTop, activate: engineActivate,
    deriveAsleepSet, derivePeekCount, isBuyFree, deriveBuyCost, matches, deriveThreatCount, findInterceptors,
    discardWithTarget,
  } = globalThis.Convivium;

  function createTurnController({ render, log, promptChoice }) {
    const state = {
      phase: 'prep',        // 'prep' | 'take' | 'activate' | 'reveal' | 'decide' | 'transition' | 'gameover'
      topCard: null,
      canBuy: false,
      activatable: new Set(),
      game: null,
    };

    function collectActivatable() {
      const asleep = deriveAsleepSet(state.game);
      return [...state.game.home, ...state.game.threat]
        .filter((c) => {
          if (c.cost !== '🔄' || asleep.has(c)) return false;
          const hasPlay = (c.activate || []).some((e) => e.op === 'playFromDiscard');
          if (hasPlay) {
            const f = (c.activate || []).find((e) => e.op === 'playFromDiscard').filter || {};
            const pool = state.game.discard.filter((x) => matches(state.game, x, f));
            if (pool.length === 0) return false;
          }
          return true;
        })
        .map((c) => c.name);
    }

    function logResolve(card, action) {
      if (card.arrow === 'up') log('Угроза: ' + card.name);
      else if (card.arrow === 'down') log(card.name + ' → Дом');
      else if (action === 'discard') log('Сброс: ' + card.name + ' (+1⚡)');
      else {
        const cost = deriveBuyCost(state.game);
        log((isBuyFree(state.game, card) ? 'Куплено (бесплатно): ' : 'Куплено: ') +
          card.name + (isBuyFree(state.game, card) ? '' : ` (−${cost}⚡)`));
      }
    }

    function newSession(deck) {
      state.game = createGame({ deck });
      state.phase = 'prep';
      state.topCard = null;
      state.canBuy = false;
      state.activatable = new Set();
      render();
    }

    async function choosePrep(name) {
      state.game = await setup(state.game, {
        choose: (opts) => opts.find((c) => c.name === name) || opts[0],
      });
      const placed = state.game.home[0];
      log((placed ? 'В Доме: ' : 'Сброс: ') + name);
      state.phase = 'take';
      render();
      await startTurn();
    }

    async function startTurn() {
      if (state.game.status !== 'playing') { state.phase = 'gameover'; render(); return; }
      state.game = runTurnStart(state.game);
      render();
      if (state.game.deck.length === 0) { state.game.status = 'won'; state.phase = 'gameover'; render(); return; }

      const act = collectActivatable();
      if (act.length > 0) {
        state.phase = 'activate';
        state.activatable = new Set(act);
        log('Фаза активации: примени эффекты 🔄 или бери карту');
      } else {
        state.phase = 'take';
        state.activatable = new Set();
      }
      render();
    }

    function take() {
      if (state.phase !== 'take' && state.phase !== 'activate') return null;
      state.topCard = getTopCard(state.game);   // peek, без мутации колоды
      state.phase = 'reveal';
      render();
      return state.topCard;
    }

    function assess() {
      const card = state.topCard;
      const intercepted = findInterceptors(state.game, card).length > 0;
      const instant = !!(card && (card.effects || []).some((e) => e.op === 'discardWith') && discardWithTarget(state.game, card));
      state.canBuy = state.game.energy >= deriveBuyCost(state.game) || isBuyFree(state.game, card);
      state.instant = instant;
      return { arrow: !!(card && card.arrow), canBuy: state.canBuy, intercepted, instant };
    }

    async function decide(action) {
      if (state.phase !== 'reveal') return false;
      const card = state.topCard;
      const dw = discardWithTarget(state.game, card);
      if (dw) {
        // Мгновенный эффект связки: Стол + эта карта уходят в сброс, выбор
        // игрока не требуется (и перехват не применяется).
        state.game = resolveTop(state.game, null);
        log('❗️ ' + card.name + ' и ' + dw.name + ' сброшены (Стол в Доме)');
        state.phase = 'transition';
        render();
        if (state.game.status !== 'playing') { state.phase = 'gameover'; render(); return true; }
        await startTurn();
        return true;
      }
      if (action === 'buy' && card.attach && card.attach.choose) {
        const pool = state.game.home.filter((c) => matches(state.game, c, state.topCard.attach.match));
        if (pool.length > 1) {
          const chosen = await promptChoice({ kind: 'persons', match: state.topCard.attach.match });
          if (chosen === null) return;
          state.game.choose = () => chosen;
        }
      }
      const interceptors = findInterceptors(state.game, state.topCard);
      if (interceptors.length > 1) {
        const chosen = await promptChoice({ kind: 'interceptors', items: interceptors });
        if (chosen === null) return;
        state.game.choose = () => chosen;
      }
      state.game = resolveTop(state.game, action);
      state.game.choose = (opts) => opts[0];
      logResolve(state.topCard, action);
      state.phase = 'transition';
      render();
      if (state.game.status !== 'playing') { state.phase = 'gameover'; render(); return true; }
      await startTurn();
      return true;
    }

    async function activate(name) {
      if (state.phase !== 'activate') return;
      const card = [...state.game.home, ...state.game.threat]
        .find((c) => c.name === name && c.cost === '🔄');
      if (!card) return;
      if (deriveAsleepSet(state.game).has(card)) return;

      const needsPlay = (card.activate || []).some((e) => e.op === 'playFromDiscard');
      const needsTarget = (card.activate || []).some((e) => e.op === 'discardTarget');
      const needsReorder = (card.activate || []).some((e) => e.op === 'peekReorder');
      let chosen = null;
      if (needsPlay) {
        const op = (card.activate || []).find((e) => e.op === 'playFromDiscard');
        const pool = state.game.discard.filter((c) => matches(state.game, c, op.filter || {}));
        if (pool.length === 0) {
          log('Нет мест в сбросе — активация отменена');
          return;
        }
        if (pool.length === 1) {
          state.game.choose = (opts) => opts.find((c) => c.name === pool[0].name) || opts[0];
        } else {
          const picked = await promptChoice({ kind: 'discardPlace', items: pool });
          if (picked === null) return;
          state.game.choose = (opts) => opts.find((c) => c.name === picked.name) || opts[0];
        }
      }
      if (needsTarget) {
        const dt = (card.activate || []).find((e) => e.op === 'discardTarget');
        const targetPool = dt
          ? state.game.threat.filter((c) => c.threat !== false && matches(state.game, c, dt.filter || {}, 'threat'))
          : [];
        if (targetPool.length === 0) {
          log('Нечего сбросить — активация отменена');
          return;
        }
        chosen = await promptChoice({ kind: 'threats', items: targetPool, source: card.name });
        if (chosen === null) return;
          // chosen — объект из доне-клонового state.game; движок клонирует игру,
          // поэтому матчим по имени внутри уже склонированного пула, иначе
          // removeFromZone не находит карту по ссылке и сброс не происходит.
          state.game.choose = (opts) => opts.find((c) => c.name === chosen.name) || opts[0];
      }
      if (needsReorder) {
        const op = (card.activate || []).find((e) => e.op === 'peekReorder');
        const n = derivePeekCount(state.game, op.count);
        const items = state.game.deck.slice(0, n);
        const ordered = await promptChoice({ kind: 'reorder', count: n, items });
        // reorder обязан вернуть ровно n карт; иначе не меняем порядок колоды.
        if (Array.isArray(ordered) && ordered.length === n) {
          state.game.reorder = (top) => ordered;
        }
      }
      const before = state.game;
      state.game = engineActivate(state.game, name);
      if (state.game === before) return;
      state.game.choose = (opts) => opts[0];
      state.game.reorder = (top) => top;
      log('Активировано: ' + name);
      if (state.game.status !== 'playing') {
        state.phase = 'gameover';
        render();
        return;
      }
      if (collectActivatable().length === 0) {
        state.phase = 'take';
      }
      render();
    }

    return { state, newSession, choosePrep, startTurn, take, assess, decide, activate };
  }

  globalThis.Convivium.createTurnController = createTurnController;
})();
