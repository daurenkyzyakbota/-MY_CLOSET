import { CATEGORIES, COLORS } from '../data/model.js';

export class SocialError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') {
    super(message);
    this.name = 'SocialError';
    this.status = status;
    this.code = code;
  }
}

export const PAGE_SIZE = 12;
export const PUBLIC_ACTIONS = new Set([
  'profile.get',
  'people.search',
  'posts.list',
  'posts.get',
  'comments.list',
  'media.get',
]);
export const READ_ACTIONS = new Set([
  ...PUBLIC_ACTIONS,
  'bootstrap',
  'friends.list',
  'conversations.list',
  'messages.list',
  'messages.search',
  'notifications.list',
]);

export function object(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  ) {
    throw new SocialError('Проверьте переданные данные.');
  }
  return value;
}

export function text(value, label, max, { required = false } = {}) {
  if (
    typeof value !== 'string' ||
    !value.isWellFormed() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new SocialError(`Проверьте поле «${label}».`);
  }
  const result = value.trim();
  if (result.length > max || (required && !result)) {
    throw new SocialError(`Поле «${label}»: ${required ? 'от 1 до' : 'не более'} ${max} символов.`);
  }
  return result;
}

export function id(value, label = 'идентификатор') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new SocialError(`Некорректный ${label}.`);
  }
  return value;
}

export function boolean(value, label) {
  if (typeof value !== 'boolean') throw new SocialError(`Проверьте настройку «${label}».`);
  return value;
}

export function choice(value, options, label) {
  if (!options.includes(value)) throw new SocialError(`Проверьте поле «${label}».`);
  return value;
}

export function username(value) {
  if (typeof value !== 'string') throw new SocialError('Укажите ник профиля.');
  const result = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,30}$/.test(result)) {
    throw new SocialError('Ник: от 3 до 30 латинских букв, цифр или знаков подчёркивания.');
  }
  return result;
}

function imageSize(bytes, format) {
  if (format === 'png' && bytes.length >= 24 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (format === 'webp') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && bytes.length >= 30 && !(bytes[20] & 2))
      return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21);
      return [(bits & 16383) + 1, ((bits >>> 14) & 16383) + 1];
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes.toString('hex', 23, 26) === '9d012a')
      return [bytes.readUInt16LE(26) & 16383, bytes.readUInt16LE(28) & 16383];
  }
  if (format === 'jpeg') {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 216 || marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 7
      )
        return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      offset += length;
    }
  }
  return [0, 0];
}

export function photo(value, limit = 1_000_000) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > limit) {
    throw new SocialError('Фото слишком большое. Выберите уменьшенное изображение.');
  }
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0)
    throw new SocialError('Поддерживаются фото PNG, JPEG и WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  const valid =
    match[1] === 'png'
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === 'jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid || bytes.length < 16)
    throw new SocialError('Не удалось прочитать фото. Выберите другое.');
  const [width, height] = imageSize(bytes, match[1]);
  if (width < 1 || height < 1 || width > 2048 || height > 2048)
    throw new SocialError('Используйте статичное фото размером до 2048 × 2048 пикселей.');
  return value;
}

export function profilePatch(input) {
  object(input, [
    'username',
    'name',
    'bio',
    'city',
    'styles',
    'avatar',
    'private',
    'allowMessages',
    'notifications',
  ]);
  const patch = {};
  if ('username' in input) patch.username = username(input.username);
  for (const [field, label, max] of [
    ['name', 'Имя', 80],
    ['bio', 'О себе', 500],
    ['city', 'Город', 120],
    ['styles', 'Стили', 200],
  ]) {
    if (field in input)
      patch[field] = text(input[field], label, max, { required: field === 'name' });
  }
  if ('avatar' in input) patch.avatar = photo(input.avatar, 400_000);
  if ('private' in input) patch.private = boolean(input.private, 'Закрытый профиль');
  if ('allowMessages' in input)
    patch.allowMessages = choice(input.allowMessages, ['friends', 'everyone'], 'Сообщения');
  if ('notifications' in input) {
    object(input.notifications, ['likes', 'comments', 'friends', 'messages']);
    patch.notifications = {};
    for (const key of Object.keys(input.notifications))
      patch.notifications[key] = boolean(input.notifications[key], key);
  }
  return patch;
}

export function snapshot(value) {
  object(value, ['name', 'occasion', 'style', 'season', 'items']);
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 30) {
    throw new SocialError('В публикации должно быть от 1 до 30 вещей.');
  }
  const ids = new Set();
  const items = value.items.map((item) => {
    object(item, ['id', 'name', 'category', 'colors', 'photo']);
    const itemId = id(item.id, 'идентификатор вещи');
    if (ids.has(itemId)) throw new SocialError('Одна вещь добавлена в образ несколько раз.');
    ids.add(itemId);
    if (
      !Array.isArray(item.colors) ||
      item.colors.length > 10 ||
      new Set(item.colors).size !== item.colors.length ||
      item.colors.some((color) => !Object.hasOwn(COLORS, color))
    ) {
      throw new SocialError('Проверьте цвета вещей.');
    }
    return {
      id: itemId,
      name: text(item.name, 'Название вещи', 100, { required: true }),
      category: choice(item.category, Object.keys(CATEGORIES), 'Категория вещи'),
      colors: [...item.colors],
      photo: photo(item.photo || ''),
    };
  });
  const result = {
    name: text(value.name, 'Название образа', 100, { required: true }),
    occasion: text(value.occasion || '', 'Повод', 100),
    style: text(value.style || '', 'Стиль', 100),
    season: text(value.season || '', 'Сезон', 100),
    items,
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 10 * 1024 * 1024)
    throw new SocialError('Публикация слишком большая. Уменьшите фотографии.');
  return result;
}

export function postInput(input) {
  object(input, ['postId', 'clientId', 'title', 'description', 'tags', 'visibility', 'snapshot']);
  if (!Array.isArray(input.tags) || input.tags.length > 10)
    throw new SocialError('Добавьте не более 10 тегов.');
  const tags = [
    ...new Set(
      input.tags.map((value) => text(value, 'Тег', 40, { required: true }).replace(/^#/, '')),
    ),
  ];
  if (tags.some((value) => !value)) throw new SocialError('Тег не может быть пустым.');
  return {
    postId: input.postId ? id(input.postId) : null,
    ...('clientId' in input ? { clientId: idempotencyKey(input.clientId) } : {}),
    title: text(input.title, 'Заголовок', 100, { required: true }),
    description: text(input.description || '', 'Описание', 2000),
    tags,
    visibility: choice(input.visibility, ['private', 'friends', 'public'], 'Видимость'),
    ...('snapshot' in input ? { snapshot: snapshot(input.snapshot) } : {}),
  };
}

export function idempotencyKey(value) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new SocialError('Некорректный ключ повторной отправки.');
  }
  return value.toLowerCase();
}

export function feedFilters(input) {
  return {
    query: text(
      input.query === undefined ? '' : input.query,
      'Поиск образов',
      100,
    ).toLocaleLowerCase('ru'),
    tag: text(input.tag === undefined ? '' : input.tag, 'Тег', 40)
      .replace(/^#/, '')
      .trim()
      .toLocaleLowerCase('ru'),
    occasion: text(
      input.occasion === undefined ? '' : input.occasion,
      'Повод',
      100,
    ).toLocaleLowerCase('ru'),
    style: text(input.style === undefined ? '' : input.style, 'Стиль', 100).toLocaleLowerCase('ru'),
  };
}

export function messageSearch(input) {
  object(input, ['conversationId', 'query', 'cursor']);
  const query = text(input.query, 'Поиск в переписке', 100, { required: true }).toLocaleLowerCase(
    'ru',
  );
  if (query.length < 2)
    throw new SocialError('Введите хотя бы два символа для поиска в переписке.');
  return { conversationId: id(input.conversationId), query, cursor: input.cursor };
}

export function encodeCursor(kind, values) {
  return Buffer.from(JSON.stringify({ kind, ...values }), 'utf8').toString('base64url');
}
export function decodeCursor(value, kind) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 600 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new SocialError('Некорректная страница списка.');
  let result;
  try {
    result = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new SocialError('Некорректная страница списка.');
  }
  if (!result || result.kind !== kind)
    throw new SocialError('Страница относится к другому списку.');
  id(result.id);
  if (kind === 'people') username(result.username);
  else if (
    typeof result.at !== 'string' ||
    !/^\d{4}-\d\d-\d\dT/.test(result.at) ||
    !Number.isFinite(Date.parse(result.at))
  )
    throw new SocialError('Некорректная дата страницы.');
  return result;
}
