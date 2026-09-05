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
    description: '❗️ Нейтрализует Порванную струну (вес = 0); прочие Угрозы замешиваются в колоду',
    tags: ['place'],
    effects: [
      { op: 'threatWeightSet', match: { name: 'Порванная струна' }, value: 0 },
      { when: 'enter', op: 'replace', match: { tags: ['place'] }, in: 'home' },
      { when: 'enter', op: 'shuffleThreats' },
    ],
  },
  {
    name: 'Дворик',
    icon: '🏡',
    description: '❗️ Нейтрализует Шум (вес = 0); прочие Угрозы замешиваются в колоду',
    tags: ['place'],
    effects: [
      { op: 'threatWeightSet', match: { name: 'Шум' }, value: 0 },
      { when: 'enter', op: 'replace', match: { tags: ['place'] }, in: 'home' },
      { when: 'enter', op: 'shuffleThreats' },
    ],
  },
  {
    name: 'Ваня',
    face: 'faces/face_vanya.jpg',
    description: '🔄 Достань Звёздный час из сброса (2⚡, остаётся в Доме)',
    tags: ['guitarist', 'man'],
    vp: 1,
    cost: '🔄',
    costType: 'energy',
    activate: [{ op: 'retrieveFromDiscard', filter: { name: 'Звёздный час' }, energycost: 2 }],
  },
  {
    name: 'Шура',
    face: 'faces/face_shurik.jpg',
    description: '🔄 Достань Звёздный час из сброса (1⚡, остаётся в Доме)',
    tags: ['guitarist', 'man'],
    vp: 1,
    cost: '🔄',
    costType: 'energy',
    effects: [
      { when: 'enter', op: 'replace', match: { name: 'Шура: бухой' }, in: 'home' },
    ],
    activate: [{ op: 'retrieveFromDiscard', filter: { name: 'Звёздный час' }, energycost: 1 }],
  },
  {
    name: 'Шура: бухой',
    face: 'faces/face_shurik.jpg',
    description: '❗️ Заменяет Шуру, если он в игре. Теперь Шум расценивается в 2 Угрозы',
    tags: ['man', 'drunk'],
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
    description: '🔄 Если в игре есть гитарист, то сбрось Порванную струну',
    cost: '🔄',
    activate: [
      { op: 'discardTarget', filter: { name: 'Порванная струна' }, if: { tags: ['guitarist'] } },
    ],
  },
  {
    name: 'Внимание',
    icon: '👁️',
    description: '❗️ Подложи под любую карту в Доме. Защищает от негативных карт. Уходит в сброс вместе с владельцем.',
    attach: { match: {}, blocks: ['replace', 'attach'] },
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
    description: 'Если Паша в игре, то можно купить бесплатно. ❗️ Замешай 1 Угрозу в колоду',
    vp: 2,
    effects: [
      { op: 'buyFreeIf', match: { name: 'Паша' } },
      { when: 'enter', op: 'pullReserve' },
    ],
  },
  {
    name: 'Паша: бухой',
    face: 'faces/face_pavel.jpg',
    description: '❗️ Заменяет Пашу, если он в игре. А также замешай 1 карту Угрозы взакрытую',
    tags: ['man', 'drunk'],
    arrow: 'down',
    effects: [
      { when: 'enter', op: 'replace', match: { name: 'Паша' }, in: 'home' },
      { when: 'enter', op: 'pullReserve' },
    ],
  },
  {
    name: 'Конфликт',
    icon: '💢',
    description: 'Если в игре есть «бухой», то -1 ПО за каждого',
    arrow: 'up',
    effects: [{ op: 'addVp', match: { tags: ['drunk'] }, amount: -1 }],
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
    name: 'Слухи',
    icon: '🗣️',
    description: '⚡ Если под ней пусто — следующая открытая угроза или авто-карта уходит под неё, её эффект пропускается.',
    effects: [{ op: 'intercept' }],
  },
  {
    name: 'Вася',
    face: 'faces/face_vasya.jpg',
    tags: ['man'],
    cost: '🔄',
    description: '🔄 Найти в сбросе место и разыграть',
    activate: [{ op: 'playFromDiscard', filter: { tags: ['place'] } }],
  },
  {
    name: 'Вова',
    face: 'faces/face_vova.jpg',
    tags: ['man'],
    description: '⚡ Пока в Доме: при вскрытии Угрозы или авто-карты получи 1 энергию.',
    effects: [
      { op: 'energyOnReveal', amount: 1 },
    ],
  },
  {
    name: 'Старшекур',
    icon: '🧓',
    description: '🔄 Сбрось выбранную карту Угрозы или авто-карту из Дома',
    cost: '🔄',
    tags: ['man'],
    activate: [{ op: 'discardTarget', filter: {}, zone: 'both' }],
  },
  {
    name: 'Денис',
    face: 'faces/face_den.jpg',
    tags: ['man'],
    description: '⚡ Приглашать людей дешевле на 1⚡ (мин. 1⚡)',
    effects: [{ op: 'addBuyCost', amount: -1, match: { person: true } }],
  },
  {
    name: 'Пронести алкашку',
    icon: '🍶',
    description: 'Старшекур теперь сбрасывает выбранную карту за 1⚡ (вместо сброса себя)',
    vp: 1,
    effects: [{ op: 'modifyActivate', match: { name: 'Старшекур' }, cost: 'energy', energycost: 1 }],
  },
  {
    name: 'Массовый перекур',
    icon: '🚬',
    description: '🔄 Посмотри столько карт с верха колоды, сколько людей в игре, а затем положи в удобном порядке обратно',
    cost: '🔄',
    activate: [{ op: 'peekReorder', count: 'people' }],
  },
  {
    name: 'Тост',
    icon: '🥂',
    description: '❗️ Открой 3 верхние карты колоды и бесплатно разыграй каждую (Угроза → Угроза, остальное → Дом). Эффекты применяются последовательно',
    discardValue: 0,
    effects: [{ when: 'enter', op: 'revealAndPlay', count: 3 }],
  },
  {
    name: 'Хит!',
    icon: '🥊',
    description: '🥊 Сбросить за 0⚡. Или взять в Дом бесплатно (2 ПО), но если наверху колоды Угроза — мгновенный проигрыш.',
    vp: 2,
    discardValue: 0,
    effects: [{ op: 'buyFreeIf', match: { name: 'Хит!' } }],
    loseIf: { nextIsThreat: true },
  },
  {
    name: 'Большая вечеринка',
    icon: '🎉',
    description: 'В конце игры получи 1 ПО за каждого человека в игре',
    effects: [{ op: 'scorePerPerson', amount: 1 }],
  },
  {
    name: 'Уютная вечеринка',
    icon: '🛋️',
    description: '2 ПО, если в Доме нет Угроз. Если есть — −1 ПО за каждую Угрозу.',
    effects: [
      { op: 'bonusVp', amount: 2, if: { threatsCount: 0 } },
      { op: 'scorePerThreat', amount: -1 },
    ],
  },
  {
    name: 'Байки',
    icon: '📖',
    description: '⚡ Каждая сброшенная Угроза или авто-карта уходит под эту карту. В конце +1 ПО за каждую карту под ней.',
    effects: [{ op: 'scorePerTucked', amount: 1 }],
  },
  {
    name: 'Договориться',
    icon: '🤝',
    description: '❗️ Сбросьте угрозу или автокарту на выбор',
    effects: [
      { when: 'enter', op: 'discardTarget', zone: 'both', filter: { arrow: { $in: ['up', 'down'] } } },
    ],
  },
  {
    name: 'Отвлечь',
    icon: '🎭',
    description: '🔄 Если в игре есть «Обход», замешайте его обратно в колоду лицом вниз',
    cost: '🔄',
    costType: 'discard',
    activate: [{ op: 'returnToDeck', from: 'threat', match: { name: 'Обход' } }],
  },
];

globalThis.cards = cards;
globalThis.TAG_ICON = { guitarist: '🎸', man: '👨', woman: '👩', place: '📍' };
