import { CATEGORIES, COLORS, SEASONS } from '../data/model.js';
import { OCCASIONS, STYLE_OPTIONS } from './stylist.js';

const unique = (values) => [...new Set(values)];
const palette = (value) =>
  unique(
    (Array.isArray(value) ? value : []).filter((color) => Object.hasOwn(COLORS, color)),
  ).sort();
const cleanText = (value, maximum) =>
  typeof value === 'string'
    ? value
        .trim()
        .slice(0, maximum)
        .replace(/[\uD800-\uDBFF]$/, '')
    : '';

function colorFit(source, owned) {
  if (!source.length)
    return {
      status: 'unspecified',
      weight: 1000,
      explanation: 'Категория совпадает; цвет в публикации не указан.',
    };
  if (!owned.length)
    return {
      status: 'unknown',
      weight: 0,
      explanation: 'Категория совпадает; цвет вашей вещи не указан.',
    };
  const common = source.filter((color) => owned.includes(color)).length;
  if (common === source.length && common === owned.length)
    return {
      status: 'exact',
      weight: 20000,
      explanation: 'Совпадают категория и набор цветовых групп.',
    };
  if (common)
    return {
      status: 'partial',
      weight: 10000 + Math.round((common / unique([...source, ...owned]).length) * 1000),
      explanation: 'Категория совпадает; совпала часть цветовых групп.',
    };
  return {
    status: 'different',
    weight: 0,
    explanation: 'Категория совпадает, цвет отличается от публикации.',
  };
}

// Rectangular Hungarian assignment: choose the best overall palette without
// using one owned garment twice. Dummy columns represent honest missing pieces.
function bestAssignment(weights) {
  const count = weights.length;
  if (!count) return [];
  const columns = weights[0].length;
  const u = Array(count + 1).fill(0);
  const v = Array(columns + 1).fill(0);
  const matched = Array(columns + 1).fill(0);
  const previous = Array(columns + 1).fill(0);
  for (let row = 1; row <= count; row++) {
    matched[0] = row;
    let column = 0;
    const distances = Array(columns + 1).fill(Infinity);
    const visited = Array(columns + 1).fill(false);
    do {
      visited[column] = true;
      const activeRow = matched[column];
      let delta = Infinity;
      let next = 0;
      for (let candidate = 1; candidate <= columns; candidate++) {
        if (visited[candidate]) continue;
        const cost = -weights[activeRow - 1][candidate - 1] - u[activeRow] - v[candidate];
        if (cost < distances[candidate]) {
          distances[candidate] = cost;
          previous[candidate] = column;
        }
        if (distances[candidate] < delta) {
          delta = distances[candidate];
          next = candidate;
        }
      }
      for (let candidate = 0; candidate <= columns; candidate++) {
        if (visited[candidate]) {
          u[matched[candidate]] += delta;
          v[candidate] -= delta;
        } else distances[candidate] -= delta;
      }
      column = next;
    } while (matched[column]);
    do {
      const next = previous[column];
      matched[column] = matched[next];
      column = next;
    } while (column);
  }
  const result = Array(count).fill(-1);
  for (let column = 1; column <= columns; column++) {
    if (matched[column]) result[matched[column] - 1] = column - 1;
  }
  return result;
}

function sourceItems(snapshot) {
  if (
    !snapshot ||
    !Array.isArray(snapshot.items) ||
    !snapshot.items.length ||
    snapshot.items.length > 30
  )
    throw new Error('В публикации нет подходящего состава образа.');
  return snapshot.items.map((item, index) => {
    if (!item || !Object.hasOwn(CATEGORIES, item.category) || !cleanText(item.name, 100))
      throw new Error('В публикации есть неизвестная категория или вещь без названия.');
    return {
      index,
      name: cleanText(item.name, 100),
      category: item.category,
      colors: palette(item.colors),
    };
  });
}

function ownedItems(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id ||
      seen.has(item.id) ||
      !Object.hasOwn(CATEGORIES, item.category)
    )
      return false;
    seen.add(item.id);
    return true;
  });
}

/** A local draft containing only owned IDs and new missing-piece descriptions. */
export function matchPublishedOutfit(snapshot, items, { title, selectedIndexes } = {}) {
  const sources = sourceItems(snapshot);
  const selected =
    selectedIndexes === undefined ? sources.map((source) => source.index) : selectedIndexes;
  if (
    !Array.isArray(selected) ||
    new Set(selected).size !== selected.length ||
    selected.some((index) => !Number.isInteger(index) || index < 0 || index >= sources.length)
  )
    throw new Error('Выберите детали публикации заново.');
  const chosen = sources.filter((source) => selected.includes(source.index));
  const owned = ownedItems(items);
  const available = owned
    .filter((item) => item.available === true)
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const matches = new Map();
  for (const category of Object.keys(CATEGORIES)) {
    const wanted = chosen.filter((source) => source.category === category);
    if (!wanted.length) continue;
    const candidates = available.filter((item) => item.category === category);
    const scores = wanted.map((source) => [
      ...candidates.map(
        (item) =>
          100000 + colorFit(source.colors, palette(item.colors)).weight + (item.favorite ? 1 : 0),
      ),
      ...wanted.map(() => 0),
    ]);
    const assignment = bestAssignment(scores);
    wanted.forEach((source, row) => {
      const garment = candidates[assignment[row]] || null;
      if (garment) {
        const fit = colorFit(source.colors, palette(garment.colors));
        matches.set(source.index, {
          source,
          item: garment,
          colorStatus: fit.status,
          explanation: fit.explanation,
        });
      } else {
        const sameCategory = owned.filter((item) => item.category === category);
        const explanation = candidates.length
          ? 'Доступные вещи этой категории уже выбраны для других деталей.'
          : sameCategory.length
            ? 'Ваши вещи этой категории сейчас в стирке или недоступны.'
            : `В гардеробе нет вещи категории «${CATEGORIES[category]}».`;
        matches.set(source.index, { source, item: null, colorStatus: 'missing', explanation });
      }
    });
  }
  const rows = chosen.map((source) => matches.get(source.index));
  const found = rows.filter((row) => row.item);
  const missing = rows.filter((row) => !row.item);
  const approximate = found.filter((row) =>
    ['partial', 'different', 'unknown'].includes(row.colorStatus),
  );
  const warnings = [];
  if (!chosen.length) warnings.push('Выберите хотя бы одну деталь образа.');
  if (!available.length)
    warnings.push(
      owned.length
        ? 'Сейчас нет доступных вещей. Верните их из стирки или добавьте новые.'
        : 'Добавьте свои вещи в гардероб, чтобы подобрать похожее сочетание.',
    );
  else if (!found.length)
    warnings.push(
      'Среди доступных вещей нет нужных категорий. Подберите вещи вручную в гардеробе.',
    );
  if (approximate.length)
    warnings.push(
      'Некоторые цвета отличаются или указаны не полностью. Сравните вещи перед сохранением.',
    );
  if (missing.length > 10)
    warnings.push(
      'В одном черновике можно оставить до 10 недостающих деталей. Снимите лишние отметки; состав не сокращается автоматически.',
    );
  const occasion = Object.hasOwn(OCCASIONS, snapshot.occasion) ? snapshot.occasion : 'everyday';
  const style =
    Object.hasOwn(STYLE_OPTIONS, snapshot.style) && snapshot.style !== 'any' ? snapshot.style : '';
  const season = Object.hasOwn(SEASONS, snapshot.season) ? snapshot.season : '';
  if (snapshot.occasion && !Object.hasOwn(OCCASIONS, snapshot.occasion))
    warnings.push('Повод публикации нестандартный. Проверьте повод в конструкторе.');
  if (snapshot.style && !style)
    warnings.push(
      'Выберите подходящий стиль в конструкторе: стиль публикации не входит в стандартный список.',
    );
  const canCreate = found.length > 0 && missing.length <= 10 && rows.length <= 30;
  let draft = null;
  if (canCreate) {
    const usedIds = new Set(owned.map((item) => item.id));
    const missingItems = missing.map((row) => {
      const base = `inspired-missing-${row.source.index + 1}`;
      let missingId = base;
      let suffix = 1;
      while (usedIds.has(missingId)) missingId = `${base}-${suffix++}`;
      usedIds.add(missingId);
      return {
        id: missingId,
        name: row.source.name,
        category: row.source.category,
        colors: [...row.source.colors],
        season,
        style,
        size: '',
        reason: row.explanation,
      };
    });
    const reference = cleanText(title || snapshot.name, 100) || 'Образ из сообщества';
    draft = {
      name: cleanText(`По мотивам: ${reference}`, 100),
      itemIds: found.map((row) => row.item.id),
      missingItems,
      occasion,
      style,
      season,
      description:
        `Вдохновлено публикацией «${reference}». Подбор по категориям и цветовым группам из моего гардероба. Посадку, материалы и условия нужно проверить самостоятельно.`.slice(
          0,
          500,
        ),
      favorite: false,
    };
  }
  return {
    sources,
    matches: rows,
    matchedCount: found.length,
    missingCount: missing.length,
    approximateCount: approximate.length,
    selectedCount: chosen.length,
    availableCount: available.length,
    wardrobeCount: owned.length,
    canCreate,
    draft,
    warnings,
  };
}
