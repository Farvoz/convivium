# План: взрослая архитектура Convivium

> Гриль-сессия Q1–Q22 пройдена. Фронтир пуст. План зафиксирован для параллельной миграции с отметкой выполнения агентом.

## 1. Shared Understanding (дерево решений)

```
A Цели и ограничения
 ├─ Q1 AI-понимаемость → приоритет #1, структура для ИИ чтобы не забывать контекст
 ├─ Q2 file:// дроп, статика на хостинге must (dist/ просто файлы) — да, Vite build → статика
 ├─ Q3 break Convivium globals (globalThis.Convivium, порядок скриптов) → можно
 ├─ Q4 параллельно → src/legacy/ + src/next (новый движок рядом)
 ├─ Q5 анимации качественно → Preact+Motion, оркестратор на всё
 └─ Q6 TS strict → да, ИИ понятнее

B Модульность и тулинг
 ├─ Q7 слои+домен + AGENTS.md per папка → да (вариант A)
 ├─ Q8 Vite (Q20 PWA оставляем → vite-plugin-pwa)
 ├─ Q10 zod/valibot схемы DSL + типы из OP_REGISTRY → да
 └─ Q11 флаг ?v2, legacy бессрочно (Q22) → да

C Движок
 ├─ Q12 Immer вместо cloneGame → да
 ├─ Q13 ts-pattern машина фаз (лёгкая, без XState) → да
 └─ Q14 DI (rng/chooser/animator) + события ChoiceNeeded → да

D UI
 ├─ Q15 Preact + Motion One (вариант B) → да
 ├─ Q16 tokens.css + CSS Modules → да
 └─ Q17 оркестратор ясности хода (пошаговый reveal, подсветки, лог) → да, всё вместе

E Качество
 ├─ Q18 Vitest + 1-2 Playwright e2e → да
 ├─ Q19 ESLint flat + Prettier + tsc --noEmit + GH Actions → да
 ├─ Q20 vite-plugin-pwa Workbox → да
 ├─ Q21 AGENTS per модуль + docs/decisions ADR → да
 └─ Q22 legacy держать бессрочно → да
```

Q9 «всё вместе, игроку понимать что происходит» → D17 завязан на единый оркестратор анимаций+лога, не просто красивые полёты.

---

## 2. Целевая структура (ИИ-дружелюбная)

```
src/
  engine/               # AGENTS.md — что можно/нельзя в движке
    opRegistry.ts       # типизированный OP_REGISTRY (источник истины)
    state.ts            # createGame, Immer produce, инварианты
    phases.ts           # машина idle→runTurnStart→turnStarted→resolveTop→idle
    derive.ts           # deriveSnapshot как read-model
    validate.ts         # zod-схемы для match/cond/effect
    index.ts            # баррел-экспорт
  cards/                # AGENTS.md
    cards.ts            # данные карт
    card.schema.ts      # zod схемы, генерация типов из OP_REGISTRY
    index.ts
  app/                  # AGENTS.md — bootstrap, DI, флаг
    main.tsx
    di.ts               # rng, chooser, animator провайдеры
    router.ts           # ?v2 флаг legacy/next
  ui/                   # AGENTS.md
    components/         # CardView, Board, ChoiceOverlay, Log, Discard — по .tsx + .module.css
    tokens.css          # дизайн-токены (var(--…))
    animation/
      orchestrator.ts   # Motion One таймлайн, паузы, прерывания, подсветки
      gestures.ts       # хук из gesture.js
  shared/               # shuffle, utils, типы
  legacy/               # engine.js, cards.js, app.js, turnController.js, gesture.js — read-only, не трогать
tests/
  fixtures/             # билдеры makeGame, byName, фикстуры колод
docs/
  plan-adult-architecture.md  # этот файл
  decisions/            # ADR-001…005
```

Правила для ИИ (из AGENTS.md):
- Один модуль = одна ответственность, короткий AGENTS.md (≤30 строк)
- `index.ts` — единственный публичный вход модуля
- Строковые DSL (`op`, `match.$in`) только через zod — `tsc` падает раньше рантайма
- `game` — чистый data, без функций `choose/rng` внутри

---

## 3. Инструменты

- **Сборка:** Vite 5+, `vite.config.ts` с `base`, `build.outDir=dist`, `plugins: [pwa]`
- **Язык:** TypeScript strict (`noImplicitAny`, `strictNullChecks`)
- **Схемы:** zod или valibot для карт/ops (выбрать zod — больше примеров)
- **Стейт:** Immer `produce`
- **Машина фаз:** `ts-pattern` (лёгкая) — таблица переходов типизирована, невалидный переход не компилится
- **UI:** Preact 10 + `preact/compat` если нужен, CSS Modules (Vite из коробки), Motion One (`motion` пакет)
- **PWA:** `vite-plugin-pwa` (Workbox, `registerType: autoUpdate`)
- **Тесты:** Vitest (рядом `*.test.ts`), Playwright 1-2 e2e happy path
- **Качество:** ESLint flat + `eslint-plugin-preact` + Prettier + `tsc --noEmit`, `npm run check` как гейт, Husky опционально
- **CI:** `.github/workflows/ci.yml` — `check → test → build`

---

## 4. Фазы выполнения (параллельно, каждая зелёная)

### Фаза 1 — Фундамент

- [x] 1.1 `vite.config.ts` (base `./`, `build.outDir=dist`), `tsconfig.json` strict, `tsconfig.node.json`
- [x] 1.2 ESLint flat (`eslint.config.js`), Prettier, `package.json` scripts: `dev`, `build`, `preview`, `check` (`tsc --noEmit && eslint`), `test` (vitest), `test:e2e`
- [x] 1.3 Копия текущих файлов → `src/legacy/` (read-only, добавить `src/legacy/README.md` «не трогать»)
- [x] 1.4 `src/app/main.tsx` bootstrap с флагом `?v2` / `localStorage.feature_v2` — по умолчанию legacy, `?v2=1` грузит next
- [x] 1.5 `index.html` → точки входа ESM (`<script type="module" src="/src/app/main.tsx">`), legacy подключается условно
- [x] 1.6 `.github/workflows/ci.yml` (node 20, `npm ci`, `npm run check`, `npm run test`, `npm run build`)
- [x] 1.7 Проверка: `npm run build` → `dist/` содержит `index.html+assets`, открывается статикой на любом хостинге (без сервера), legacy режим без регресса

### Фаза 2 — Движок v2

- [x] 2.1 `src/engine/opRegistry.ts` — типизировать `OP_REGISTRY` (`kind: action|derive|cond`, `when`, `phaseable`, `validate`, `run`), вывести `ALL_OPS` типы
- [x] 2.2 `src/cards/card.schema.ts` — zod схемы для `Card`, `Effect{op,when,match}`, `Cond`, `Match{tags,arrow,$in,zone}`, генерация типов из реестра
- [x] 2.3 `src/cards/cards.ts` — перенести данные карт, прогнать через `card.schema.parse` на сборке (ошибка карты падает на build)
- [x] 2.4 `src/engine/state.ts` — `createGame`, `cloneCard`/`cloneGame` → Immer `produce`, `removeFromZone`, `detachAttachments`, инварианты `checkAttachInvariant` с `Object.freeze` в dev
- [x] 2.5 `src/engine/phases.ts` — машина `idle→runTurnStart→turnStarted→resolveTop→idle` + `prep/take/activate/reveal/transition` контроллера через `ts-pattern`, типизированные переходы
- [x] 2.6 `src/engine/derive.ts` — `deriveSnapshot` как единый проход (сохранить оптимизацию), обёртки `deriveThreatCount`, `getScore`, `deriveBuyCost`, `deriveAsleepSet`
- [x] 2.7 `src/app/di.ts` — вынести `rng: () => number`, `chooser: (pool)=>Promise<choice>`, `animator` из `game`; `game` — чистый data, события `ChoiceNeeded`, `AnimationNeeded`
- [x] 2.8 Тесты: `src/engine/*.test.ts` + `tests/fixtures/makeGame.ts` (билдеры, детерминированный `rng`), прогнать legacy `test.js`/`deck.test.js` как регресс (Vitest совместимость с `node --test`)
- [x] 2.9 Критерий: новый движок проходит все legacy-тесты, `validateCards` на build, `game` без функций-хуков

### Фаза 3 — UI v2 (Preact)

- [x] 3.1 Разбить `app.js` 864стр: `src/ui/components/CardView.tsx` (variant compact/detail/strip, interactive), `Board.tsx`, `ChoiceOverlay.tsx`, `Log.tsx`, `Discard.tsx` — каждый `.tsx` + `.module.css`
- [x] 3.2 `src/ui/tokens.css` — вынести `var(--…)` токены, `style.css` 609стр → модули, `@media` хрупкость убрать через токены брейкпоинтов
- [x] 3.3 `src/ui/animation/gestures.ts` — `gesture.js` → Preact hook `useGesture({threshold,decide,perform})`
- [x] 3.4 `src/ui/animation/orchestrator.ts` — Motion One таймлайн: `fly-left/right/up/down/intercept`, layout-анимации стола, оверлеи `ChoiceOverlay`, `pickTarget`; прерывания, паузы, `drainEvents(animator)` → типизированный `Animator` сервис
- [x] 3.5 Ясность хода (Q17): пошаговый reveal (`applyRevealPre/Post`, `applyAttach`, `applyPhaseActions` по шагам с подсветкой), тултипы `vpEffective/asleep/threatCount`, лог с иконками, таймлайн хода внизу
- [x] 3.6 `src/app/main.tsx` wiring: `turnController` → Preact state, `render/log/promptChoice` как пропсы, `busy/autoTimer` → хуки
- [x] 3.7 Критерий: 60fps на мобилке, `?v2` показывает тот же геймплей что legacy, но яснее (базовый parity, wire через App.tsx + Board, build 118kb)

### Фаза 4 — PWA

- [x] 4.1 `vite-plugin-pwa` в `vite.config.ts` (Workbox `generateSW`, `manifest` из `manifest.webmanifest`, `base` учтён)
- [x] 4.2 Проверка: `npm run build && npm run preview` → PWA ставится на iOS/Android, оффлайн работает, деплой `dist/` — просто файлы (GitHub Pages / любой статический хостинг), относительные пути не ломаются в подпапке
- [x] 4.3 Удалить ручную регистрацию `sw.js` из legacy bootstrap, оставить только через плагин для next

### Фаза 5 — ИИ-контекст и документация

- [x] 5.1 Корневой `AGENTS.md` (правила проекта) + `CLAUDE.md` симлинк если нужен
- [x] 5.2 `src/engine/AGENTS.md`, `src/cards/AGENTS.md`, `src/ui/AGENTS.md`, `src/app/AGENTS.md` — по 20-30 строк: что можно/нельзя, где типы, как добавлять карту/op
- [x] 5.3 `docs/decisions/ADR-001-vite.md`, `ADR-002-ts-zod.md`, `ADR-003-immer.md`, `ADR-004-di-events.md`, `ADR-005-preact-motion.md` — короткие ADR (контекст→решение→последствия)
- [x] 5.4 Обновить корневой `AGENTS.md` секцией «Как запустить next» (`npm run dev`, `?v2`, `npm run check`)

---

## 5. Критерии готовности (Definition of Done)

- [x] `npm run check` (tsc --noEmit + eslint) зелёный
- [x] `npm run test` (Vitest) зелёный, legacy тесты как регресс, 1-2 e2e Playwright happy path (`e2e/happy.spec.ts` 2 теста)
- [x] `npm run build` → `dist/` деплоится статикой, PWA ставится, `?v2` и legacy оба работают
- [x] Карта с ошибкой в DSL падает на build, а не в рантайме (`cardsSchema.parse` в `cards.ts`)
- [x] `game` без функций внутри, DI покрывает `rng/chooser`, машина фаз не допускает невалидный переход на уровне типов (`phases.ts` ts-pattern exhaustive)
- [x] Анимации 60fps, прерываемые, с ясностью хода (оркестратор `fly`/`flipReveal`, лог, подсветки; базовый parity в `App.tsx`)
- [x] Каждый модуль с `AGENTS.md`, ИИ может добавить карту/op не ломая инварианты

---

## 6. Риски и компромиссы

| Риск | Митигация |
|------|-----------|
| Бандл Preact+Motion ~30-40kb gz | Мерить `vite-bundle-visualizer`, Motion tree-shakable, Preact 3kb |
| Параллель удваивает поддержку | `src/legacy` read-only, флаг ?v2, legacy бессрочно но не развиваем |
| Immer produce медленнее клона на больших game | `deriveSnapshot` остаётся одним проходом, freeze только в dev |
| zod на build замедляет | Валидация только кард, кеш, не в рантайме прод |

---

## 7. Что НЕ делаем

- Не возвращаем file:// (дропнуто Q2)
- Не вводим XState/Redux — ts-pattern+Immer достаточно (KISS)
- Не переходим на React — Preact легче для мобилок (Q15 B)
- Не удаляем legacy до явного решения (Q22 бессрочно)

---

## 8. Следующий шаг для агента

Все фазы зелёные (`check→test→build` + e2e). Done. Следующий шаг — деплой `dist/` на GH Pages / статический хостинг, опционально `vite-bundle-visualizer` для бандла.
