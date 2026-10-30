import { localDate, validDate } from '../data/model.js';
import { outfitWeatherForDate } from './outfit-weather.js';
import { OCCASIONS, recommendOutfits, STYLE_OPTIONS } from './stylist.js';

const composition = (ids) => [...ids].sort().join('|');
const unique = (values) => [...new Set(values)];

/** Calendar dates use local noon so daylight-saving changes never shift a day. */
export function weekDates(startDate) {
  if (!validDate(startDate)) throw new Error('Выберите корректную дату начала недели.');
  const [year, month, day] = startDate.split('-').map(Number);
  const dates = Array.from({ length: 7 }, (_, offset) =>
    localDate(new Date(year, month - 1, day + offset, 12)),
  );
  if (dates.some((date) => !validDate(date)))
    throw new Error('Все семь дней должны быть в пределах 1900–2200 годов.');
  return dates;
}

/** Pure, deterministic preview. Saving belongs to the provider's single transaction. */
export function buildWeekSuggestions({
  items = [],
  outfits = [],
  plans = [],
  startDate,
  slot = 'day',
  occasion = 'everyday',
  style = 'any',
  forecast = null,
  weatherMode = 'auto',
  manualWeather = null,
  today = localDate(),
} = {}) {
  const dates = weekDates(startDate);
  if (!validDate(today) || startDate < today)
    throw new Error('Начните планирование с сегодняшнего дня или более поздней даты.');
  if (!['day', 'evening'].includes(slot)) throw new Error('Выберите дневное или вечернее время.');
  if (!Object.hasOwn(OCCASIONS, occasion) || !Object.hasOwn(STYLE_OPTIONS, style))
    throw new Error('Выберите повод и стиль из списка.');
  if (!['auto', 'manual', 'none'].includes(weatherMode))
    throw new Error('Выберите способ учёта погоды.');
  if (weatherMode === 'manual' && !Number.isFinite(manualWeather?.feelsLike))
    throw new Error('Укажите ощущаемую температуру для ручного подбора.');
  const all = Array.isArray(items) ? items : [];
  const byId = new Map(all.map((item) => [item.id, item]));
  const usedOutfits = new Map();
  const usedItems = new Map();
  const warnings = [];
  const days = [];
  let previousKey = '';

  for (const date of dates) {
    const occupied = plans.find((plan) => plan.date === date && plan.slot === slot);
    if (occupied) {
      days.push({
        date,
        slot,
        status: 'occupied',
        existingPlan: occupied,
        reason: 'Здесь уже есть план. Он останется без изменений.',
      });
      previousKey = '';
      continue;
    }
    const weather =
      weatherMode === 'manual'
        ? { ...manualWeather }
        : weatherMode === 'auto'
          ? outfitWeatherForDate(forecast, date, today)
          : null;
    const unknownWeather =
      weatherMode === 'auto' && (!weather || !Object.values(weather).some(Number.isFinite));
    const candidates = new Map();
    const reasons = [];
    for (let variant = 0; variant < 4; variant++) {
      const result = recommendOutfits(all, { occasion, style, weather, variant, limit: 3 });
      reasons.push(...result.warnings);
      for (const [rank, candidate] of result.outfits.entries()) {
        // Keep this guard even when a future recommendation engine changes its output.
        if (
          !candidate.itemIds.length ||
          candidate.missingItems?.length ||
          candidate.itemIds.some((id) => byId.get(id)?.available !== true)
        )
          continue;
        const key = composition(candidate.itemIds);
        const quality = rank + variant * 0.15;
        if (!candidates.has(key) || candidates.get(key).quality > quality)
          candidates.set(key, { ...candidate, key, quality });
      }
    }
    const ranked = [...candidates.values()]
      .map((candidate) => ({
        ...candidate,
        penalty:
          (usedOutfits.get(candidate.key) || 0) * 18 +
          (candidate.key === previousKey ? 8 : 0) +
          candidate.itemIds.reduce((sum, id) => sum + (usedItems.get(id) || 0), 0) * 0.8 +
          candidate.quality,
      }))
      .sort((a, b) => a.penalty - b.penalty || a.key.localeCompare(b.key));
    const selected = ranked[0];
    const weatherNote = unknownWeather
      ? 'На эту дату нет прогноза: погода не проверена.'
      : weatherMode === 'none'
        ? 'Подбор без проверки погоды.'
        : weatherMode === 'manual'
          ? 'Для всех дней использованы введённые вами условия.'
          : 'Учтён доступный прогноз на эту дату.';
    if (!selected) {
      days.push({
        date,
        slot,
        status: 'unavailable',
        weather,
        weatherNote,
        reason: unique(reasons).join(' ') || 'Не хватает доступных вещей для полного образа.',
      });
      previousKey = '';
      continue;
    }
    const saved = outfits.find(
      (outfit) =>
        composition(outfit.itemIds || []) === selected.key &&
        !outfit.missingItems?.length &&
        outfit.occasion === occasion &&
        (outfit.style || '') === (style === 'any' ? '' : style) &&
        !outfit.season,
    );
    const repeated = usedOutfits.has(selected.key);
    const outfit = {
      name: saved?.name || `${OCCASIONS[occasion]} · ${date.slice(8)}.${date.slice(5, 7)}`,
      description: selected.description || '',
      itemIds: [...selected.itemIds],
      occasion,
      style: style === 'any' ? '' : style,
      season: '',
      missingItems: [],
    };
    const proposal = { date, slot, outfitId: saved?.id || '', outfit };
    const explanation = repeated
      ? 'Повторяем комплект: разнообразие ограничено доступными вещами.'
      : 'Стараемся менять сочетания и реже повторять одни и те же вещи.';
    days.push({
      date,
      slot,
      status: 'suggested',
      proposal,
      weather,
      weatherNote,
      explanation,
      warnings: unique(selected.warnings || []),
    });
    usedOutfits.set(selected.key, (usedOutfits.get(selected.key) || 0) + 1);
    for (const id of selected.itemIds) usedItems.set(id, (usedItems.get(id) || 0) + 1);
    previousKey = selected.key;
  }
  const proposals = days.filter((day) => day.proposal).map((day) => day.proposal);
  if (days.some((day) => day.weatherNote?.startsWith('На эту дату')))
    warnings.push('Для части дней прогноз недоступен. Эти предложения не проверены по погоде.');
  if (usedOutfits.size < proposals.length)
    warnings.push(
      'Некоторые образы повторяются: семи разных подходящих сочетаний пока не найдено.',
    );
  if (weatherMode === 'manual')
    warnings.push('Ручные условия одинаковы для всех семи дней и не являются прогнозом.');
  return { days, proposals, warnings, uniqueOutfits: usedOutfits.size };
}
