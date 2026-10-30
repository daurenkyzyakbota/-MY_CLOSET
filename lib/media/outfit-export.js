import { CATEGORIES, SEASONS } from '../data/model.js';
import { OCCASIONS, STYLE_OPTIONS } from '../styling/stylist.js';

function rectangle(context, x, y, width, height, radius = 18) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function lines(context, text, width) {
  const result = [];
  for (const paragraph of String(text || '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && context.measureText(`${line} ${word}`).width > width) {
        result.push(line);
        line = '';
      }
      if (context.measureText(word).width <= width) line += `${line ? ' ' : ''}${word}`;
      else
        for (const character of Array.from(word)) {
          if (line && context.measureText(line + character).width > width) {
            result.push(line);
            line = '';
          }
          line += character;
        }
    }
    if (line) result.push(line);
  }
  return result.length ? result : [''];
}

function imageFrom(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось подготовить изображение для коллажа.'));
    image.src = source;
  });
}

function artworkSource(item, artworkElement) {
  const slot = [...(artworkElement?.querySelectorAll('[data-export-item]') || [])].find(
    (element) => element.dataset.exportItem === item.id,
  );
  const source = slot?.querySelector('svg');
  if (!source) return '';
  const copy = source.cloneNode(true);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', '480');
  copy.setAttribute('height', '440');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
}

function drawContained(context, image, x, y, width, height) {
  const sourceWidth = image.naturalWidth || image.width,
    sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const targetWidth = sourceWidth * scale,
    targetHeight = sourceHeight * scale;
  context.drawImage(
    image,
    x + (width - targetWidth) / 2,
    y + (height - targetHeight) / 2,
    targetWidth,
    targetHeight,
  );
}

export async function createOutfitPng({ outfit, items, artworkElement }) {
  if (!outfit || !Array.isArray(outfit.itemIds) || !Array.isArray(items))
    throw new Error('Не удалось прочитать состав образа.');
  await document.fonts?.ready;
  const byId = new Map(items.map((item) => [item.id, item]));
  const pieces = outfit.itemIds
    .map((id) =>
      byId.has(id)
        ? { item: byId.get(id), kind: 'owned' }
        : { item: { name: 'Вещь удалена из гардероба' }, kind: 'deleted' },
    )
    .concat((outfit.missingItems || []).map((item) => ({ item, kind: 'missing' })));
  if (!pieces.length) throw new Error('Добавьте вещи в образ перед экспортом.');
  if (pieces.length > 30) throw new Error('Слишком много вещей для одного коллажа.');
  const font = getComputedStyle(document.body).fontFamily || 'Arial, sans-serif';
  const display =
    getComputedStyle(document.documentElement).getPropertyValue('--font-display') ||
    'Georgia, serif';
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Браузер не поддерживает экспорт картинки.');
  const padding = 48,
    gap = 22,
    columns = pieces.length > 4 ? 3 : pieces.length === 1 ? 1 : 2;
  const cardWidth = (1080 - padding * 2 - gap * (columns - 1)) / columns;
  context.font = `500 52px ${display}`;
  const titleLines = lines(context, outfit.name, 984);
  context.font = `500 19px ${font}`;
  const tags = [
    OCCASIONS[outfit.occasion] || OCCASIONS.everyday,
    STYLE_OPTIONS[outfit.style] || outfit.style,
    SEASONS[outfit.season],
  ]
    .filter(Boolean)
    .join('  ·  ');
  const tagLines = lines(context, tags, 984);
  context.font = `400 19px ${font}`;
  const descriptionLines = outfit.description ? lines(context, outfit.description, 984) : [];
  const gridTop =
    134 +
    titleLines.length * 57 +
    tagLines.length * 28 +
    (descriptionLines.length ? descriptionLines.length * 27 + 18 : 0);
  const imageHeight = columns === 1 ? 510 : columns === 2 ? 310 : 240;
  context.font = `600 20px ${font}`;
  for (const piece of pieces) piece.nameLines = lines(context, piece.item.name, cardWidth - 40);
  const rows = [];
  for (let index = 0; index < pieces.length; index += columns) {
    const row = pieces.slice(index, index + columns);
    rows.push({
      pieces: row,
      height: imageHeight + 96 + Math.max(...row.map((piece) => piece.nameLines.length)) * 26,
    });
  }
  canvas.height = gridTop + rows.reduce((sum, row) => sum + row.height + gap, 0) + 78;
  context.fillStyle = '#fcf8f5';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#a45f7c';
  context.fillRect(padding, 41, 40, 3);
  context.font = `600 16px ${font}`;
  context.fillText('MYCLOSET  /  ВАШ ОБРАЗ', padding + 54, 48);
  context.fillStyle = '#3b2e39';
  context.font = `500 52px ${display}`;
  let y = 109;
  for (const line of titleLines) {
    context.fillText(line, padding, y);
    y += 57;
  }
  context.font = `500 19px ${font}`;
  context.fillStyle = '#9e5e73';
  for (const line of tagLines) {
    context.fillText(line, padding, y + 4);
    y += 28;
  }
  context.font = `400 19px ${font}`;
  context.fillStyle = '#796976';
  y += 12;
  for (const line of descriptionLines) {
    context.fillText(line, padding, y + 4);
    y += 27;
  }

  const images = await Promise.all(
    pieces.map(async (piece) => {
      if (piece.kind !== 'owned') return null;
      const source = piece.item.photo || artworkSource(piece.item, artworkElement);
      if (piece.item.photo && !/^data:image\/(png|jpeg|webp);base64,/i.test(source))
        throw new Error('Фотография должна храниться в гардеробе.');
      if (!source) return null;
      try {
        return await imageFrom(source);
      } catch {
        throw new Error(
          `Не удалось открыть изображение «${piece.item.name}». Обновите фото и попробуйте снова.`,
        );
      }
    }),
  );
  y = gridTop;
  let imageIndex = 0;
  for (const row of rows) {
    row.pieces.forEach((piece, column) => {
      const x = padding + column * (cardWidth + gap),
        image = images[imageIndex++];
      const placeholder = piece.kind !== 'owned';
      context.save();
      rectangle(context, x, y, cardWidth, row.height);
      context.fillStyle = placeholder ? '#f8f0f3' : '#fffdfb';
      context.fill();
      context.strokeStyle = placeholder ? '#bf91a6' : '#e6dce1';
      context.lineWidth = placeholder ? 2 : 1;
      if (placeholder) context.setLineDash([8, 7]);
      context.stroke();
      context.setLineDash([]);
      if (image) drawContained(context, image, x + 22, y + 22, cardWidth - 44, imageHeight - 22);
      else {
        context.fillStyle = '#b6859c';
        context.font = `500 23px ${display}`;
        context.textAlign = 'center';
        context.fillText(
          piece.kind === 'missing'
            ? 'НУЖНО ДОБАВИТЬ'
            : piece.kind === 'deleted'
              ? 'ВЕЩЬ УДАЛЕНА'
              : 'БЕЗ ФОТОГРАФИИ',
          x + cardWidth / 2,
          y + imageHeight / 2,
        );
        context.textAlign = 'left';
      }
      context.fillStyle = '#9e5e73';
      context.font = `600 13px ${font}`;
      context.fillText(
        piece.kind === 'missing'
          ? 'ТРЕБУЕТ ПОКУПКИ'
          : piece.kind === 'deleted'
            ? 'ОБНОВИТЕ СОСТАВ'
            : piece.item.available
              ? 'ИЗ ВАШЕГО ГАРДЕРОБА'
              : 'СЕЙЧАС В СТИРКЕ',
        x + 20,
        y + imageHeight + 28,
      );
      context.fillStyle = '#3b2e39';
      context.font = `600 20px ${font}`;
      piece.nameLines.forEach((line, index) =>
        context.fillText(line, x + 20, y + imageHeight + 60 + index * 26),
      );
      context.fillStyle = '#887582';
      context.font = `400 16px ${font}`;
      context.fillText(
        CATEGORIES[piece.item.category] ||
          (piece.kind === 'deleted' ? 'Сохранённая ссылка на вещь' : ''),
        x + 20,
        y + row.height - 22,
      );
      context.restore();
    });
    y += row.height + gap;
  }
  context.strokeStyle = '#dfcbd5';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding, y + 12);
  context.lineTo(canvas.width - padding, y + 12);
  context.stroke();
  context.fillStyle = '#9b7a8b';
  context.font = `400 15px ${font}`;
  context.fillText('MyCloset · Больше любимых сочетаний каждый день.', padding, y + 48);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Не удалось создать PNG. Попробуйте ещё раз.');
  return blob;
}

export async function downloadOutfitPng(options) {
  const blob = await createOutfitPng(options);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const name =
    String(options.outfit.name || 'Мой образ')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .trim()
      .slice(0, 100) || 'Мой образ';
  link.href = url;
  link.download = `${name} — MyCloset.png`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
