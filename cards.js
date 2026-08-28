// Convivium — описание карт как данных + DSL эффектов.
// Движок (engine.js) интерпретирует примитивы; новые карты не требуют правок движка.
//
// Поля карты:
//   name, tags?, vp?, arrow?: 'up'|'down', threat?: false,
//   attach?: { match, bonusVp }, cost?: '🔄', description?,
//   effects?: [ { when?, op, ... } ]   // when: 'enter'|'turnStart'|'turnEnd' (derive-опы учитываются всегда)
//   activate?: [ { op, if?, ... } ]    // для 🔄 (cost)
//
// Угроза определяется движком: arrow==='up' && threat!==false.

const cards = [
  {
    name: 'Обход',
    description: '⚡ Если в конце хода в зоне угрозы есть 3 Угрозы, то ПРОИГРЫШ',
    arrow: 'up',
    threat: false,
    loseIf: { threatsCount: 3 },
  },
  {
    name: 'Комната 402',
    description: '',
    tags: ['place'],
  },
  {
    name: 'Ваня',
    description: '',
    tags: ['guitarist', 'man'],
    vp: 1,
  },
  {
    name: 'Шура',
    description: '',
    tags: ['guitarist', 'man'],
    vp: 1,
    effects: [
      { when: 'enter', op: 'replace', match: { name: 'Шура: бухой' }, in: 'home' },
    ],
  },
  {
    name: 'Шура: бухой',
    description: '❗️ Заменяет Шуру, если он в игре. Теперь Шум расценивается в 2 Угрозы',
    tags: ['man'],
    arrow: 'down',
    effects: [
      { when: 'enter', op: 'replace', match: { name: 'Шура' }, in: 'home' },
    ],
    threatWeight: { match: { name: 'Шум' }, weight: 2 },
  },
  {
    name: 'Порванная струна',
    description: 'Теперь гитаристы расцениваются в 0 ПО',
    arrow: 'up',
    effects: [{ op: 'modifyVp', match: { tags: ['guitarist'] }, value: 0 }],
  },
  {
    name: 'Натянуть струну',
    description: 'Если в игре есть гитарист, то сбрось Порванную струну',
    cost: '🔄',
    activate: [
      { op: 'discardTarget', filter: { name: 'Порванная струна' }, if: { tags: ['guitarist'] } },
    ],
  },
  {
    name: 'Шум',
    arrow: 'up',
  },
  {
    name: 'Звёздный час',
    description: '❗️ Подложи под любого человека: +1 ПО. Если под гитариста — ещё +1 ПО. Если некого — в сброс.',
    attach: { match: { person: true }, bonusVp: 1, bonusIfTag: 'guitarist', choose: true },
    vp: 1,
  },
  {
    name: 'Паша',
    tags: ['man'],
    effects: [
      { when: 'enter', op: 'replace', match: { name: 'Паша: бухой' }, in: 'home' },
    ],
  },
  {
    name: 'Плов',
    description: 'Если Паша в игре, то можно купить бесплатно',
    vp: 1,
    effects: [{ op: 'buyFreeIf', match: { name: 'Паша' } }],
  },
  {
    name: 'Паша: бухой',
    description: '❗️ Заменяет Пашу, если он в игре. А также замешай 1 карту Угрозы взакрытую',
    tags: ['man'],
    arrow: 'down',
    effects: [
      { when: 'enter', op: 'replace', match: { name: 'Паша' }, in: 'home' },
      { when: 'enter', op: 'pullReserve' },
    ],
  },
  {
    name: 'Конфликт',
    description: 'Если в игре Паша: бухой, то -1 ПО',
    arrow: 'up',
    effects: [{ op: 'addVp', match: { name: 'Паша: бухой' }, amount: -1, if: { name: 'Паша: бухой' } }],
  },
  {
    name: 'День рождения!',
    description: '',
    arrow: 'up',
    vp: 2,
  },
  {
    name: 'Кровать',
    description: "❗️ При входе в игру накрывает самого левого человека. Он теперь \"спит\"",
    sleep: true,
    arrow: 'down',
    attach: { match: { person: true } },
  },
  {
    name: 'Палёный алкоголь',
    description:
      '⚡ Каждый ход перед взятием карты, положи взакрытую 1 карту с верха колоды под эту. Если накопится 3 или Палёный алкоголь устранят, сбрось также и все накопленные карты',
    arrow: 'up',
    effects: [{ when: 'turnStart', op: 'accumulate', max: 3 }],
  },
  {
    name: 'Грязь',
    description: 'Угроза. Покупка новых карт теперь стоит 3 энергии (вместо 2)',
    arrow: 'up',
    effects: [{ op: 'addBuyCost', amount: 1 }],
  },
  {
    name: 'Оля',
    tags: ['woman'],
  },
  {
    name: 'Денис',
    tags: ['man'],
  },
  {
    name: '3-й сосед',
    tags: ['man'],
  },
  {
    name: 'Старшекур',
    description: 'Сбрось выбранную карту Угрозы',
    cost: '🔄',
    tags: ['man'],
    activate: [{ op: 'discardTarget', filter: { zone: 'threat' } }],
  },
  {
    name: 'Массовый перекур',
    description: 'Посмотри 3 карты с верха колоды, а затем положи в удобном порядке обратно',
    cost: '🔄',
    activate: [{ op: 'peekReorder', count: 3 }],
  },
  {
    name: 'Тост',
    description: 'Получи дополнительные 1 ПО, если День рождения! в игре',
    vp: 1,
    effects: [{ op: 'bonusVp', amount: 1, if: { name: 'День рождения!' } }],
  },
  {
    name: 'Большая вечеринка',
    description: 'В конце игры получи 1 ПО за каждого человека в игре',
    effects: [{ op: 'scorePerPerson', amount: 1 }],
  },
];

globalThis.cards = cards;
