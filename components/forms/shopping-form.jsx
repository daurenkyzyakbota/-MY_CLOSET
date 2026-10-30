'use client';

import { useState } from 'react';
import { CATEGORIES, COLORS, SEASONS } from '@/lib/data/model.js';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Field, Modal } from '@/components/ui/ui.jsx';

const normalize = (value) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('ru')
    .replace(/\s+/g, ' ');

export function ShoppingForm({ entry, onClose }) {
  const { state, saveShopping } = useCloset();
  const [draft, setDraft] = useState(() => ({
    name: '',
    category: 'top',
    colors: [],
    season: '',
    style: '',
    size: '',
    budget: null,
    notes: '',
    status: 'planned',
    itemId: '',
    ...entry,
    colors: [...(entry?.colors || [])],
  }));
  const [budget, setBudget] = useState(
    entry?.budget === null || entry?.budget === undefined ? '' : String(entry.budget),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const exists = state.shoppingList.some((item) => item.id === entry?.id);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError('');
    const parsed = budget.trim() === '' ? null : Number(budget);
    if (!draft.name.trim()) {
      setError('Введите название желания.');
      return;
    }
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000000)) {
      setError('Укажите бюджет от 0 до 100 000 000 ₸ или оставьте поле пустым.');
      return;
    }
    const saved = {
      ...draft,
      name: draft.name.trim(),
      size: draft.size.trim(),
      style: draft.style.trim(),
      notes: draft.notes.trim(),
      budget: parsed,
      itemId: draft.status === 'planned' ? '' : draft.itemId,
    };
    const duplicate = state.shoppingList.some(
      (item) =>
        item.id !== saved.id &&
        item.status === 'planned' &&
        saved.status === 'planned' &&
        item.category === saved.category &&
        normalize(item.name) === normalize(saved.name) &&
        normalize(item.size) === normalize(saved.size) &&
        [...item.colors].sort().join(',') === [...saved.colors].sort().join(','),
    );
    if (duplicate) {
      setError('Такое желание уже есть в планах. Измените существующую запись в списке покупок.');
      return;
    }
    setSaving(true);
    try {
      await saveShopping(saved);
      onClose();
    } catch (cause) {
      setError(cause.message || 'Не удалось сохранить желание.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={exists ? 'Изменить желание' : 'Новое желание'}
      description="Сохраните детали, чтобы выбрать подходящую вещь."
      onClose={saving ? () => {} : onClose}
    >
      <form id="shopping-form" onSubmit={submit}>
        <fieldset className="form-fieldset" disabled={saving}>
          <div className="form-grid">
            <Field label="Название *" className="field-full">
              <input
                name="name"
                required
                maxLength={100}
                autoFocus
                placeholder="Например, бежевый тренч"
                value={draft.name}
                onChange={(event) => set('name', event.target.value)}
              />
            </Field>
            <Field label="Категория">
              <select
                name="category"
                value={draft.category}
                onChange={(event) => set('category', event.target.value)}
              >
                {Object.entries(CATEGORIES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Сезон">
              <select
                name="season"
                value={draft.season}
                onChange={(event) => set('season', event.target.value)}
              >
                <option value="">Любой сезон</option>
                {Object.entries(SEASONS).map(([value, label]) => (
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
                value={draft.size}
                onChange={(event) => set('size', event.target.value)}
              />
            </Field>
            <Field label="Стиль">
              <input
                name="style"
                maxLength={100}
                value={draft.style}
                onChange={(event) => set('style', event.target.value)}
              />
            </Field>
            <Field label="Ваш бюджет, ₸">
              <input
                name="budget"
                type="number"
                min="0"
                max="100000000"
                step="any"
                placeholder="Необязательно"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
            </Field>
            <Field label="Статус">
              <select
                name="status"
                value={draft.status}
                onChange={(event) => set('status', event.target.value)}
              >
                <option value="planned">В планах</option>
                <option value="purchased">Куплено</option>
              </select>
            </Field>
          </div>
          <p className="field-hint">Бюджет — ваш личный лимит. Это не цена товара.</p>
          <fieldset className="field form-section">
            <legend>Желаемые цвета</legend>
            <div className="color-options">
              {Object.entries(COLORS).map(([value, [label, color]]) => (
                <label
                  key={value}
                  className={`color-option${draft.colors.includes(value) ? ' selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    name="color"
                    checked={draft.colors.includes(value)}
                    onChange={() =>
                      set(
                        'colors',
                        draft.colors.includes(value)
                          ? draft.colors.filter((item) => item !== value)
                          : [...draft.colors, value],
                      )
                    }
                  />
                  <span className="color-swatch" style={{ background: color }} aria-hidden="true" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Заметка">
            <textarea
              name="notes"
              rows={3}
              maxLength={500}
              placeholder="Материал, посадка или к какому образу нужна вещь"
              value={draft.notes}
              onChange={(event) => set('notes', event.target.value)}
            />
          </Field>
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
            onClick={onClose}
            disabled={saving}
          >
            Отмена
          </AppButton>
          <AppButton type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить желание'}
          </AppButton>
        </div>
      </form>
    </Modal>
  );
}
