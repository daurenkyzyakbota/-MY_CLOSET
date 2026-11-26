'use client';

import { useEffect, useRef, useState } from 'react';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Icon } from '@/components/ui/ui.jsx';
import { compressPhoto } from '@/lib/media/photos.js';

export default function WearPhotoField({ photo, onChange, onProcessingChange }) {
  const input = useRef(null);
  const cameraInput = useRef(null);
  const generation = useRef(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => {
    generation.current++;
  }, []);

  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const ticket = ++generation.current;
    setProcessing(true);
    onProcessingChange(true);
    setError('');
    try {
      const image = await compressPhoto(file);
      if (ticket === generation.current) onChange(image);
    } catch (cause) {
      if (ticket === generation.current)
        setError(cause.message || 'Не удалось подготовить фотографию.');
    } finally {
      if (ticket === generation.current) {
        setProcessing(false);
        onProcessingChange(false);
      }
    }
  }

  return (
    <div className="wear-photo-field">
      <h3>Фото образа</h3>
      <p className="footnote">По желанию. Фото видно только вам.</p>
      {photo && <img className="wear-photo-preview" src={photo} alt="Предпросмотр фото образа" />}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Фотография образа"
        disabled={processing}
        onChange={choose}
        hidden
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="user"
        aria-label="Камера для фото образа"
        disabled={processing}
        onChange={choose}
        hidden
      />
      <div className="wear-photo-actions">
        <AppButton
          className="btn btn-secondary"
          disabled={processing}
          onClick={() => input.current?.click()}
        >
          <Icon name="image" />
          {photo ? 'Выбрать другое фото' : 'Выбрать фото'}
        </AppButton>
        <AppButton
          className="btn btn-secondary wear-photo-camera"
          disabled={processing}
          onClick={() => cameraInput.current?.click()}
        >
          Снять фото
        </AppButton>
        {photo && (
          <AppButton
            className="btn btn-ghost"
            disabled={processing}
            onClick={() => {
              onChange('');
              setError('');
            }}
          >
            Убрать фото
          </AppButton>
        )}
      </div>
      {processing && <p className="footnote" role="status">Подготавливаем фото…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
