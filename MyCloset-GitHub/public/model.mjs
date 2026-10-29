export const CATEGORIES = { top: 'Верх', bottom: 'Брюки и юбки', dress: 'Платья', outerwear: 'Верхняя одежда', shoes: 'Обувь', accessory: 'Аксессуары' };
export const SUBCATEGORIES = {
  top: { tshirt:'Футболка', shirt:'Рубашка', blouse:'Блузка', sweater:'Свитер', cardigan:'Кардиган', hoodie:'Худи', top:'Топ' },
  bottom: { jeans:'Джинсы', trousers:'Брюки', skirt:'Юбка', shorts:'Шорты', leggings:'Легинсы' },
  dress: { dress:'Платье', sundress:'Сарафан', evening_dress:'Вечернее платье', knitted_dress:'Трикотажное платье' },
  outerwear: { coat:'Пальто', jacket:'Куртка', trench:'Тренч', down_jacket:'Пуховик', vest:'Жилет' },
  shoes: { sneakers:'Кеды', trainers:'Кроссовки', boots:'Сапоги', ankle_boots:'Ботинки', loafers:'Лоферы', heels:'Туфли на каблуке', sandals:'Сандалии', flats:'Балетки' },
  accessory: { bag:'Сумка', backpack:'Рюкзак', scarf:'Шарф', hat:'Головной убор', belt:'Ремень', jewelry:'Украшение', gloves:'Перчатки' }
};
export const COLORS = { white: ['Белый', '#f7f5ef'], black: ['Чёрный', '#272b2b'], gray: ['Серый', '#a5a7a5'], beige: ['Бежевый', '#cfbba4'], brown: ['Коричневый', '#8d6350'], blue: ['Синий', '#587d99'], green: ['Зелёный', '#7d9271'], red: ['Красный', '#bd6963'], pink: ['Розовый', '#d8a5ad'], yellow: ['Жёлтый', '#ddc373'], purple: ['Фиолетовый', '#a291b7'], multicolor: ['Разноцветный', 'linear-gradient(135deg,#d6a7ad,#dac680,#8ca78e,#819fc4)'] };
export const SEASONS = { spring: 'Весна', summer: 'Лето', autumn: 'Осень', winter: 'Зима' };
export const SLOTS = { day: 'День', evening: 'Вечер' };
export const FORMAT_VERSION = 4;
export const WARMTH_OPTIONS = { unknown: 'Не указано', light: 'Лёгкая', medium: 'На прохладную погоду', warm: 'Тёплая' };
export const RAINPROOF_OPTIONS = { unknown: 'Не указано', yes: 'Да', no: 'Нет' };
const OCCASION_KEYS = ['everyday', 'study', 'work', 'date', 'walk', 'party', 'formal', 'travel'];
export const MAX_ITEMS = 500;
// Covers a valid pretty-printed v4 export, including 50M photo characters and worst-case JSON escaping.
export const MAX_BACKUP_FILE_BYTES = 96 * 1024 * 1024;
export const SHOPPING_STATUSES = { planned: 'Планирую купить', purchased: 'Куплено' };
export function uid() { return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
export function emptyState() { return { version: FORMAT_VERSION, profile: { name: '', city: '', styles: '', colors: [], location: null }, items: [], outfits: [], plans: [], shoppingList: [] }; }
export function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export function validDate(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [y,m,d] = value.split('-').map(Number); const date = new Date(y,m-1,d); return y >= 1900 && y <= 2200 && date.getFullYear() === y && date.getMonth() === m-1 && date.getDate() === d; }
export function monthCells(year, month) { const first = new Date(year,month,1); const leading = (first.getDay()+6)%7; const total = new Date(year,month+1,0).getDate(); return Array.from({length: Math.ceil((leading+total)/7)*7}, (_,i) => i < leading || i >= leading+total ? null : localDate(new Date(year,month,i-leading+1))); }
export function filterItems(items, filters = {}) {
  const q = String(filters.query || '').trim().toLocaleLowerCase('ru');
  const style = String(filters.style || '').trim().toLocaleLowerCase('ru');
  return items.filter(item => (!q || `${item.name} ${item.style} ${item.size} ${CATEGORIES[item.category]} ${SUBCATEGORIES[item.category]?.[item.subcategory] || ''} ${item.brand || ''} ${item.material || ''} ${item.notes || ''} ${item.colors.map(c=>COLORS[c]?.[0] || '').join(' ')}`.toLocaleLowerCase('ru').includes(q)) && (!style || item.style.toLocaleLowerCase('ru').includes(style)) && (!filters.category || item.category === filters.category) && (!filters.color || item.colors.includes(filters.color)) && (!filters.season || item.seasons.includes(filters.season)) && (!filters.availability || (filters.availability === 'available' ? item.available : !item.available)) && (!filters.favorites || item.favorite));
}
export function sortItems(items, sort = 'newest') {
  const tie = (a,b) => a.id.localeCompare(b.id,'en');
  const newest = (a,b) => (Date.parse(b.createdAt) || 0)-(Date.parse(a.createdAt) || 0);
  const compare = sort === 'oldest' ? (a,b)=>-newest(a,b) : sort === 'name' ? (a,b)=>a.name.localeCompare(b.name,'ru',{sensitivity:'base',numeric:true}) : sort === 'favorites' ? (a,b)=>Number(b.favorite)-Number(a.favorite) || newest(a,b) : newest;
  return [...items].sort((a,b)=>compare(a,b)||tie(a,b));
}
export function categoryCounts(items) { const counts=Object.fromEntries(Object.keys(CATEGORIES).map(category=>[category,0])); for (const item of items) if (Object.hasOwn(counts,item.category)) counts[item.category]++; return counts; }
export function outfitStatus(outfit, items) { const byId = new Map(items.map(item=>[item.id,item])); const missing = outfit.itemIds.filter(id=>!byId.has(id)); const unavailable = outfit.itemIds.filter(id=>byId.has(id) && !byId.get(id).available); return { missing, unavailable, complete: !missing.length && !unavailable.length && !(outfit.missingItems || []).length, items: outfit.itemIds.map(id=>byId.get(id)).filter(Boolean) }; }
export function suggestItems(items, season = '') { const available = items.filter(item=>item.available && (!season || item.seasons.includes(season))); const pick = key => available.find(item=>item.category===key); const dress = pick('dress'); const top = pick('top'); const bottom = pick('bottom'); const shoes = pick('shoes'); if (!shoes || (!dress && !(top && bottom))) return []; return [ ...(top && bottom ? [top,bottom] : [dress]), shoes, pick('outerwear'), pick('accessory') ].filter(Boolean).map(item=>item.id); }

function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: ожидается объект.`); }
function fields(value, required, label, optional = []) { object(value,label); for (const key of required) if (!Object.hasOwn(value,key)) throw new Error(`${label}: отсутствует поле «${key}».`); for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) throw new Error(`${label}: неизвестное поле «${key}».`); }
function str(value, max, label, required = false) { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${label}: некорректное значение (не более ${max} символов).`); return value; }
function timestamp(value,label) { str(value,40,label,true); const date = new Date(value); if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error(label + ': некорректная дата создания.'); }
function bool(value,label) { if (typeof value !== 'boolean') throw new Error(`${label}: ожидается логическое значение.`); }
function list(value,max,label) { if (!Array.isArray(value) || value.length > max) throw new Error(`${label}: допустимо не более ${max} записей.`); }
function keysList(value, options, max, label, required = false) { list(value,max,label); if ((required && !value.length) || value.some(v=>typeof v !== 'string' || !Object.hasOwn(options,v)) || new Set(value).size!==value.length) throw new Error(`${label}: некорректный список.`); }
function id(value,label) { str(value,100,label,true); if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`${label}: некорректный идентификатор.`); }
function uniqueIds(values,label) { const ids = values.map(value=>value.id); if (new Set(ids).size !== ids.length) throw new Error(`${label}: повторяющиеся идентификаторы.`); }
function missingDetails(value,label) {
  id(value.id,label); str(value.name,100,`${label}: название`,true);
  if (typeof value.category !== 'string' || !Object.hasOwn(CATEGORIES,value.category)) throw new Error(`${label}: неизвестная категория.`);
  keysList(value.colors,COLORS,12,`${label}: цвета`); str(value.style,100,`${label}: стиль`); str(value.size,30,`${label}: размер`);
  if (typeof value.season !== 'string' || (value.season !== '' && !Object.hasOwn(SEASONS,value.season))) throw new Error(`${label}: неизвестный сезон.`);
}
function validateShoppingList(value) {
  list(value,500,'Список покупок'); uniqueIds(value,'Список покупок');
  for (const entry of value) {
    fields(entry,['id','name','category','colors','season','style','size','budget','notes','status','itemId','createdAt'],'Покупка');
    missingDetails(entry,'Покупка'); str(entry.notes,500,'Заметки покупки'); timestamp(entry.createdAt,'Дата покупки');
    if (entry.budget !== null && (typeof entry.budget !== 'number' || !Number.isFinite(entry.budget) || entry.budget < 0 || entry.budget > 100000000)) throw new Error('Бюджет покупки: введите число от 0 до 100 000 000 или оставьте поле пустым.');
    if (typeof entry.status !== 'string' || !Object.hasOwn(SHOPPING_STATUSES,entry.status)) throw new Error('Покупка: неизвестный статус.');
    if (entry.itemId !== '') id(entry.itemId,'Вещь покупки');
  }
}
function location(value) {
  if (value === null) return;
  fields(value,['id','name','country','admin1','latitude','longitude','timezone'],'Город для погоды');
  if (typeof value.id === 'number') { if (!Number.isSafeInteger(value.id) || value.id < 1) throw new Error('Город для погоды: некорректный идентификатор.'); }
  else id(value.id,'Город для погоды');
  str(value.name,120,'Название города',true); str(value.country,100,'Страна'); str(value.admin1,120,'Регион'); if (value.timezone !== null) str(value.timezone,100,'Часовой пояс',true);
  if (typeof value.latitude !== 'number' || !Number.isFinite(value.latitude) || Math.abs(value.latitude)>90 || typeof value.longitude !== 'number' || !Number.isFinite(value.longitude) || Math.abs(value.longitude)>180) throw new Error('Город для погоды: некорректные координаты.');
  if (value.timezone !== null) try { new Intl.DateTimeFormat('ru',{timeZone:value.timezone}); } catch { throw new Error('Город для погоды: неизвестный часовой пояс.'); }
}
export function validateState(value) {
  object(value,'Файл');
  if (![1,2,3,FORMAT_VERSION].includes(value.version)) throw new Error('Неподдерживаемая версия резервной копии. Нужен файл MyCloset версии 1, 2, 3 или 4.');
  const previous = value.version < FORMAT_VERSION;
  const hasShopping = value.version >= 3;
  fields(value,['version','profile','items','outfits','plans',...(hasShopping ? ['shoppingList'] : [])],'Файл');
  const legacy = value.version === 1;
  fields(value.profile,['name','city','styles','colors'],'Профиль',legacy ? [] : ['location']);
  str(value.profile.name,80,'Имя'); str(value.profile.city,120,'Город'); str(value.profile.styles,200,'Предпочтения'); keysList(value.profile.colors,COLORS,12,'Любимые цвета');
  if (!legacy && Object.hasOwn(value.profile,'location')) location(value.profile.location);
  list(value.items,MAX_ITEMS,'Гардероб'); let photoSize = 0;
  for (const item of value.items) {
    fields(item,['id','name','category','colors','seasons','size','style','favorite','available','photo','createdAt'],'Вещь',[...(!legacy ? ['warmth','rainproof'] : []),...(!previous ? ['subcategory','material','brand','notes','purchaseDate'] : [])]);
    id(item.id,'Вещь'); str(item.name,100,'Название вещи',true); if (typeof item.category !== 'string' || !Object.hasOwn(CATEGORIES,item.category)) throw new Error('Неизвестная категория вещи.');
    keysList(item.colors,COLORS,12,'Цвета вещи',true); keysList(item.seasons,SEASONS,4,'Сезоны вещи',true); str(item.size,30,'Размер'); str(item.style,100,'Стиль'); bool(item.favorite,'Избранное'); bool(item.available,'Наличие'); timestamp(item.createdAt,'Дата создания');
    str(item.photo,4000000,'Фотография'); if (item.photo && !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/]+=*$/.test(item.photo)) throw new Error('Фотография должна быть изображением JPEG, PNG или WebP.'); photoSize += item.photo.length;
    if (!legacy && Object.hasOwn(item,'warmth') && (typeof item.warmth !== 'string' || !Object.hasOwn(WARMTH_OPTIONS,item.warmth))) throw new Error('Вещь: неизвестная теплота одежды.');
    if (!legacy && Object.hasOwn(item,'rainproof') && (typeof item.rainproof !== 'string' || !Object.hasOwn(RAINPROOF_OPTIONS,item.rainproof))) throw new Error('Вещь: некорректная защита от дождя.');
    if (!previous && Object.hasOwn(item,'subcategory')) { str(item.subcategory,100,'Подкатегория'); if (item.subcategory !== '' && !Object.hasOwn(SUBCATEGORIES[item.category],item.subcategory)) throw new Error('Вещь: подкатегория не соответствует категории.'); }
    if (!previous && Object.hasOwn(item,'material')) str(item.material,100,'Материал');
    if (!previous && Object.hasOwn(item,'brand')) str(item.brand,100,'Бренд');
    if (!previous && Object.hasOwn(item,'notes')) str(item.notes,1000,'Заметки о вещи');
    if (!previous && Object.hasOwn(item,'purchaseDate') && item.purchaseDate !== '' && !validDate(item.purchaseDate)) throw new Error('Вещь: некорректная дата покупки.');
  }
  if (photoSize > 50000000) throw new Error('Фотографии занимают слишком много места (лимит резервной копии — 50 МБ).');
  uniqueIds(value.items,'Гардероб'); list(value.outfits,500,'Образы');
  for (const outfit of value.outfits) {
    fields(outfit,['id','name','itemIds','favorite','createdAt'],'Образ',legacy ? [] : ['occasion','style','season','description',...(hasShopping ? ['missingItems'] : [])]); id(outfit.id,'Образ'); str(outfit.name,100,'Название образа',true); list(outfit.itemIds,30,'Состав образа');
    const missingItems = hasShopping && Object.hasOwn(outfit,'missingItems') ? outfit.missingItems : [];
    list(missingItems,10,'Недостающие вещи образа');
    if (!outfit.itemIds.length && !missingItems.length) throw new Error('В образе должна быть хотя бы одна вещь.');
    if (outfit.itemIds.length + missingItems.length > 30) throw new Error('В образе допустимо не более 30 вещей вместе с недостающими.');
    for (const missing of missingItems) { fields(missing,['id','name','category','colors','season','style','size','reason'],'Недостающая вещь'); missingDetails(missing,'Недостающая вещь'); str(missing.reason,500,'Причина рекомендации'); }
    uniqueIds(missingItems,'Недостающие вещи образа');
    if (missingItems.some(missing=>outfit.itemIds.includes(missing.id))) throw new Error('Идентификаторы имеющихся и недостающих вещей образа пересекаются.');
    for (const ref of outfit.itemIds) id(ref,'Вещь в образе'); if (new Set(outfit.itemIds).size!==outfit.itemIds.length) throw new Error('Вещи в образе повторяются.'); bool(outfit.favorite,'Избранное образа'); timestamp(outfit.createdAt,'Дата образа');
    if (!legacy && Object.hasOwn(outfit,'occasion') && !OCCASION_KEYS.includes(outfit.occasion)) throw new Error('Образ: неизвестный повод.');
    if (!legacy && Object.hasOwn(outfit,'style')) str(outfit.style,100,'Стиль образа');
    if (!legacy && Object.hasOwn(outfit,'season') && (typeof outfit.season !== 'string' || (outfit.season !== '' && !Object.hasOwn(SEASONS,outfit.season)))) throw new Error('Образ: неизвестный сезон.');
    if (!legacy && Object.hasOwn(outfit,'description')) str(outfit.description,500,'Описание образа');
  }
  uniqueIds(value.outfits,'Образы'); list(value.plans,5000,'Календарь'); const outfitIds = new Set(value.outfits.map(outfit=>outfit.id)); const occupied = new Set();
  for (const plan of value.plans) { fields(plan,['id','date','slot','outfitId'],'План'); id(plan.id,'План'); if (!validDate(plan.date)) throw new Error('Некорректная дата в календаре.'); if (!Object.hasOwn(SLOTS,plan.slot)) throw new Error('Неизвестное время дня.'); id(plan.outfitId,'Образ в календаре'); if (!outfitIds.has(plan.outfitId)) throw new Error('В календаре есть ссылка на отсутствующий образ.'); const key = `${plan.date}:${plan.slot}`; if (occupied.has(key)) throw new Error('На одно время дня назначено несколько образов.'); occupied.add(key); }
  uniqueIds(value.plans,'Календарь'); if (hasShopping) validateShoppingList(value.shoppingList);
  // Validate the old schema before migration. Corrupt backups must never be repaired silently.
  // Return an independent v4 value so callers can persist it without replacing the wardrobe.
  const result = JSON.parse(JSON.stringify(value));
  result.version = FORMAT_VERSION;
  if (!hasShopping) result.shoppingList = [];
  if (!Object.hasOwn(result.profile,'location')) result.profile.location = null;
  for (const item of result.items) { if (!Object.hasOwn(item,'warmth')) item.warmth='unknown'; if (!Object.hasOwn(item,'rainproof')) item.rainproof='unknown'; for (const key of ['subcategory','material','brand','notes','purchaseDate']) if (!Object.hasOwn(item,key)) item[key]=''; }
  for (const outfit of result.outfits) { if (!Object.hasOwn(outfit,'occasion')) outfit.occasion='everyday'; if (!Object.hasOwn(outfit,'style')) outfit.style=''; if (!Object.hasOwn(outfit,'season')) outfit.season=''; if (!Object.hasOwn(outfit,'description')) outfit.description=''; if (!Object.hasOwn(outfit,'missingItems')) outfit.missingItems=[]; }
  return previous ? validateState(result) : result;
}
export function demoState(existing = emptyState()) {
  const data = validateState(existing); const now = new Date().toISOString();
  const definitions = [['Белая рубашка','top',['white'],['spring','summer','autumn'],'M','Повседневный'],['Прямые джинсы','bottom',['blue'],['spring','summer','autumn'],'M','Повседневный'],['Белые кеды','shoes',['white'],['spring','summer','autumn'],'38','Повседневный'],['Льняное платье','dress',['beige'],['spring','summer'],'M','Повседневный'],['Лёгкий тренч','outerwear',['beige'],['spring','autumn'],'M','Классический'],['Сумка через плечо','accessory',['brown'],['spring','summer','autumn','winter'],'','Повседневный']];
  const items = definitions.map(([name,category,colors,seasons,size,style])=>({id:uid(),name,category,colors,seasons,size,style,favorite:false,available:true,photo:'',createdAt:now}));
  data.items.push(...items); data.outfits.push({id:uid(),name:'Пример: прогулка по городу',itemIds:[items[0].id,items[1].id,items[2].id,items[5].id],favorite:false,createdAt:now}); return validateState(data);
}

