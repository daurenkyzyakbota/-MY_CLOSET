export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export async function compressPhoto(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Выберите фотографию JPEG, PNG или WebP.');
  if (file.size > MAX_PHOTO_BYTES) throw new Error('Фотография слишком большая. Максимум — 12 МБ.');
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        if (!image.width || !image.height) throw new Error('Изображение повреждено.');
        const scale = Math.min(1, 1600 / image.width, 1600 / image.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Браузер не может обработать фотографию.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL('image/webp', 0.82);
        if (result.length > 4000000)
          throw new Error('Не удалось уменьшить фото. Выберите другое изображение.');
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось открыть фотографию.'));
    };
    image.src = url;
  });
}
