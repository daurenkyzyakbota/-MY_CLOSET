import { CATEGORIES, COLORS, SEASONS, uid } from '../data/model.js';
import {
  OCCASIONS,
  STYLE_OPTIONS,
  recommendOutfits,
  recommendationEligibility,
} from './stylist.js';

const unique = (values) => [...new Set(values)];
const PLACEHOLDER_NAMES = {
  top: 'Базовый верх',
  bottom: 'Брюки или юбка',
  dress: 'Платье',
  shoes: 'Обувь',
  outerwear: 'Верхняя одежда',
  accessory: 'Аксессуар',
};

/** A user's budget is a preference, never a retailer's price. */
export function shoppingDraftFromMissing(missing, overrides = {}) {
  return {
    id: uid(),
    name: missing.name || PLACEHOLDER_NAMES[missing.category] || '',
    category: missing.category,
    colors: Array.isArray(missing.colors) ? [...missing.colors] : [],
    season: missing.season || '',
    style: missing.style || '',
    size: missing.size || '',
    budget: null,
    notes: missing.reason || '',
    status: 'planned',
    itemId: '',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Verified retailer searches, not product pages, inventory or prices. */
export function createStoreSearchLinks(draft) {
  let query = '';
  if (draft && typeof draft === 'object') {
    const name =
      typeof draft.name === 'string' && draft.name.trim()
        ? draft.name
        : CATEGORIES[draft.category] || '';
    const colors = Array.isArray(draft.colors)
      ? draft.colors.map((color) => COLORS[color]?.[0] || '').filter(Boolean)
      : [];
    const style =
      typeof draft.style === 'string' && draft.style !== 'any'
        ? STYLE_OPTIONS[draft.style] || draft.style
        : '';
    const size = typeof draft.size === 'string' ? draft.size : '';
    query = [name, ...colors, style, size].filter(Boolean).join(' ');
  }
  query = query.replace(/\s+/gu, ' ').trim().slice(0, 160);
  if (!query) return [];
  return [
    { id: 'kaspi', name: 'Kaspi.kz', base: 'https://kaspi.kz/shop/search/', param: 'text' },
    {
      id: 'lamoda',
      name: 'Lamoda.kz',
      base: 'https://www.lamoda.kz/catalogsearch/result/',
      param: 'q',
    },
  ].map((store) => {
    const url = new URL(store.base);
    url.searchParams.set(store.param, query);
    return { id: store.id, name: store.name, url: url.href };
  });
}

function missingDraft(category, selected, options, conditions) {
  const ownedColors = unique(selected.flatMap((item) => item.colors || []));
  const neutral = ownedColors.find((color) =>
    ['white', 'black', 'gray', 'beige', 'brown'].includes(color),
  );
  const colors = neutral ? [neutral] : [];
  const reasonParts = [
    `Категории «${CATEGORIES[category]}» нет в вашем гардеробе; она нужна, чтобы дополнить этот комплект.`,
  ];
  if (category === 'outerwear' && conditions.temperature !== null && conditions.temperature < 14)
    reasonParts.push('Для указанной прохлады нужна подходящая тёплая верхняя одежда.');
  if (conditions.rain >= 60 && ['shoes', 'outerwear'].includes(category))
    reasonParts.push('Выбирайте модель с подтверждённой защитой от дождя.');
  if (neutral) reasonParts.push('Нейтральный оттенок предложен по цветам имеющихся вещей.');
  return {
    id: uid(),
    name: PLACEHOLDER_NAMES[category],
    category,
    colors,
    season: options.season || '',
    style: options.style && options.style !== 'any' ? options.style : '',
    size: '',
    reason: reasonParts.join(' '),
  };
}

function blockedMessage(category, rejected) {
  const related = rejected.filter((entry) => entry.item.category === category);
  const messages = [];
  if (related.some((entry) => entry.reason === 'unavailable'))
    messages.push(
      `Категория «${CATEGORIES[category]}» уже есть, но вещь недоступна или в стирке. Дождитесь её возвращения или измените доступность; покупка не требуется автоматически.`,
    );
  if (related.some((entry) => entry.reason === 'season'))
    messages.push(
      `Категория «${CATEGORIES[category]}» уже есть, но не подходит выбранному сезону. Проверьте характеристики или измените сезон.`,
    );
  if (related.some((entry) => entry.reason === 'weather'))
    messages.push(
      `Категория «${CATEGORIES[category]}» уже есть, но не подходит заданной погоде. Проверьте характеристики или измените условия; эта категория не отмечена как отсутствующая.`,
    );
  return messages;
}

/** Incomplete proposals stay separate from wearable outfits and contain at least one owned item. */
export function buildMissingRecommendations(items, options = {}, fullResult) {
  const full = fullResult || recommendOutfits(items, options);
  if (full.outfits?.length) return { outfits: [], warnings: [] };
  if (options.season && !Object.hasOwn(SEASONS, options.season))
    return {
      outfits: [],
      warnings: ['Выберите сезон из списка, чтобы определить недостающие вещи.'],
    };
  const owned = (Array.isArray(items) ? items : []).filter(
    (item) =>
      item &&
      typeof item.id === 'string' &&
      typeof item.category === 'string' &&
      Object.hasOwn(CATEGORIES, item.category),
  );
  if (!owned.length)
    return {
      outfits: [],
      warnings: [
        'Сначала добавьте хотя бы одну свою вещь: рекомендации дополняют ваш гардероб, а не создают выдуманный комплект.',
      ],
    };
  const eligibility = recommendationEligibility(owned, options);
  const eligible = eligibility.items;
  const conditions = eligibility.conditions;
  const anchorItemId = options.anchorItemId || '';
  const anchor = anchorItemId ? owned.find((item) => item.id === anchorItemId) : null;
  if (anchorItemId && (!anchor || !eligible.some((item) => item.id === anchorItemId)))
    return {
      outfits: [],
      warnings: unique([
        ...(full.warnings || []),
        'Выбранная вещь не подходит текущим условиям. Измените выбор или условия; недостающие вещи не заменяют выбранную вещь.',
      ]),
    };
  if (!eligible.length)
    return {
      outfits: [],
      warnings: unique([
        ...eligibility.warnings,
        ...Object.keys(CATEGORIES).flatMap((category) =>
          blockedMessage(category, eligibility.rejected),
        ),
        'Нет доступных вещей для основы рекомендации. Проверьте стирку, сезон и погоду.',
      ]),
    };
  const cold = conditions.temperature !== null && conditions.temperature < 14;
  const basePaths =
    anchor?.category === 'dress'
      ? [['dress', 'shoes']]
      : anchor && ['top', 'bottom'].includes(anchor.category)
        ? [['top', 'bottom', 'shoes']]
        : [
            ['dress', 'shoes'],
            ['top', 'bottom', 'shoes'],
          ];
  const requiredPaths = basePaths.map((base) => [
    ...base,
    ...(cold || anchor?.category === 'outerwear' ? ['outerwear'] : []),
  ]);
  const actualGapCount = (path) =>
    path.filter((category) => !owned.some((item) => item.category === category)).length;
  const minimumGapCount = Math.min(...requiredPaths.map(actualGapCount));
  const warnings = [...eligibility.warnings];
  const candidates = [];
  const requestedStyle = STYLE_OPTIONS[options.style] || '';
  const score = (item) =>
    (item.favorite ? 1 : 0) +
    (requestedStyle &&
    `${item.style || ''} ${item.name || ''}`
      .toLocaleLowerCase('ru')
      .includes(requestedStyle.toLocaleLowerCase('ru'))
      ? 2
      : 0);
  const choices = (category) => {
    if (anchor?.category === category) return [anchor];
    return eligible
      .filter((item) => item.category === category)
      .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
      .slice(0, 3);
  };
  // A temporary mismatch in an already owned base must not prompt buying an alternative dress.
  for (const required of requiredPaths.filter((path) => actualGapCount(path) === minimumGapCount)) {
    const missingCategories = [];
    const pools = [];
    let blocked = false;
    for (const category of required) {
      const available = choices(category);
      if (available.length) pools.push(available);
      else if (owned.some((item) => item.category === category)) {
        warnings.push(...blockedMessage(category, eligibility.rejected));
        blocked = true;
      } else missingCategories.push(category);
    }
    if (blocked || !missingCategories.length) continue;
    let combinations = [[]];
    for (const pool of pools)
      combinations = combinations
        .flatMap((selected) => pool.map((item) => [...selected, item]))
        .slice(0, 24);
    for (let selected of combinations) {
      const accessory = anchor?.category === 'accessory' ? anchor : choices('accessory')[0];
      if (accessory) selected = [...selected, accessory];
      if (!selected.length || (anchorItemId && !selected.some((item) => item.id === anchorItemId)))
        continue;
      const missingItems = missingCategories.map((category) =>
        missingDraft(category, selected, options, conditions),
      );
      const outfitWarnings = [
        'Это неполный образ: недостающие вещи показаны отдельно и не принадлежат вам. До покупки или замены комплект не готов.',
      ];
      if (!conditions.supplied)
        outfitWarnings.push('Погода не выбрана: комплект не проверен для выхода на улицу.');
      if (
        selected.some(
          (item) => item.category !== 'accessory' && (!item.warmth || item.warmth === 'unknown'),
        )
      )
        outfitWarnings.push(
          'Теплота части имеющихся вещей не указана: соответствие погоде не подтверждено.',
        );
      if (
        selected.some(
          (item) =>
            ['shoes', 'outerwear'].includes(item.category) &&
            (!item.rainproof || item.rainproof === 'unknown'),
        )
      )
        outfitWarnings.push('Защита имеющейся обуви или верхней одежды от дождя неизвестна.');
      const occasion = Object.hasOwn(OCCASIONS, options.occasion) ? options.occasion : 'everyday';
      candidates.push({
        itemIds: selected.map((item) => item.id),
        title: `Идея: ${OCCASIONS[occasion].toLocaleLowerCase('ru')}`,
        description:
          'Идея образа из ваших вещей с отдельными рекомендациями недостающих категорий. Это план дополнения гардероба, а не готовый комплект.',
        reasons: [
          'Сначала проверены полные комплекты из доступных вещей: подходящий вариант не найден.',
          'Покупка предложена только для категорий, которых совсем нет в вашем гардеробе.',
          'Сезон, палитру и характеристики новой вещи проверьте перед покупкой.',
        ],
        warnings: outfitWarnings,
        missingItems,
        complete: false,
        _score: selected.reduce((sum, item) => sum + score(item), 0),
      });
    }
  }
  const signatures = new Set();
  candidates.sort(
    (a, b) =>
      a.missingItems.length - b.missingItems.length ||
      b.itemIds.length - a.itemIds.length ||
      b._score - a._score ||
      a.itemIds.join('|').localeCompare(b.itemIds.join('|')),
  );
  const distinct = candidates.filter((candidate) => {
    const signature =
      candidate.itemIds.slice().sort().join('|') +
      '::' +
      candidate.missingItems
        .map((item) => item.category)
        .sort()
        .join('|');
    if (signatures.has(signature)) return false;
    signatures.add(signature);
    return true;
  });
  const limit = Number.isInteger(options.limit) ? Math.max(0, Math.min(3, options.limit)) : 3;
  const variant = Number.isInteger(options.variant) ? Math.max(0, options.variant) : 0;
  const offset = distinct.length ? variant % distinct.length : 0;
  const outfits = [...distinct.slice(offset), ...distinct.slice(0, offset)]
    .slice(0, limit)
    .map(({ _score, ...outfit }) => outfit);
  if (!outfits.length)
    warnings.push(
      'Для текущих условий нельзя предложить дополнение без замены уже имеющихся вещей. Проверьте доступность, сезон и погодные характеристики или используйте ручной конструктор.',
    );
  return { outfits, warnings: unique(warnings) };
}
