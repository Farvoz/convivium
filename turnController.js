// Классический скрипт (работает и с file://). Чистый автомат фаз соло-партии.
// Владеет логическим состоянием хода и переходами; вызывает чистые функции
// движка. Отображение, анимации и тайминги (DOM) остаются в UI-слое (app.js),
// который общается с контроллером через инъектированные колбэки render/log/promptChoice.
(function () {
  const {
    createGame, setup, runTurnStart, getTopCard, resolveTop, activate: engineActivate,
    derivePeekCount, isBuyFree, deriveBuyCost, matches, findInterceptors,
    discardWithTarget, canActivate, getDiscardPool, getDiscardTargetPool, getBuyLabel,
  } = globalThis.Convivium;

  function createTurnController({ render, log, promptChoice }) {
    const state = {
      phase: 'prep',        // 'prep' | 'take' | 'activate' | 'reveal' | 'decide' | 'transition' | 'gameover'
      topCard: null,
      canBuy: false,
      activatable: new Set(),
      game: null,
      pendingEvents: [], // универсальная очередь анимаций (engine pendingEvents → UI)
    };

    // Проигрывает очередь событий последовательно (универсально для любой карты, не только Тост)
    async function drainEvents(animator) {
      while (state.pendingEvents.length) {
        const ev = state.pendingEvents.shift();
        if (ev.type === 'place') {
          if (ev.zone === 'threat') log('Угроза: ' + ev.card.name);
          else if (ev.zone === 'home') {
            if (ev.via === 'revealAndPlay') log('❗️ Тост → ' + ev.card.name + ' → Дом');
            else log(ev.card.name + ' → Дом');
          }
        } else if (ev.type === 'discard') {
          const gain = ev.gain ? ' (+1⚡)' : ' (0⚡)';
          log('Сброс: ' + ev.card.name + gain);
        } else if (ev.type === 'intercepted') {
          log('🤚 ' + ev.card.name + ' перехвачена' + (ev.owner ? ' (' + ev.owner + ')' : ''));
        } else if (ev.type === 'consumed') {
          log('❗️ ' + ev.card.name + ' сброшена взаимно');
        }
        if (animator) await animator(ev);
        render();
      }
    }

    function collectActivatable() {
      return [...state.game.home, ...state.game.threat]
        .filter((c) => canActivate(state.game, c))
        .map((c) => c.name);
    }

    function logResolve(card, action) {
      if (card.arrow === 'up') log('Угроза: ' + card.name);
      else if (card.arrow === 'down') log(card.name + ' → Дом');
      else if (action === 'discard') {
        const v = card.discardValue === 0 ? 0 : 1;
        log('Сброс: ' + card.name + (v ? ' (+1⚡)' : ' (0⚡)'));
      } else {
        const lbl = getBuyLabel(state.game, card);
        log((lbl.free ? 'Куплено (бесплатно): ' : 'Куплено: ') + card.name + (lbl.free ? '' : ` (−${lbl.cost}⚡)`));
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
        state.pendingEvents = [...(state.game.pendingEvents || [])];
        state.game.pendingEvents = [];
        state.phase = 'transition';
        render();
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
      // универсальная очередь: engine.pendingEvents → turnController.pendingEvents
      state.pendingEvents = [...(state.game.pendingEvents || [])];
      state.game.pendingEvents = [];
      state.phase = 'transition';
      render();
      return true;
    }

    async function activate(name) {
      if (state.phase !== 'activate') return;
      const card = [...state.game.home, ...state.game.threat]
        .find((c) => c.name === name && c.cost === '🔄');
      if (!card) return;
      if (!canActivate(state.game, card)) {
        const hasDiscardPool = (card.activate || []).some((e) => e.op === 'playFromDiscard' || e.op === 'retrieveFromDiscard');
        if (hasDiscardPool) log('Нечего достать — активация отменена');
        else log('Нечего сбросить — активация отменена');
        return;
      }

      let opPlay = null, opTarget = null, opReorder = null;
      for (const e of card.activate || []) {
        if (!opPlay && e.op === 'playFromDiscard') opPlay = e;
        else if (!opTarget && e.op === 'discardTarget') opTarget = e;
        else if (!opReorder && e.op === 'peekReorder') opReorder = e;
      }
      let chosen = null;
      if (opPlay) {
        const pool = getDiscardPool(state.game, opPlay.filter || {});
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
      if (opTarget) {
        const targetPool = getDiscardTargetPool(state.game, card, opTarget.filter || {}, opTarget.zone || 'threat');
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
      if (opReorder) {
        const n = derivePeekCount(state.game, opReorder.count);
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
      if (card.activate && card.activate.some((e) => e.op === 'returnToDeck')) {
        log('↩️ Обход замешан обратно в колоду');
      }
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

    return { state, newSession, choosePrep, startTurn, take, assess, decide, activate, drainEvents };
  }

  globalThis.Convivium.createTurnController = createTurnController;
})();
