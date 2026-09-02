// Convivium — описание карт как данных + DSL эффектов.
// Движок (engine.js) интерпретирует примитивы; новые карты не требуют правок движка.
//
// Поля карты:
//   name, icon?, face?, tags?, vp?, arrow?: 'up'|'down', threat?: false,
//   attach?: { match, bonusVp }, cost?: '🔄', description?,
//   effects?: [ { when?, op, ... } ]   // when: 'enter'|'turnStart'|'turnEnd' (derive-опы учитываются всегда)
//   activate?: [ { op, if?, ... } ]    // для 🔄 (cost)
//
// Угроза определяется движком: arrow==='up' && threat!==false.
// icon — эмодзи-заглушка (если нет face).
// face — путь к картинке персонажа (перекрывает icon).

const cards = [
  {
    name: 'Обход',
    icon: '🚪',
    description: '⚡ Если в конце хода в зоне угрозы есть 3 Угрозы, то ПРОИГРЫШ',
    arrow: 'up',
    threat: false,
    loseIf: { threatsCount: 3 },
  },
  {
    name: 'Комната 402',
    icon: '🚪',
    description: '❗️ Сбрось Порванную струну; прочие Угрозы (кроме Обхода) замешиваются в колоду взакрытую.',
    tags: ['place'],
    effects: [
      { when: 'enter', op: 'discardTarget', filter: { name: 'Порванная струна' } },
      { when: 'enter', op: 'replace', match: { tags: ['place'] }, in: 'home' },
      { when: 'enter', op: 'shuffleThreats' },
    ],
  },
  {
    name: 'Дворик',
    icon: '🏡',
    description: '❗️ Сбрось Шум; прочие Угрозы (кроме Обхода) замешиваются в колоду взакрытую.',
    tags: ['place'],
    effects: [
      { when: 'enter', op: 'discardTarget', filter: { name: 'Шум' } },
      { when: 'enter', op: 'replace', match: { tags: ['place'] }, in: 'home' },
      { when: 'enter', op: 'shuffleThreats' },
    ],
  },
  {
    name: 'Ваня',
    face: 'faces/face_vanya.jpg',
    description: '',
    tags: ['guitarist', 'man'],
    vp: 1,
  },
  {
    name: 'Шура',
    face: 'faces/face_shurik.jpg',
    description: '',
    tags: ['guitarist', 'man'],
    vp: 1,
    effects: [
      { when: 'enter', op: 'replace', match: { name: 'Шура: бухой' }, in: 'home' },
    ],
  },
  {
    name: 'Шура: бухой',
    face: 'faces/face_shurik.jpg',
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
    icon: '🔧',
    description: 'Теперь гитаристы расцениваются в 0 ПО',
    arrow: 'up',
    effects: [{ op: 'modifyVp', match: { tags: ['guitarist'] }, value: 0 }],
  },
  {
    name: 'Натянуть струну',
    icon: '🎸',
    description: 'Если в игре есть гитарист, то сбрось Порванную струну',
    cost: '🔄',
    activate: [
      { op: 'discardTarget', filter: { name: 'Порванная струна' }, if: { tags: ['guitarist'] } },
    ],
  },
  {
    name: 'Шум',
    icon: '📢',
    arrow: 'up',
  },
  {
    name: 'Звёздный час',
    icon: '🌟',
    description: '❗️ Подложи под любого человека. Если нет людей, то уходит в сброс. В конце игры приносит 1 ПО. Если под гитариста — ещё +1 ПО',
    attach: { match: { person: true }, bonusVp: 1, bonusIfTag: 'guitarist', choose: true },
    vp: 1,
  },
  {
    name: 'Паша',
    face: 'faces/face_pavel.jpg',
    tags: ['man'],
    effects: [
      { when: 'enter', op: 'replace', match: { name: 'Паша: бухой' }, in: 'home' },
    ],
  },
  {
    name: 'Плов',
    icon: '🍚',
    description: 'Если Паша в игре, то можно купить бесплатно',
    vp: 1,
    effects: [{ op: 'buyFreeIf', match: { name: 'Паша' } }],
  },
  {
    name: 'Паша: бухой',
    face: 'faces/face_pavel.jpg',
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
    icon: '💢',
    description: 'Если в игре Паша: бухой, то -1 ПО',
    arrow: 'up',
    effects: [{ op: 'addVp', match: { name: 'Паша: бухой' }, amount: -1, if: { name: 'Паша: бухой' } }],
  },
  {
    name: 'День рождения!',
    icon: '🎂',
    description: '',
    arrow: 'up',
    vp: 2,
  },
  {
    name: 'Кровать',
    icon: '🛏️',
    description: "❗️ При входе в игру накрывает самого левого человека. Он теперь \"спит\"",
    sleep: true,
    arrow: 'down',
    attach: { match: { person: true } },
  },
  {
    name: 'Палёный алкоголь',
    icon: '🥃',
    description:
      '⚡ Каждый ход перед взятием карты, положи взакрытую 1 карту с верха колоды под эту. Если накопится 3 или Палёный алкоголь устранят, сбрось также и все накопленные карты',
    arrow: 'up',
    effects: [{ when: 'turnStart', op: 'accumulate', max: 3 }],
  },
  {
    name: 'Грязь',
    icon: '🤢',
    description: 'Покупка новых карт теперь стоит 3 энергии (вместо 2)',
    arrow: 'up',
    effects: [{ op: 'addBuyCost', amount: 1 }],
  },
  {
    name: 'Оля',
    face: 'faces/face_olya.jpg',
    tags: ['woman'],
    description: '⚡ Ловит следующую карту и кладёт её под себя открыто — её эффект не срабатывает. Если под ней пусто, ловит любую. +1 ПО за каждого мужчину под ней.',
    effects: [
      { op: 'intercept', match: {} },
      { op: 'scorePerAttached', match: { tags: ['man'] }, amount: 1 },
    ],
  },
  {
    name: 'Денис',
    face: 'faces/face_den.jpg',
    tags: ['man'],
    description: '⚡ Если под ним пусто — следующая открытая угроза или авто-карта уходит под него, её эффект пропускается.',
    effects: [{ op: 'intercept' }],
  },
  {
    name: '3-й сосед',
    face: 'faces/face_vova.jpg',
    tags: ['man'],
    description: '❗️ Если в Доме уже есть Стол — при вскрытии сбрось Стол и себя.',
    effects: [
      { op: 'discardWith', match: { name: 'Стол' }, in: 'home' },
    ],
  },
  {
    name: 'Стол',
    icon: '🍽️',
    description: '⚡ Пока в Доме: при вскрытии Угрозы или авто-карты получи 1 энергию.',
    effects: [
      { op: 'energyOnReveal', amount: 1 },
    ],
  },
  {
    name: 'Старшекур',
    icon: '🧓',
    description: 'Сбрось выбранную карту Угрозы',
    cost: '🔄',
    tags: ['man'],
    activate: [{ op: 'discardTarget', filter: { zone: 'threat' } }],
  },
  {
    name: 'Массовый перекур',
    icon: '🚬',
    description: 'Посмотри 3 карты с верха колоды, а затем положи в удобном порядке обратно',
    cost: '🔄',
    activate: [{ op: 'peekReorder', count: 3 }],
  },
  {
    name: 'Тост',
    icon: '🥂',
    description: 'Получи дополнительные 1 ПО, если День рождения! в игре',
    vp: 1,
    effects: [{ op: 'bonusVp', amount: 1, if: { name: 'День рождения!' } }],
  },
  {
    name: 'Большая вечеринка',
    icon: '🎉',
    description: 'В конце игры получи 1 ПО за каждого человека в игре',
    effects: [{ op: 'scorePerPerson', amount: 1 }],
  },
];

globalThis.cards = cards;
globalThis.TAG_ICON = { guitarist: '🎸', man: '👨', woman: '👩', place: '📍' };
