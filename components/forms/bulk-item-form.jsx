'use client';

import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, COLORS, MAX_ITEMS, SEASONS } from '@/lib/data/model.js';
import { MAX_BATCH_PHOTOS, prepareBatchPhotos } from '@/lib/data/bulk-items.js';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Field, Icon, Modal } from '@/components/ui/ui.jsx';

function Choices({ legend, options, selected, onChange }) {
  return (
    <fieldset className="bulk-photo-choices">
      <legend>{legend}</legend>
      <div className="checkbox-group">
        {Object.entries(options).map(([value, label]) => (
          <label className="checkbox-row" key={value}>
            <input type="checkbox" checked={selected.includes(value)} onChange={(event) =>
              onChange(event.target.checked ? [...selected, value] : selected.filter((entry) => entry !== value))
            } />
            {Array.isArray(label) ? label[0] : label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function BulkItemForm({ onClose }) {
  const closet = useCloset();
  const owner = useRef(closet.ownerId);
  const currentOwner = useRef(closet.ownerId);
  currentOwner.current = closet.ownerId;
  const request = useRef(0);
  const mounted = useRef(true);
  const [common, setCommon] = useState({ category: 'top', colors: [], seasons: [] });
  const [rows, setRows] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current++; };
  }, []);

  async function choose(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (files.length > MAX_BATCH_PHOTOS) {
      setError(`Выберите не больше ${MAX_BATCH_PHOTOS} фотографий за один раз.`);
      return;
    }
    const token = ++request.current;
    setError('');
    setRows([]);
    setProcessing(true);
    setProgress({ completed: 0, total: files.length });
    try {
      await prepareBatchPhotos(files, {
        defaults: common,
        shouldAbort: () => !mounted.current || token !== request.current || currentOwner.current !== owner.current,
        onProgress: ({ completed, total, row }) => {
          setRows((previous) => [...previous, row]);
          setProgress({ completed, total });
        },
      });
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
    } finally {
      if (mounted.current && token === request.current) setProcessing(false);
    }
  }

  function changeRow(id, key, value) {
    setRows((previous) => previous.map((row) => row.draft.id === id
      ? { ...row, draft: { ...row.draft, [key]: value } }
      : row));
  }

  async function save(event) {
    event.preventDefault();
    if (saving || processing) return;
    setError('');
    if (owner.current !== closet.ownerId) {
      setError('Аккаунт изменился. Откройте добавление фотографий заново.');
      return;
    }
    if (!rows.length || rows.some((row) => row.error || !row.draft.photo)) {
      setError('Добавьте фотографии и уберите карточки с ошибками.');
      return;
    }
    if (rows.some((row) => !row.draft.name.trim() || !row.draft.colors.length || !row.draft.seasons.length)) {
      setError('У каждой вещи должны быть название, хотя бы один цвет и сезон.');
      return;
    }
    setSaving(true);
    try {
      await closet.addItemsBatch(rows.map((row) => ({ ...row.draft, name: row.draft.name.trim() })), {
        ownerId: owner.current,
      });
      onClose();
    } catch (cause) {
      setError(cause.message || 'Партия не сохранена. Попробуйте ещё раз.');
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <Modal title="Добавить несколько фотографий" description="До 20 вещей за один раз. Проверьте карточки и сохраните их вместе." onClose={saving ? () => {} : onClose}>
      <form onSubmit={save} className="bulk-photo-form">
        <fieldset className="form-fieldset" disabled={saving || processing}>
          <Field label={rows.length ? 'Заменить список фотографий' : 'Выберите фотографии'}>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={choose} />
          </Field>
          <p className="field-hint">JPEG, PNG или WebP, до 12 МБ каждый. Названия взяты из файлов; распознавание одежды не выполняется. До сохранения карточки остаются черновиками.</p>
          <div className="bulk-photo-common">
            <h3>Общие параметры</h3>
            <Field label="Категория">
              <select value={common.category} onChange={(event) => setCommon({ ...common, category: event.target.value })}>
                {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Choices legend="Цвета" options={COLORS} selected={common.colors} onChange={(colors) => setCommon({ ...common, colors })} />
            <Choices legend="Сезоны" options={SEASONS} selected={common.seasons} onChange={(seasons) => setCommon({ ...common, seasons })} />
            <AppButton className="button button-secondary" disabled={!rows.length} onClick={() => setRows((previous) => previous.map((row) => ({
              ...row, draft: { ...row.draft, ...common, subcategory: '', colors: [...common.colors], seasons: [...common.seasons] },
            })))}>
              Применить ко всем карточкам
            </AppButton>
          </div>
          <p className="field-hint">Места в гардеробе: {closet.state.items.length} из {MAX_ITEMS}. В партии: {rows.length}.</p>
          <div className="bulk-photo-list">
            {rows.map(({ draft, error: rowError }) => (
              <article className="bulk-photo-card" key={draft.id}>
                <div className="bulk-photo-preview">
                  {draft.photo ? <img src={draft.photo} alt={draft.name} /> : <Icon name="image" />}
                </div>
                <div className="bulk-photo-card-fields">
                  <Field label="Название вещи *">
                    <input required maxLength={100} value={draft.name} onChange={(event) => changeRow(draft.id, 'name', event.target.value)} />
                  </Field>
                  <p className="field-hint">{CATEGORIES[draft.category]} · цветов: {draft.colors.length} · сезонов: {draft.seasons.length}</p>
                  <details>
                    <summary>Изменить параметры этой вещи</summary>
                    <Field label="Категория">
                      <select value={draft.category} onChange={(event) => changeRow(draft.id, 'category', event.target.value)}>
                        {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </Field>
                    <Choices legend="Цвета" options={COLORS} selected={draft.colors} onChange={(colors) => changeRow(draft.id, 'colors', colors)} />
                    <Choices legend="Сезоны" options={SEASONS} selected={draft.seasons} onChange={(seasons) => changeRow(draft.id, 'seasons', seasons)} />
                  </details>
                  {rowError && <p className="notice notice-error" role="alert">{rowError}</p>}
                  <AppButton className="button button-ghost" onClick={() => setRows((previous) => previous.filter((row) => row.draft.id !== draft.id))}>Убрать карточку</AppButton>
                </div>
              </article>
            ))}
          </div>
        </fieldset>
        {processing && <p className="notice" role="status">Обрабатываем фотографии: {progress.completed} из {progress.total}…</p>}
        {closet.state.items.length + rows.length > MAX_ITEMS && (
          <p className="notice" role="alert">В гардеробе недостаточно места для всей партии. Уберите несколько карточек или сначала освободите место.</p>
        )}
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <div className="form-actions">
          <AppButton className="button button-secondary" disabled={saving} onClick={onClose}>Отмена</AppButton>
          <AppButton className="button button-primary" type="submit" disabled={saving || processing || !rows.length || closet.state.items.length + rows.length > MAX_ITEMS}>
            {saving ? 'Сохраняем…' : `Сохранить все (${rows.length})`}
          </AppButton>
        </div>
      </form>
    </Modal>
  );
}
