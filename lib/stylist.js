import { CATEGORIES, SEASONS } from './model.js';

export const OCCASIONS = { everyday: 'Повседневный выход', study: 'Учёба', work: 'Работа', date: 'Свидание', walk: 'Прогулка', party: 'Вечеринка', formal: 'Торжество', travel: 'Путешествие' };
export const STYLE_OPTIONS = { any: 'Любой стиль', classic: 'Классика', casual: 'Повседневный', sport: 'Спортивный', minimal: 'Минимализм', elegant: 'Элегантно', comfortable: 'Комфортно' };

const STYLE_WORDS = {
  classic: /класс|делов|офис|classic|formal|блейзер|пиджак|рубашк|лофер|брюк/iu,
  casual: /повседнев|casual|джинс|деним|футболк|кед/iu,
  sport: /спорт|sport|худи|толстов|кроссов|джоггер|леггин/iu,
  minimal: /минимал|базов|однотон|minimal|basic/iu,
  elegant: /элегант|наряд|вечер|elegant|шёлк|шелк|атлас|лодочк|каблук/iu,
  comfortable: /комфорт|удоб|свобод|comfortable|трикотаж|кед|кроссов|футболк|худи/iu
};
const OCCASION_STYLES = {
  everyday: ['casual','comfortable','minimal'], study: ['casual','comfortable','minimal','classic'],
  work: ['classic','minimal','elegant'], date: ['elegant','minimal','casual'],
  walk: ['comfortable','casual','sport'], party: ['elegant'], formal: ['classic','elegant'],
  travel: ['comfortable','casual','sport','minimal']
};
const NEUTRALS = new Set(['white','black','gray','beige','brown']);
const HUES = { red: 0, yellow: 60, green: 120, blue: 220, purple: 280, pink: 330 };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const unique = values => [...new Set(values)];
const warmth = item => item.warmth || 'unknown';
const rainproof = item => item.rainproof || 'unknown';

function palette(items) {
  const colors = unique(items.flatMap(item => Array.isArray(item.colors) ? item.colors : []));
  const accents = colors.filter(color => !NEUTRALS.has(color));
  const analogous = accents.length > 1 && !accents.includes('multicolor') && accents.every((a,i) => accents.slice(i+1).every(b => {
    const distance = Math.abs(HUES[a]-HUES[b]);
    return finite(distance) && Math.min(distance,360-distance) <= 75;
  }));
  return { score: accents.includes('multicolor') ? -2 : accents.length <= 1 ? 5 : analogous ? 3 : -4 * (accents.length-1), accents, analogous };
}

function weatherConditions(input, warnings) {
  if (!input || typeof input !== 'object') return { temperature: null, rain: null, wind: null, supplied: false };
  const temperature = finite(input.feelsLike) ? input.feelsLike : finite(input.temperature) ? input.temperature : null;
  const rain = finite(input.rainProbability) && input.rainProbability >= 0 && input.rainProbability <= 100 ? input.rainProbability : null;
  const wind = finite(input.windSpeed) && input.windSpeed >= 0 ? input.windSpeed : null;
  if (temperature === null) warnings.push('Ощущаемая температура не указана: теплота комплекта не проверяется.');
  if (rain === null) warnings.push('Вероятность дождя не указана: защита от осадков не проверяется.');
  if (wind === null) warnings.push('Скорость ветра не указана: ветер не учтён.');
  if (temperature !== null && temperature < 5) warnings.push('Холодно: проверьте дополнительные слои, головной убор и защиту рук. Тепловой комфорт индивидуален.');
  if (rain !== null && rain >= 60) warnings.push(`Вероятность осадков ${Math.round(rain)}%: понадобятся защита от дождя и подходящая обувь.`);
  if (wind !== null && wind >= 12) warnings.push(`Сильный ветер ${Math.round(wind)} м/с: проверьте ветрозащиту одежды; отдельной характеристики ветрозащиты пока нет.`);
  else if (wind !== null && wind >= 8) warnings.push('Ветрено: ощущение холода может усиливаться, проверьте защиту от ветра.');
  if (finite(input.tempMin) && finite(input.tempMax) && input.tempMax-input.tempMin >= 10) warnings.push('В течение дня большой перепад температур: перед выходом проверьте прогноз на нужное время.');
  return { temperature, rain, wind, supplied: true };
}

function unsuitable(item, conditions) {
  const temp = conditions.temperature;
  if (temp !== null) {
    if (temp >= 25 && (item.category === 'outerwear' || (warmth(item) === 'warm' && item.category !== 'accessory'))) return 'для указанной жары эта вещь слишком тёплая';
    if (temp >= 30 && warmth(item) === 'medium' && item.category !== 'accessory') return 'эта вещь отмечена для прохладной погоды';
    if (temp < 14 && item.category === 'outerwear' && warmth(item) === 'light') return 'лёгкая верхняя одежда не подходит для указанного холода';
    if (temp < 0 && item.category === 'outerwear' && warmth(item) === 'medium') return 'для мороза нужна тёплая верхняя одежда';
    if (temp < 5 && ['bottom','dress','shoes'].includes(item.category) && warmth(item) === 'light') return 'вещь отмечена как лёгкая и не подходит для указанного холода';
    if (temp < -2 && item.category === 'top' && warmth(item) === 'light') return 'для мороза нужен более тёплый верх';
  }
  if (conditions.rain >= 60 && ['outerwear','shoes'].includes(item.category) && rainproof(item) === 'no') return 'вещь отмечена без защиты от дождя';
  return '';
}

// Shared with missing-item suggestions: a temporary weather/availability mismatch is not a reason to buy.
export function recommendationEligibility(items, options = {}) {
  const warnings = [];
  const conditions = weatherConditions(options.weather,warnings);
  const season = options.season || '';
  const evaluated = (Array.isArray(items) ? items : []).filter(item => item && typeof item.id === 'string' && typeof item.category === 'string' && Object.hasOwn(CATEGORIES,item.category)).map(item => ({
    item,
    reason: item.available !== true ? 'unavailable' : season && !item.seasons?.includes(season) ? 'season' : unsuitable(item,conditions) ? 'weather' : ''
  }));
  return { items: evaluated.filter(entry=>!entry.reason).map(entry=>entry.item), rejected: evaluated.filter(entry=>entry.reason), conditions, warnings };
}

function candidateNotes(selected, context) {
  const { conditions, occasion, style, season, tags, anchorItemId } = context;
  const reasons = ['Полный комплект из доступных вещей вашего гардероба: основа и обувь.'];
  const warnings = [];
  if (season) reasons.push(`У всех вещей указан сезон «${SEASONS[season]}».`);
  if (anchorItemId) reasons.push('Выбранная вами вещь включена в комплект.');
  const colors = palette(selected);
  if (colors.accents.includes('multicolor')) warnings.push('У части вещей разноцветный рисунок: проверьте сочетание оттенков по фотографиям.');
  else if (colors.accents.length === 0) reasons.push('Нейтральная палитра: спокойное сочетание базовых цветов.');
  else if (colors.accents.length === 1) reasons.push('Один цветовой акцент дополнен нейтральными оттенками.');
  else if (colors.analogous) reasons.push('Цветовые акценты близки по цветовому кругу.');
  else warnings.push('В комплекте несколько контрастных цветов: проверьте сочетание по фотографиям.');

  const requested = style !== 'any' ? selected.filter(item => tags.get(item.id).has(style)) : [];
  if (style !== 'any') {
    if (requested.length) reasons.push(`В описании ${requested.length} вещей найдены признаки стиля «${STYLE_OPTIONS[style]}». Это приблизительное совпадение по словам.`);
    else warnings.push(`Стиль «${STYLE_OPTIONS[style]}» явно не указан у этих вещей: предложен доступный комплект, проверьте его вручную.`);
  }
  const relevant = selected.filter(item => OCCASION_STYLES[occasion].some(tag => tags.get(item.id).has(tag)));
  if (relevant.length) reasons.push(`Для повода «${OCCASIONS[occasion]}» выше оценены близкие по описанию вещи; соответствие дресс-коду проверьте сами.`);
  else warnings.push(`В описаниях нет явных подсказок для повода «${OCCASIONS[occasion]}»: это базовый вариант, соответствие случаю не подтверждено.`);
  if (['work','formal','party'].includes(occasion)) warnings.push('Требования конкретного мероприятия неизвестны: проверьте дресс-код.');
  if (selected.some(item => typeof item.style !== 'string' || !item.style.trim())) warnings.push('У части вещей стиль не указан. Подбор по стилю приблизительный и использует также названия.');

  if (!conditions.supplied) warnings.push('Погода не выбрана: комплект не проверен по температуре, дождю и ветру.');
  if (selected.some(item => item.category !== 'accessory' && warmth(item) === 'unknown')) warnings.push('Теплота части вещей не указана: соответствие температуре не подтверждено. Заполните характеристики одежды.');
  if (selected.some(item => ['shoes','outerwear'].includes(item.category) && rainproof(item) === 'unknown')) warnings.push('Защита обуви или верхней одежды от дождя не указана. Проверьте её перед выходом.');
  if (conditions.temperature !== null && conditions.temperature < 14) reasons.push('Добавлена верхняя одежда из-за прохладной ощущаемой температуры.');
  if (conditions.temperature !== null && conditions.temperature >= 25) reasons.push('Для жары исключены верхняя одежда и вещи, отмеченные как тёплые.');
  if (conditions.temperature !== null && conditions.temperature < 14 && selected.some(item => item.category === 'outerwear' && warmth(item) === 'unknown')) warnings.push('Теплота верхней одежды неизвестна: даже с этим комплектом может быть холодно. Уточните характеристику перед выходом.');
  if (conditions.rain >= 60 && selected.some(item => ['shoes','outerwear'].includes(item.category) && rainproof(item) === 'yes')) reasons.push('Для дождя выше оценены вещи с указанной защитой от осадков.');
  return { reasons: unique(reasons), warnings: unique(warnings) };
}

/** Rule-based suggestions, not an AI assessment of photographs or guaranteed weather protection. */
export function recommendOutfits(items, options = {}) {
  const warnings = [];
  let occasion = options.occasion || 'everyday';
  let style = options.style || 'any';
  const season = options.season || '';
  const anchorItemId = options.anchorItemId || '';
  const limit = Number.isInteger(options.limit) ? Math.max(0,Math.min(3,options.limit)) : 3;
  const variant = Number.isInteger(options.variant) ? Math.max(0,options.variant) : 0;
  if (!Object.hasOwn(OCCASIONS,occasion)) { occasion='everyday'; warnings.push('Неизвестный повод: выбран повседневный выход.'); }
  if (!Object.hasOwn(STYLE_OPTIONS,style)) { style='any'; warnings.push('Неизвестный стиль: ограничение по стилю не применено.'); }
  if (season && !Object.hasOwn(SEASONS,season)) return { outfits: [], warnings: ['Неизвестный сезон. Выберите сезон из списка.'], missingCategories: [] };
  const conditions = weatherConditions(options.weather,warnings);
  const cold = conditions.temperature !== null && conditions.temperature < 14;
  const all = (Array.isArray(items) ? items : []).filter(item => item && typeof item.id === 'string' && typeof item.category === 'string' && Object.hasOwn(CATEGORIES,item.category));
  const anchor = anchorItemId ? all.find(item => item.id === anchorItemId) : null;
  if (anchorItemId && !anchor) return { outfits: [], warnings: [...warnings,'Выбранная вещь больше не найдена в гардеробе. Выберите другую.'], missingCategories: [] };
  if (anchor && !anchor.available) return { outfits: [], warnings: [...warnings,'Выбранная вещь недоступна или находится в стирке. Выберите другую.'], missingCategories: [] };
  if (anchor && season && !anchor.seasons?.includes(season)) return { outfits: [], warnings: [...warnings,'У выбранной вещи не указан выбранный сезон. Измените сезон или вещь.'], missingCategories: [] };
  if (anchor && unsuitable(anchor,conditions)) return { outfits: [], warnings: [...warnings,`Выбранная вещь «${anchor.name}» не подходит: ${unsuitable(anchor,conditions)}. Измените условия или выберите другую вещь.`], missingCategories: [] };
  const available = all.filter(item => item.available === true && (!season || item.seasons?.includes(season)) && !unsuitable(item,conditions));
  const tags = new Map(available.map(item => [item.id,new Set(Object.entries(STYLE_WORDS).filter(([,pattern]) => pattern.test(`${item.style || ''} ${item.name || ''}`)).map(([key]) => key))]));
  const scoreItem = item => {
    const found = tags.get(item.id);
    let score = (style !== 'any' && found.has(style) ? 6 : 0) + (OCCASION_STYLES[occasion].some(tag => found.has(tag)) ? 3 : 0) + (item.favorite ? 0.5 : 0);
    if (conditions.rain >= 60 && ['shoes','outerwear'].includes(item.category) && rainproof(item) === 'yes') score += 6;
    if (cold && warmth(item) === 'warm') score += 2;
    if (conditions.temperature !== null && conditions.temperature >= 20 && warmth(item) === 'light') score += 2;
    return score;
  };
  const scores = new Map(available.map(item => [item.id,scoreItem(item)]));
  const order = (a,b) => scores.get(b.id)-scores.get(a.id) || a.id.localeCompare(b.id);
  const group = category => {
    const list = available.filter(item => item.category === category).sort(order);
    if (anchor?.category === category) return [anchor];
    // Rotate within equally useful choices for repeat requests, while still keeping the pool bounded.
    const offset = list.length ? variant % list.length : 0;
    const poolLimit = category === 'outerwear' ? 4 : ['shoes','accessory'].includes(category) ? 8 : 12;
    return [...list.slice(offset),...list.slice(0,offset)].slice(0,poolLimit);
  };
  const tops=group('top'), bottoms=group('bottom'), dresses=group('dress'), shoes=group('shoes'), coats=group('outerwear'), accessories=group('accessory');
  const mustUseSeparate = anchor && ['top','bottom'].includes(anchor.category);
  const mustUseDress = anchor?.category === 'dress';
  const bases = [
    ...(!mustUseDress ? tops.flatMap(top => bottoms.map(bottom => [top,bottom])) : []),
    ...(!mustUseSeparate ? dresses.map(dress => [dress]) : [])
  ];
  const missingCategories = [];
  if (!shoes.length) missingCategories.push('shoes');
  if (!bases.length) {
    if (mustUseDress) missingCategories.push('dress');
    else if (mustUseSeparate) { if (!tops.length) missingCategories.push('top'); if (!bottoms.length) missingCategories.push('bottom'); }
    else { if (!tops.length) missingCategories.push('top'); if (!bottoms.length) missingCategories.push('bottom'); }
  }
  if (cold && !coats.length) missingCategories.push('outerwear');
  if (missingCategories.length) {
    if (!bases.length && !mustUseSeparate && !mustUseDress) warnings.push('Для основы нужны верх и низ либо платье.');
    if (cold && !coats.length) warnings.push('Для указанного холода нет подходящей верхней одежды. Добавьте тёплую вещь или уточните её характеристики.');
    warnings.push(`Полный комплект не собран. Нет подходящих доступных вещей: ${unique(missingCategories).map(key => CATEGORIES[key].toLocaleLowerCase('ru')).join(', ')}. Проверьте сезон, наличие и погодные характеристики.`);
    return { outfits: [], warnings: unique(warnings), missingCategories: unique(missingCategories) };
  }
  if (!limit) return { outfits: [], warnings: unique(warnings), missingCategories: [] };
  const layers = cold || anchor?.category === 'outerwear' ? coats : [null];
  const candidates = [];
  const seen = new Set();
  for (const base of bases) for (const shoe of shoes) for (const coat of layers) {
    const main = [...base,shoe,...(coat ? [coat] : [])];
    let accessory = null;
    if (anchor?.category === 'accessory') accessory=anchor;
    else if (accessories.length) {
      let bestScore = -Infinity;
      for (const option of accessories) {
        const score = scores.get(option.id)+palette([...main,option]).score;
        if (score > bestScore) { accessory=option; bestScore=score; }
      }
    }
    const selected = [...main,...(accessory ? [accessory] : [])];
    if (anchorItemId && !selected.some(item => item.id === anchorItemId)) continue;
    const key = selected.map(item => item.id).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ selected, key, score: selected.reduce((sum,item) => sum+scores.get(item.id),0)/selected.length+palette(selected).score });
  }
  candidates.sort((a,b) => b.score-a.score || a.key.localeCompare(b.key));
  const offset = candidates.length ? (variant*limit)%Math.min(candidates.length,24) : 0;
  const ranked = [...candidates.slice(offset),...candidates.slice(0,offset)];
  const outfits = ranked.slice(0,limit).map((candidate,index) => {
    const notes = candidateNotes(candidate.selected,{ conditions,occasion,style,season,tags,anchorItemId });
    return { itemIds: candidate.selected.map(item => item.id), title: `${OCCASIONS[occasion]} · вариант ${index+1}`, description: `Комплект для повода «${OCCASIONS[occasion]}», составленный по правилам из вещей вашего гардероба.${season ? ` Сезон: ${SEASONS[season].toLocaleLowerCase('ru')}.` : ''}`, ...notes, complete: true };
  });
  if (!outfits.length) warnings.push('С выбранной вещью не удалось собрать полный комплект. Попробуйте изменить условия или открыть ручной конструктор.');
  return { outfits, warnings: unique(warnings), missingCategories: [] };
}
