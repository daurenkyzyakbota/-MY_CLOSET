'use client';

import { AppButton } from '@/components/ui/app-button.jsx';

import { useState } from 'react';
import { CATEGORIES, SEASONS, uid } from '@/lib/data/model.js';
import { OCCASIONS, STYLE_OPTIONS } from '@/lib/styling/stylist.js';
import { shoppingDraftFromMissing } from '@/lib/styling/shopping.js';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { ColorDots, ConfirmDialog, Field, Icon, ItemArt, Modal } from '@/components/ui/ui.jsx';
import { ShoppingForm } from '@/components/forms/shopping-form.jsx';

export default function OutfitForm({ outfit, onClose }) {
  const { state, saveOutfit, removeOutfit } = useCloset();
  const [draft, setDraft] = useState(() => ({
    name: '',
    occasion: 'everyday',
    style: '',
    season: '',
    description: '',
    favorite: false,
    ...outfit,
    itemIds: [...(outfit?.itemIds || [])].filter((id) =>
      state.items.some((item) => item.id === id),
    ),
    missingItems: (outfit?.missingItems || []).map((item) => ({
      ...item,
      colors: [...item.colors],
    })),
  }));
  const [replacements, setReplacements] = useState({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [shopping, setShopping] = useState(null);
  const [copyDraft, setCopyDraft] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const persisted = state.outfits.find((item) => item.id === outfit?.id);
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const selected = new Set(draft.itemIds);
  const visible = state.items.filter(
    (item) =>
      (!category || item.category === category) &&
      `${item.name} ${item.style} ${item.brand}`
        .toLocaleLowerCase('ru')
        .includes(query.trim().toLocaleLowerCase('ru')),
  );
  const missingDeleted = (outfit?.itemIds || []).filter(
    (id) => !state.items.some((item) => item.id === id),
  );
  const selectedCount = new Set([...draft.itemIds, ...Object.values(replacements).filter(Boolean)])
    .size;
  function toggle(id) {
    setDraft((current) => ({
      ...current,
      itemIds: current.itemIds.includes(id)
        ? current.itemIds.filter((value) => value !== id)
        : [...current.itemIds, id],
    }));
  }
  function updateMissing(id, key, value) {
    setDraft((current) => ({
      ...current,
      missingItems: current.missingItems.map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    }));
    if (key === 'category') setReplacements((current) => ({ ...current, [id]: '' }));
  }
  function addMissing() {
    if (draft.missingItems.length >= 10) {
      setError('В одном образе может быть до 10 недостающих деталей.');
      return;
    }
    setDraft((current) => ({
      ...current,
      missingItems: [
        ...current.missingItems,
        {
          id: uid(),
          name: '',
          category: 'top',
          colors: [],
          season: current.season,
          style: current.style,
          size: '',
          reason: '',
        },
      ],
    }));
  }
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError('');
    const itemIds = [...draft.itemIds];
    const missingItems = [];
    for (const missing of draft.missingItems) {
      const replacementId = replacements[missing.id];
      if (replacementId) {
        const owned = state.items.find(
          (item) =>
            item.id === replacementId && item.available && item.category === missing.category,
        );
        if (!owned) {
          setError('Для замены выберите доступную вещь той же категории.');
          return;
        }
        itemIds.push(owned.id);
      } else {
        if (!missing.name.trim()) {
          setError('Введите название недостающей детали.');
          return;
        }
        missingItems.push({
          ...missing,
          name: missing.name.trim(),
          size: missing.size.trim(),
          reason: missing.reason.trim(),
        });
      }
    }
    const uniqueIds = [...new Set(itemIds)];
    if (!draft.name.trim()) {
      setError('Введите название образа.');
      return;
    }
    if (!uniqueIds.length && !missingItems.length) {
      setError('Выберите хотя бы одну вещь или добавьте недостающую деталь.');
      return;
    }
    if (uniqueIds.length + missingItems.length > 30) {
      setError('В одном образе может быть не больше 30 деталей.');
      return;
    }
    setSaving(true);
    try {
      await saveOutfit({
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        itemIds: uniqueIds,
        missingItems,
      });
      onClose();
    } catch (cause) {
      setError(cause.message || 'Образ не сохранён. Попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  function copyPersisted() {
    if (!persisted) return;
    setCopyDraft({
      ...persisted,
      id: undefined,
      name: `${persisted.name.slice(0, 90)} — копия`,
      favorite: false,
      createdAt: undefined,
      itemIds: [...persisted.itemIds],
      missingItems: (persisted.missingItems || []).map((item) => ({
        ...item,
        colors: [...item.colors],
      })),
    });
  }
  if (copyDraft) return <OutfitForm outfit={copyDraft} onClose={onClose} />;
  if (confirmDelete)
    return (
      <ConfirmDialog
        title="Удалить образ?"
        description={`«${persisted?.name || outfit?.name || 'Образ'}» и связанные с ним планы в календаре будут удалены. Ваши вещи останутся в гардеробе.`}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await removeOutfit(outfit.id);
          onClose();
        }}
      />
    );
  if (shopping) return <ShoppingForm entry={shopping} onClose={() => setShopping(null)} />;
  return (
    <Modal
      title={outfit?.id ? 'Изменить образ' : 'Собрать образ'}
      description="Сочетайте свои вещи или сохраните идею, которую хочется дополнить."
      onClose={saving ? () => {} : onClose}
    >
      <form id="outfit-form" onSubmit={submit}>
        <fieldset className="form-fieldset" disabled={saving}>
          <div className="form-grid">
            <Field label="Название образа *" className="field-full">
              <input
                name="name"
                required
                autoFocus
                maxLength={100}
                value={draft.name}
                placeholder="Например, прогулка по городу"
                onChange={(event) => set('name', event.target.value)}
              />
            </Field>
            <Field label="Повод">
              <select
                name="occasion"
                value={draft.occasion}
                onChange={(event) => set('occasion', event.target.value)}
              >
                {Object.entries(OCCASIONS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Стиль">
              <select
                name="style"
                value={draft.style === 'any' ? '' : draft.style}
                onChange={(event) => set('style', event.target.value)}
              >
                <option value="">Не указан</option>
                {Object.entries(STYLE_OPTIONS)
                  .filter(([value]) => value !== 'any')
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                {draft.style && draft.style !== 'any' && !STYLE_OPTIONS[draft.style] && (
                  <option value={draft.style}>{draft.style}</option>
                )}
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
            <Field label="Описание" className="field-full">
              <textarea
                name="description"
                rows={3}
                maxLength={500}
                placeholder="Детали, настроение или заметка к образу"
                value={draft.description}
                onChange={(event) => set('description', event.target.value)}
              />
            </Field>
          </div>
          <div className="selection-summary">
            <strong>Ваших вещей: {selectedCount}</strong>
            <span>До 30 деталей в образе</span>
          </div>
          {missingDeleted.length > 0 && (
            <p className="notice">
              Удалённые вещи будут убраны из состава при сохранении. Остальные детали сохранятся.
            </p>
          )}
          {state.items.length ? (
            <section className="form-section">
              <h3>Выберите свои вещи</h3>
              <div className="filters">
                <label className="search-field">
                  <Icon name="search" />
                  <input
                    type="search"
                    aria-label="Найти вещь для образа"
                    placeholder="Найти свою вещь"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <select
                  aria-label="Категория вещи для образа"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="">Все категории</option>
                  {Object.entries(CATEGORIES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="outfit-picker">
                {visible.map((item) => (
                  <label
                    key={item.id}
                    className={`outfit-choice${selected.has(item.id) ? ' selected' : ''}${!item.available ? ' unavailable' : ''}`}
                  >
                    <input
                      type="checkbox"
                      name="itemIds"
                      value={item.id}
                      checked={selected.has(item.id)}
                      disabled={!item.available && !selected.has(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                    <div className="outfit-choice-image">
                      {item.photo ? (
                        <img src={item.photo} alt={item.name} loading="lazy" />
                      ) : (
                        <ItemArt item={item} />
                      )}
                    </div>
                    <strong>{item.name}</strong>
                    <span>{item.available ? CATEGORIES[item.category] : 'В стирке'}</span>
                  </label>
                ))}
              </div>
              {!visible.length && (
                <p className="field-hint">
                  По этому запросу вещей не нашлось. Попробуйте другой запрос.
                </p>
              )}
            </section>
          ) : (
            <p className="notice">
              В гардеробе пока нет вещей. Можно сохранить идею с недостающими деталями и дополнить
              её позже.
            </p>
          )}
          <section className="missing-editor form-section">
            <div className="section-heading">
              <div>
                <h3>Чего не хватает?</h3>
                <p className="field-hint">
                  Эти детали пока не принадлежат вам. Можно убрать их или заменить своей вещью.
                </p>
              </div>
            </div>
            {draft.missingItems.map((missing) => (
              <div className="missing-editor-row" key={missing.id} data-missing-id={missing.id}>
                <div className="missing-editor-actions">
                  <span className="tag">Нужно добавить</span>
                  <AppButton
                    type="button"
                    className="icon-button"
                    aria-label={`Убрать недостающую деталь ${missing.name || ''}`}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        missingItems: current.missingItems.filter((item) => item.id !== missing.id),
                      }))
                    }
                  >
                    <Icon name="close" />
                  </AppButton>
                </div>
                <div className="form-grid">
                  <Field label="Название *" className="field-full">
                    <input
                      maxLength={100}
                      required={!replacements[missing.id]}
                      value={missing.name}
                      onChange={(event) => updateMissing(missing.id, 'name', event.target.value)}
                    />
                  </Field>
                  <Field label="Категория">
                    <select
                      value={missing.category}
                      onChange={(event) =>
                        updateMissing(missing.id, 'category', event.target.value)
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
                      maxLength={30}
                      value={missing.size}
                      onChange={(event) => updateMissing(missing.id, 'size', event.target.value)}
                    />
                  </Field>
                  <Field label="Зачем нужна деталь" className="field-full">
                    <textarea
                      maxLength={500}
                      rows={2}
                      value={missing.reason}
                      onChange={(event) => updateMissing(missing.id, 'reason', event.target.value)}
                    />
                  </Field>
                  <Field label="Заменить своей вещью" className="field-full missing-replacement">
                    <select
                      value={replacements[missing.id] || ''}
                      onChange={(event) =>
                        setReplacements((current) => ({
                          ...current,
                          [missing.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Оставить недостающей</option>
                      {state.items
                        .filter((item) => item.available && item.category === missing.category)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
                {(missing.colors.length > 0 || missing.season || missing.style) && (
                  <div className="missing-meta">
                    <ColorDots colors={missing.colors} />
                    {missing.season && <span className="tag">{SEASONS[missing.season]}</span>}
                    {missing.style && (
                      <span className="tag">{STYLE_OPTIONS[missing.style] || missing.style}</span>
                    )}
                  </div>
                )}
                <AppButton
                  type="button"
                  className="button button-secondary"
                  disabled={!!replacements[missing.id]}
                  onClick={() => {
                    if (!missing.name.trim()) {
                      setError('Введите название недостающей детали перед добавлением в покупки.');
                      return;
                    }
                    setShopping(
                      shoppingDraftFromMissing({ ...missing, name: missing.name.trim() }),
                    );
                  }}
                >
                  <Icon name="shopping" />В покупки
                </AppButton>
              </div>
            ))}
            <AppButton
              type="button"
              className="button button-secondary"
              onClick={addMissing}
              disabled={draft.missingItems.length >= 10}
            >
              <Icon name="plus" />
              Добавить недостающую деталь
            </AppButton>
          </section>
          <label className="checkbox-row form-section">
            <input
              type="checkbox"
              name="favorite"
              checked={draft.favorite}
              onChange={(event) => set('favorite', event.target.checked)}
            />
            Добавить в избранное
          </label>
          {persisted && (
            <div className="danger-zone">
              <AppButton
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={copyPersisted}
              >
                <Icon name="copy" />
                Создать копию
              </AppButton>
              <AppButton
                type="button"
                className="btn btn-danger"
                disabled={saving}
                onClick={() => setConfirmDelete(true)}
              >
                <Icon name="trash" />
                Удалить образ
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
          <AppButton type="submit" className="button button-primary" disabled={saving}>
            <Icon name="check" />
            {saving ? 'Сохраняем…' : 'Сохранить образ'}
          </AppButton>
        </div>
      </form>
    </Modal>
  );
}
