'use client';

import { AppButton } from '@/components/ui/app-button.jsx';

import { useEffect, useRef, useState } from 'react';
import {
  CATEGORIES,
  COLORS,
  SEASONS,
  SUBCATEGORIES,
  WARMTH_OPTIONS,
  RAINPROOF_OPTIONS,
} from '@/lib/data/model.js';
import { compressPhoto } from '@/lib/media/photos.js';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { ConfirmDialog, Field, Icon, Modal } from '@/components/ui/ui.jsx';
import PhotoEditor from '@/components/forms/photo-editor.jsx';

const blankItem = {
  name: '',
  category: 'top',
  subcategory: '',
  colors: [],
  seasons: [],
  size: '',
  style: '',
  brand: '',
  material: '',
  notes: '',
  purchaseDate: '',
  warmth: 'unknown',
  rainproof: 'unknown',
  photo: '',
  available: true,
  favorite: false,
};

export default function ItemForm({ item, onClose }) {
  const { saveItem, removeItem } = useCloset();
  const [draft, setDraft] = useState(() => ({
    ...blankItem,
    ...item,
    colors: [...(item?.colors || [])],
    seasons: [...(item?.seasons || [])],
  }));
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [photoEditing, setPhotoEditing] = useState(false);
  const photoRequest = useRef(0);
  useEffect(
    () => () => {
      photoRequest.current += 1;
    },
    [],
  );
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const toggle = (key, value) =>
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((entry) => entry !== value)
        : [...current[key], value],
    }));

  async function selectPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const request = ++photoRequest.current;
    setPhotoBusy(true);
    setError('');
    try {
      const photo = await compressPhoto(file);
      if (request === photoRequest.current) set('photo', photo);
    } catch (cause) {
      if (request === photoRequest.current)
        setError(cause.message || 'Не удалось открыть фотографию.');
    } finally {
      if (request === photoRequest.current) setPhotoBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || photoBusy) return;
    setError('');
    if (!draft.name.trim()) {
      setError('Введите название вещи.');
      return;
    }
    if (!draft.colors.length) {
      setError('Выберите хотя бы один цвет.');
      return;
    }
    if (!draft.seasons.length) {
      setError('Выберите хотя бы один сезон.');
      return;
    }
    setSaving(true);
    try {
      await saveItem({
        ...draft,
        name: draft.name.trim(),
        size: draft.size.trim(),
        style: draft.style.trim(),
        brand: draft.brand.trim(),
        material: draft.material.trim(),
        notes: draft.notes.trim(),
      });
      onClose();
    } catch (cause) {
      setError(cause.message || 'Вещь не сохранена. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  if (deleting)
    return (
      <ConfirmDialog
        title="Удалить вещь?"
        description={`«${draft.name}» будет удалена из гардероба. Сохранённые образы останутся, но их состав нужно будет проверить.`}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await removeItem(item.id);
          onClose();
        }}
      />
    );
  if (photoEditing)
    return (
      <PhotoEditor
        photo={draft.photo}
        onClose={() => setPhotoEditing(false)}
        onApply={(photo) => {
          set('photo', photo);
          setPhotoEditing(false);
        }}
      />
    );
  return (
    <Modal
      title={item?.id ? 'Изменить вещь' : 'Новая вещь'}
      description="Расскажите немного о вещи. Поля со звёздочкой обязательны."
      onClose={saving ? () => {} : onClose}
    >
      <form id="item-form" onSubmit={submit}>
        <fieldset disabled={saving} className="form-fieldset">
          <div className="photo-upload">
            <div className="upload-preview">
              {draft.photo ? (
                <img src={draft.photo} alt="Фотография вещи" />
              ) : (
                <Icon name="image" />
              )}
            </div>
            <div className="photo-upload-copy">
              <Field
                label={
                  <>
                    Фотография <span className="optional">необязательно</span>
                  </>
                }
              >
                <input
                  type="file"
                  name="photo"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={selectPhoto}
                  disabled={photoBusy}
                />
              </Field>
              <p className="field-hint">
                JPEG, PNG или WebP, до 12 МБ. Мы уменьшим фото для бережного хранения.
              </p>
              {photoBusy && (
                <p className="field-hint" role="status">
                  Готовим фотографию…
                </p>
              )}
              {draft.photo && (
                <div className="photo-upload-actions">
                  <AppButton
                    type="button"
                    className="button button-secondary"
                    disabled={photoBusy}
                    onClick={() => setPhotoEditing(true)}
                  >
                    <Icon name="edit" />
                    Обработать фото
                  </AppButton>
                  <AppButton
                    type="button"
                    className="button button-ghost"
                    disabled={photoBusy}
                    onClick={() => set('photo', '')}
                  >
                    Удалить фотографию
                  </AppButton>
                </div>
              )}
            </div>
          </div>
          <div className="form-grid">
            <Field label="Название *" className="field-full">
              <input
                name="name"
                required
                maxLength={100}
                autoFocus
                placeholder="Например, любимая белая рубашка"
                value={draft.name}
                onChange={(event) => set('name', event.target.value)}
              />
            </Field>
            <Field label="Категория *">
              <select
                name="category"
                value={draft.category}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    category: event.target.value,
                    subcategory: '',
                  }))
                }
              >
                {Object.entries(CATEGORIES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Размер">
              <input
                name="size"
                maxLength={30}
                placeholder="M, 38, one size…"
                value={draft.size}
                onChange={(event) => set('size', event.target.value)}
              />
            </Field>
            <Field label="Стиль" className="field-full">
              <input
                name="style"
                maxLength={100}
                placeholder="Повседневный, деловой, спортивный…"
                value={draft.style}
                onChange={(event) => set('style', event.target.value)}
              />
            </Field>
          </div>
          <details className="garment-extra">
            <summary>
              Детали вещи <span className="optional">необязательно</span>
            </summary>
            <div className="form-grid">
              <Field label="Тип вещи">
                <select
                  name="subcategory"
                  value={draft.subcategory}
                  onChange={(event) => set('subcategory', event.target.value)}
                >
                  <option value="">Не указан</option>
                  {Object.entries(SUBCATEGORIES[draft.category] || {}).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Бренд">
                <input
                  name="brand"
                  maxLength={100}
                  value={draft.brand}
                  onChange={(event) => set('brand', event.target.value)}
                />
              </Field>
              <Field label="Материал">
                <input
                  name="material"
                  maxLength={100}
                  placeholder="Хлопок, лён, шерсть…"
                  value={draft.material}
                  onChange={(event) => set('material', event.target.value)}
                />
              </Field>
              <Field label="Дата покупки">
                <input
                  name="purchaseDate"
                  type="date"
                  min="1900-01-01"
                  max="2200-12-31"
                  value={draft.purchaseDate}
                  onChange={(event) => set('purchaseDate', event.target.value)}
                />
              </Field>
              <Field label="Моя заметка" className="field-full">
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={1000}
                  placeholder="Посадка, уход или с чем любите носить"
                  value={draft.notes}
                  onChange={(event) => set('notes', event.target.value)}
                />
              </Field>
            </div>
          </details>
          <fieldset className="field form-section">
            <legend>
              Цвета * <span className="field-hint">Можно несколько</span>
            </legend>
            <div className="color-options">
              {Object.entries(COLORS).map(([value, [label, color]]) => (
                <label
                  key={value}
                  className={`color-option${draft.colors.includes(value) ? ' selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    name="color"
                    value={value}
                    checked={draft.colors.includes(value)}
                    onChange={() => toggle('colors', value)}
                  />
                  <span className="color-swatch" style={{ background: color }} aria-hidden="true" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="field form-section">
            <legend>Сезоны *</legend>
            <div className="checkbox-group">
              {Object.entries(SEASONS).map(([value, label]) => (
                <label className="checkbox-row" key={value}>
                  <input
                    type="checkbox"
                    name="seasons"
                    value={value}
                    checked={draft.seasons.includes(value)}
                    onChange={() => toggle('seasons', value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <details className="weather-details">
            <summary>
              Для подбора по погоде <span className="optional">необязательно</span>
            </summary>
            <div className="form-grid">
              <Field label="Теплота">
                <select
                  name="warmth"
                  value={draft.warmth}
                  onChange={(event) => set('warmth', event.target.value)}
                >
                  {Object.entries(WARMTH_OPTIONS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Защита от дождя">
                <select
                  name="rainproof"
                  value={draft.rainproof}
                  onChange={(event) => set('rainproof', event.target.value)}
                >
                  {Object.entries(RAINPROOF_OPTIONS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="field-hint">
              Если свойства неизвестны, оставьте «Не указано». Стилист предупредит об этом.
            </p>
          </details>
          <div className="checkbox-group form-section">
            <label className="checkbox-row">
              <input
                type="checkbox"
                name="available"
                checked={draft.available}
                onChange={(event) => set('available', event.target.checked)}
              />
              Готова к выходу
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                name="favorite"
                checked={draft.favorite}
                onChange={(event) => set('favorite', event.target.checked)}
              />
              В избранном
            </label>
          </div>
          <p className="field-hint">
            Снимите «Готова к выходу», если вещь в стирке или временно недоступна.
          </p>
          {item?.id && (
            <div className="danger-zone">
              <AppButton
                type="button"
                className="button button-danger"
                onClick={() => setDeleting(true)}
              >
                <Icon name="trash" />
                Удалить вещь
              </AppButton>
            </div>
          )}
        </fieldset>
        {error && (
          <p className="notice notice-error form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <AppButton
            type="button"
            className="button button-secondary"
            disabled={saving}
            onClick={onClose}
          >
            Отмена
          </AppButton>
          <AppButton className="button button-primary" type="submit" disabled={saving || photoBusy}>
            <Icon name="check" />
            {saving ? 'Сохраняем…' : 'Сохранить вещь'}
          </AppButton>
        </div>
      </form>
    </Modal>
  );
}
