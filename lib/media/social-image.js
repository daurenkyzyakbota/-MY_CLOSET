export async function socialThumbnail(photo) {
  if (!photo) return '';
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(photo))
    throw new Error('Выберите фото JPG, PNG или WebP.');
  const image = new Image();
  image.src = photo;
  await image.decode();
  let edge = 360;
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, edge / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не разрешил подготовить фото.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', 0.8);
    if (result.length <= 180000) return result;
    edge = Math.round(edge * 0.75);
  }
  throw new Error('Не удалось уменьшить фото для публикации.');
}
