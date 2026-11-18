'use client';

import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, COLORS, MAX_ITEMS, SEASONS, SUBCATEGORIES } from '@/lib/data/model.js';
import { MAX_BATCH_PHOTOS, prepareBatchPhotos } from '@/lib/data/bulk-items.js';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Field, Icon, Modal } from '@/components/ui/ui.jsx';
import GarmentPhotoSuggestions, {
  getPhotoSuggestions,
  photoAutofillPatch,
  PHOTO_SUGGESTION_COPY,
} from '@/components/forms/garment-photo-suggestions.jsx';

function applyManualFields(row, patch) {
  const fields = Object.keys(patch);
  const previous = { ...row.previousAutoValues };
  for (const field of fields) delete previous[field];
  return {
    ...row,
    draft: { ...row.draft, ...patch },
    protectedFields: [...new Set([...(row.protectedFields || []), ...fields])],
    previousAutoValues: previous,
  };
}

function applyPhotoResult(row, result) {
  const patch = photoAutofillPatch(row.draft, result, row.protectedFields);
  const previous = { ...row.previousAutoValues };
  for (const [field, value] of Object.entries(patch)) {
    const original = row.draft[field];
    const same = Array.isArray(value)
      ? value.length === original?.length && value.every((entry, index) => entry === original[index])
      : value === original;
    if (!same && !Object.hasOwn(previous, field)) previous[field] = original;
  }
  return {
    ...row,
    draft: { ...row.draft, ...patch },
    previousAutoValues: previous,
    analysis: { result },
  };
}

function undoPhotoResult(row) {
  return Object.keys(row.previousAutoValues || {}).length
    ? applyManualFields(row, row.previousAutoValues)
    : row;
}

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
  const commonEdited = useRef(new Set());
  const [rows, setRows] = useState([]);
  const currentRows = useRef([]);
  const analysisRequest = useRef(null);
  const [analysisProgress, setAnalysisProgress] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const availablePhotos = rows.filter((row) => row.draft.photo);
  const autoFilledCount = availablePhotos.filter(({ previousAutoValues }) =>
    Object.keys(previousAutoValues || {}).length > 0,
  ).length;
  const retryablePhotos = availablePhotos.filter(({ analysis }) =>
    !analysis?.result || analysis.result.categoryUnavailable,
  );
  const hasCommonEdits = commonEdited.current.size > 0;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
      analysisRequest.current?.abort();
    };
  }, []);

  function updateRows(update) {
    const next = update(currentRows.current);
    currentRows.current = next;
    setRows(next);
  }

  function cancelAnalysis() {
    analysisRequest.current?.abort();
    analysisRequest.current = null;
    setAnalysisProgress(null);
    updateRows((previous) => previous.map((row) => {
      if (!row.analysis?.pending) return row;
      return {
        ...row,
        analysis: row.analysis.result ? { result: row.analysis.result } : null,
      };
    }));
  }

  function close() {
    if (saving) return;
    request.current++;
    cancelAnalysis();
    onClose();
  }

  function changeCommon(field, value) {
    commonEdited.current.add(field);
    if (field === 'category') commonEdited.current.add('subcategory');
    setCommon((previous) => ({ ...previous, [field]: value }));
  }

  function applyCommon() {
    const patch = {};
    if (commonEdited.current.has('category')) {
      patch.category = common.category;
      patch.subcategory = '';
    }
    if (commonEdited.current.has('colors')) patch.colors = [...common.colors];
    if (commonEdited.current.has('seasons')) patch.seasons = [...common.seasons];
    updateRows((previous) => previous.map((row) => applyManualFields(row, patch)));
  }

  async function choose(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (files.length > MAX_BATCH_PHOTOS) {
      setError(`Выберите не больше ${MAX_BATCH_PHOTOS} фотографий за один раз.`);
      return;
    }
    const token = ++request.current;
    cancelAnalysis();
    setError('');
    updateRows(() => []);
    setProcessing(true);
    setProgress({ completed: 0, total: files.length });
    const protectedFields = [...commonEdited.current];
    const shouldAbort = () =>
      !mounted.current || token !== request.current || currentOwner.current !== owner.current;
    try {
      await prepareBatchPhotos(files, {
        defaults: common,
        shouldAbort,
        onProgress: ({ completed, total, row }) => {
          updateRows((previous) => [...previous, { ...row, protectedFields }]);
          setProgress({ completed, total });
        },
      });
      if (!shouldAbort()) {
        setProcessing(false);
        void analyzeRows(currentRows.current.filter(({ draft }) => draft.photo));
      }
    } catch (cause) {
      if (!shouldAbort() && cause.name !== 'AbortError') setError(cause.message);
    } finally {
      if (!shouldAbort()) setProcessing(false);
    }
  }

  function changeRow(id, key, value) {
    updateRows((previous) => previous.map((row) => {
      if (row.draft.id !== id) return row;
      // A manually chosen type also fixes its category, so undo cannot make it invalid.
      return applyManualFields(row, key === 'subcategory'
        ? { category: row.draft.category, subcategory: value }
        : { [key]: value });
    }));
  }

  function removeRow(id) {
    if (!currentRows.current.some(({ draft }) => draft.photo && draft.id !== id)) cancelAnalysis();
    updateRows((previous) => previous.filter((row) => row.draft.id !== id));
  }

  function applyCategory(id, category) {
    updateRows((previous) => previous.map((row) => {
      if (row.draft.id !== id) return row;
      return applyManualFields(row, {
        category,
        subcategory: row.draft.category === category ? row.draft.subcategory : '',
      });
    }));
  }

  function applyType(id, { category, subcategory }) {
    updateRows((previous) => previous.map((row) => row.draft.id === id
      ? applyManualFields(row, { category, subcategory })
      : row,
    ));
  }

  function toggleSuggestedColor(id, value) {
    updateRows((previous) => previous.map((row) => {
      if (row.draft.id !== id) return row;
      const colors = row.draft.colors;
      return applyManualFields(row, {
        colors: colors.includes(value)
          ? colors.filter((color) => color !== value)
          : [...colors, value],
      });
    }));
  }

  function undoAutofill(id) {
    updateRows((previous) => previous.map((row) => !id || row.draft.id === id
      ? undoPhotoResult(row)
      : row,
    ));
  }

  async function analyzeRows(targets) {
    if (!targets.length || analysisRequest.current || saving || !mounted.current ||
        currentOwner.current !== owner.current) return;
    const controller = new AbortController();
    analysisRequest.current = controller;
    const current = () =>
      mounted.current &&
      analysisRequest.current === controller &&
      !controller.signal.aborted &&
      currentOwner.current === owner.current;
    const total = targets.length;
    setAnalysisProgress({ completed: 0, total });
    try {
      for (const [index, target] of targets.entries()) {
        if (!current()) return;
        const { id, photo } = target.draft;
        const matches = (row) => row.draft.id === id && row.draft.photo === photo;
        if (currentRows.current.some(matches)) {
          const updateAnalysis = (update) => {
            if (!current()) return;
            updateRows((previous) => previous.map((row) => matches(row) ? update(row) : row));
          };
          const pending = (stage) => updateAnalysis((row) => ({
            ...row, analysis: { ...row.analysis, pending: true, stage },
          }));
          pending();
          try {
            const result = await getPhotoSuggestions(photo, {
              signal: controller.signal,
              onProgress: pending,
            });
            updateAnalysis((row) => applyPhotoResult(row, result));
          } catch (cause) {
            if (cause.name !== 'AbortError') updateAnalysis((row) => ({
              ...row, analysis: { ...row.analysis, pending: false, failed: true },
            }));
          }
        }
        if (current() && total > 1) setAnalysisProgress({ completed: index + 1, total });
      }
    } finally {
      if (current()) {
        analysisRequest.current = null;
        setAnalysisProgress(null);
      }
    }
  }

  async function save(event) {
    event.preventDefault();
    if (saving || processing) return;
    setError('');
    if (owner.current !== closet.ownerId) {
      setError('Аккаунт изменился. Откройте добавление фотографий заново.');
      return;
    }
    const savingRows = currentRows.current;
    if (!savingRows.length || savingRows.some((row) => row.error || !row.draft.photo)) {
      setError('Добавьте фотографии и уберите карточки с ошибками.');
      return;
    }
    if (savingRows.some((row) => !row.draft.name.trim() || !row.draft.colors.length || !row.draft.seasons.length)) {
      setError('У каждой вещи должны быть название, хотя бы один цвет и сезон.');
      return;
    }
    cancelAnalysis();
    setSaving(true);
    try {
      await closet.addItemsBatch(savingRows.map((row) => ({ ...row.draft, name: row.draft.name.trim() })), {
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
    <Modal title="Добавить несколько фотографий" description="До 20 вещей за один раз. Проверьте карточки и сохраните их вместе." onClose={close}>
      <form onSubmit={save} className="bulk-photo-form">
        <fieldset className="form-fieldset" disabled={saving || processing}>
          <Field label={rows.length ? 'Заменить список фотографий' : 'Выберите фотографии'}>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={choose} />
          </Field>
          <p className="field-hint">JPEG, PNG или WebP, до 12 МБ каждый. После загрузки фото заполнятся распознанные поля. Сезоны выберите сами.</p>
          {availablePhotos.length > 0 && (
            <div className="garment-suggestion-batch">
              <p className="field-hint">{PHOTO_SUGGESTION_COPY}</p>
              {analysisProgress && (
                <p className="field-hint" role="status">
                  Проверено фото: {analysisProgress.completed} из {analysisProgress.total}.
                </p>
              )}
              {!analysisProgress && autoFilledCount > 0 && (
                <p className="field-hint" role="status">
                  Автозаполнение применено к {autoFilledCount} из {availablePhotos.length} карточек. Проверьте поля перед сохранением.
                </p>
              )}
              <div className="garment-suggestion-actions">
                {analysisProgress ? (
                  <AppButton className="button button-ghost" onClick={cancelAnalysis}>
                    Отменить анализ
                  </AppButton>
                ) : retryablePhotos.length > 0 && (
                  <AppButton
                    className="button button-secondary"
                    onClick={() => analyzeRows(retryablePhotos)}
                  >
                    <Icon name="sparkle" />
                    Повторить анализ фото
                  </AppButton>
                )}
                {!analysisProgress && autoFilledCount > 0 && (
                  <AppButton className="button button-ghost" onClick={() => undoAutofill()}>
                    Отменить автозаполнение партии
                  </AppButton>
                )}
              </div>
            </div>
          )}
          <div className="bulk-photo-common">
            <h3>Общие параметры</h3>
            <Field label="Категория">
              <select value={common.category} onChange={(event) => changeCommon('category', event.target.value)}>
                {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Choices legend="Цвета" options={COLORS} selected={common.colors} onChange={(colors) => changeCommon('colors', colors)} />
            <Choices legend="Сезоны" options={SEASONS} selected={common.seasons} onChange={(seasons) => changeCommon('seasons', seasons)} />
            <AppButton
              className="button button-secondary"
              disabled={!rows.length || !hasCommonEdits}
              onClick={applyCommon}
            >
              Применить ко всем карточкам
            </AppButton>
          </div>
          <p className="field-hint">Места в гардеробе: {closet.state.items.length} из {MAX_ITEMS}. В партии: {rows.length}.</p>
          <div className="bulk-photo-list">
            {rows.map(({ draft, analysis, previousAutoValues, error: rowError }) => (
              <article className="bulk-photo-card" key={draft.id}>
                <div className="bulk-photo-preview">
                  {draft.photo ? <img src={draft.photo} alt={draft.name} /> : <Icon name="image" />}
                </div>
                <div className="bulk-photo-card-fields">
                  <Field label="Название вещи *">
                    <input
                      required
                      maxLength={100}
                      value={draft.name}
                      onChange={(event) => changeRow(draft.id, 'name', event.target.value)}
                    />
                  </Field>
                  <p className="field-hint">
                    {SUBCATEGORIES[draft.category]?.[draft.subcategory] || CATEGORIES[draft.category]} · цветов: {draft.colors.length} · сезонов: {draft.seasons.length}
                  </p>
                </div>
                <div className="bulk-photo-review">
                  {draft.photo && (
                    <GarmentPhotoSuggestions
                      compact
                      draft={draft}
                      analysis={analysis}
                      autoApplied={Object.keys(previousAutoValues || {})}
                      disabled={!!analysisProgress}
                      onAnalyze={() => analyzeRows([{ draft }])}
                      onUndo={() => undoAutofill(draft.id)}
                      onCategory={(category) => applyCategory(draft.id, category)}
                      onType={(type) => applyType(draft.id, type)}
                      onColor={(color) => toggleSuggestedColor(draft.id, color)}
                      onName={(name) => changeRow(draft.id, 'name', name)}
                    />
                  )}
                  <details>
                    <summary>Изменить параметры этой вещи</summary>
                    <Field label="Категория">
                      <select
                        value={draft.category}
                        onChange={(event) => applyCategory(draft.id, event.target.value)}
                      >
                        {Object.entries(CATEGORIES).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Тип вещи">
                      <select
                        value={draft.subcategory}
                        onChange={(event) => changeRow(draft.id, 'subcategory', event.target.value)}
                      >
                        <option value="">Не выбран</option>
                        {Object.entries(SUBCATEGORIES[draft.category] || {}).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </Field>
                    <Choices
                      legend="Цвета"
                      options={COLORS}
                      selected={draft.colors}
                      onChange={(colors) => changeRow(draft.id, 'colors', colors)}
                    />
                    <Choices
                      legend="Сезоны"
                      options={SEASONS}
                      selected={draft.seasons}
                      onChange={(seasons) => changeRow(draft.id, 'seasons', seasons)}
                    />
                  </details>
                  {rowError && <p className="notice notice-error" role="alert">{rowError}</p>}
                  <AppButton
                    className="button button-ghost"
                    onClick={() => removeRow(draft.id)}
                  >
                    Убрать карточку
                  </AppButton>
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
          <AppButton className="button button-secondary" disabled={saving} onClick={close}>Отмена</AppButton>
          <AppButton className="button button-primary" type="submit" disabled={saving || processing || !rows.length || closet.state.items.length + rows.length > MAX_ITEMS}>
            {saving ? 'Сохраняем…' : `Сохранить все (${rows.length})`}
          </AppButton>
        </div>
      </form>
    </Modal>
  );
}
