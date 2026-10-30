import { CATEGORIES, SEASONS } from './model.js';
import { OCCASIONS, STYLE_OPTIONS } from '../styling/stylist.js';

const normalize = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .trim();
const sections = [
  ['wardrobe', 'Мой гардероб', '/wardrobe', 'wardrobe', 'вещи одежда стирка'],
  ['outfits', 'Мои образы', '/outfits', 'outfits', 'сочетания комплекты'],
  ['stylist', 'Стилист', '/stylist', 'sparkle', 'подобрать погода рекомендации'],
  ['calendar', 'Календарь', '/calendar', 'calendar', 'планы неделя сегодня'],
  ['shopping', 'Покупки', '/shopping-list', 'shopping', 'желания бюджет'],
  ['collections', 'Капсулы и поездки', '/collections', 'briefcase', 'коллекции чемодан сборы'],
  ['insights', 'История носки', '/insights', 'chart', 'статистика отметки'],
  ['community', 'Сообщество', '/community', 'users', 'люди друзья публикации'],
  ['messages', 'Сообщения', '/messages', 'message', 'переписка чаты'],
  ['settings', 'Настройки', '/settings', 'settings', 'резервная копия тема импорт экспорт'],
];

export function searchCloset(state, query = '', { kind = 'all', limit = 12 } = {}) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const navigation = sections.map(([id, title, href, icon, keywords]) => ({
    id: `nav:${id}`,
    kind: 'section',
    title,
    href,
    icon,
    subtitle: 'Раздел',
    text: `${title} ${keywords}`,
  }));
  if (!words.length) return kind === 'all' || kind === 'section' ? navigation.slice(0, limit) : [];
  const garmentById = new Map(state.items.map((item) => [item.id, item]));
  const rows = [
    ...state.items.map((item) => ({
      id: `item:${item.id}`,
      kind: 'item',
      title: item.name,
      subtitle: [CATEGORIES[item.category], item.brand, item.size, item.available ? '' : 'В стирке']
        .filter(Boolean)
        .join(' · '),
      icon: 'hanger',
      href: '/wardrobe?reset=1&q=' + encodeURIComponent(item.name),
      text: [
        item.name,
        item.brand,
        item.material,
        CATEGORIES[item.category],
        STYLE_OPTIONS[item.style],
        item.style,
        ...item.seasons.map((season) => SEASONS[season]),
      ]
        .filter(Boolean)
        .join(' '),
    })),
    ...state.outfits.map((outfit) => ({
      id: `outfit:${outfit.id}`,
      kind: 'outfit',
      title: outfit.name,
      subtitle: 'Образ · ' + (OCCASIONS[outfit.occasion] || 'Свой стиль'),
      icon: 'outfits',
      href: '/outfits?q=' + encodeURIComponent(outfit.name),
      text: [
        outfit.name,
        outfit.description,
        OCCASIONS[outfit.occasion],
        STYLE_OPTIONS[outfit.style],
        outfit.style,
        ...outfit.itemIds.map((id) => garmentById.get(id)?.name),
      ]
        .filter(Boolean)
        .join(' '),
    })),
    ...state.shoppingList.map((entry) => ({
      id: `shopping:${entry.id}`,
      kind: 'shopping',
      title: entry.name,
      subtitle: `Покупка · ${entry.status === 'purchased' ? 'Куплено' : 'В планах'}`,
      icon: 'shopping',
      href: '/shopping-list?q=' + encodeURIComponent(entry.name),
      text: [entry.name, CATEGORIES[entry.category], entry.style, entry.notes]
        .filter(Boolean)
        .join(' '),
    })),
    ...navigation,
  ];
  const phrase = words.join(' ');
  return rows
    .filter(
      (row) =>
        (kind === 'all' || row.kind === kind) &&
        words.every((word) => normalize(row.text).includes(word)),
    )
    .map(({ text, ...row }) => ({
      ...row,
      rank:
        normalize(row.title) === phrase
          ? 0
          : normalize(row.title).startsWith(phrase)
            ? 1
            : row.kind === 'section'
              ? 3
              : 2,
    }))
    .sort(
      (a, b) => a.rank - b.rank || a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(1, Math.min(40, limit)));
}
