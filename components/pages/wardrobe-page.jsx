'use client';

import { AppButton } from '@/components/ui/app-button.jsx';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Checkbox from '@mui/material/Checkbox';
import { useSearchParams } from 'next/navigation';
import {
  CATEGORIES,
  COLORS,
  SEASONS,
  categoryCounts,
  filterItems,
  sortItems,
  localDate,
} from '@/lib/data/model.js';
import { BATCH_ITEM_ACTIONS } from '@/lib/data/item-actions.js';
import { createWardrobeCsv } from '@/lib/data/wardrobe-csv.js';
import { STYLE_OPTIONS } from '@/lib/styling/stylist.js';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { ConfirmDialog, EmptyState, Icon, Loading, PageHeader } from '@/components/ui/ui.jsx';
import ItemCard from '@/components/cards/item-card.jsx';
import ItemForm from '@/components/forms/item-form.jsx';
import {
  LIST_PREFERENCE_KEYS,
  WARDROBE_PREFERENCES,
  sanitizeWardrobePreferences,
  wardrobeUrlOverrides,
  withoutWardrobeUrlFilters,
  scopedListPreferenceKey,
} from '@/lib/data/list-preferences.js';
import { useListPreferences } from '@/components/hooks/use-list-preferences.js';

const readUrlFilters = () => wardrobeUrlOverrides(window.location.search);
function clearUrlFilters(fields) {
  try {
    const next = withoutWardrobeUrlFilters(window.location.href, fields);
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', next);
    }
  } catch {
    /* A restricted history API does not prevent changing the list. */
  }
}
const quantity = (n) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'вещь' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'вещи' : 'вещей'}`;
export default function WardrobePage() {
  const { ownerId } = useCloset();
  return (
    <Suspense fallback={<Loading />}>
      <WardrobeList key={ownerId || 'guest'} />
    </Suspense>
  );
}

function WardrobeList() {
  const search = useSearchParams().toString();
  const { state, ready, ownerId, batchItems, notify } = useCloset();
  const [editing, setEditing] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState([]);
  const [batchAction, setBatchAction] = useState('favorite');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);
  const batchFlight = useRef(false);
  const items = state.items;
  const counts = useMemo(() => categoryCounts(items), [items]);
  const styles = useMemo(
    () =>
      [...new Set(items.map((item) => item.style.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'ru'),
      ),
    [items],
  );
  const sanitize = useCallback((value) => sanitizeWardrobePreferences(value, styles), [styles]);
  const [filters, setFilters, restored] = useListPreferences({
    storageKey: scopedListPreferenceKey(LIST_PREFERENCE_KEYS.wardrobe, ownerId),
    enabled: ready,
    defaults: WARDROBE_PREFERENCES,
    sanitize,
    readOverrides: readUrlFilters,
  });
  useEffect(() => {
    if (restored) setFilters((current) => ({ ...current, ...wardrobeUrlOverrides(search) }));
  }, [restored, search, setFilters]);
  const sort = filters.sort;
  const results = useMemo(
    () => sortItems(filterItems(items, filters), sort),
    [items, filters, sort],
  );
  const visibleIds = useMemo(() => new Set(results.map((item) => item.id)), [results]);
  const selectedIds = selected.filter((id) => visibleIds.has(id));
  const selectedSet = new Set(selectedIds);
  useEffect(() => {
    setSelected((current) => {
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [visibleIds]);
  const active = Object.entries(filters).some(([key, value]) =>
    key === 'sort' ? value !== 'newest' : Boolean(value),
  );
  const update = (key, value) => {
    if (['query', 'category', 'availability'].includes(key)) clearUrlFilters([key]);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  function reset() {
    clearUrlFilters();
    setFilters(WARDROBE_PREFERENCES);
  }
  function toggleSelection() {
    if (batchFlight.current) return;
    setSelecting((value) => !value);
    setSelected([]);
    setBatchAction('favorite');
    setError('');
  }
  function selectItem(id, checked) {
    setSelected((current) =>
      checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
    );
  }
  async function performBatch(action, ids = selectedIds, expectedOwner = ownerId) {
    if (batchFlight.current) throw new Error('Дождитесь завершения текущего действия.');
    batchFlight.current = true;
    setBusy(action);
    setError('');
    try {
      await batchItems(ids, action, { ownerId: expectedOwner });
      setSelected([]);
    } catch (cause) {
      if (cause.name !== 'AbortError')
        setError(cause.message || 'Не удалось изменить выбранные вещи.');
      throw cause;
    } finally {
      batchFlight.current = false;
      setBusy('');
    }
  }
  function applySelected() {
    if (!selectedIds.length || batchFlight.current) return;
    if (batchAction === 'delete') setDeleting({ ids: [...selectedIds], ownerId });
    else void performBatch(batchAction).catch(() => {});
  }
  function downloadCsv() {
    setError('');
    try {
      const csv = createWardrobeCsv(
        state,
        results.map((item) => item.id),
      );
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `MyCloset-wardrobe-${localDate()}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Таблица найденных вещей подготовлена к скачиванию.');
    } catch (cause) {
      setError(cause.message || 'Не удалось подготовить таблицу.');
    }
  }
  if (!ready || !restored) return <Loading />;
  return (
    <section className="wardrobe-page">
      <PageHeader
        title="Мой гардероб"
        description="Любимые вещи. Удобный порядок. Больше удачных сочетаний."
      >
        {(items.length > 0 || selecting) && (
          <>
            <AppButton
              className="btn btn-secondary"
              disabled={!!busy || !results.length}
              title={`CSV: все найденные вещи (${results.length}), без фотографий`}
              onClick={downloadCsv}
            >
              <Icon name="download" />
              Скачать таблицу
            </AppButton>
            <AppButton
              className={`btn ${selecting ? 'btn-primary' : 'btn-secondary'}`}
              aria-pressed={selecting}
              disabled={!!busy}
              onClick={toggleSelection}
            >
              {selecting ? 'Завершить выбор' : 'Выбрать несколько'}
            </AppButton>
          </>
        )}
      </PageHeader>
      {selecting && (
        <div
          className="wardrobe-batch-panel"
          role="group"
          aria-label="Действия с выбранными вещами"
          aria-busy={!!busy}
        >
          <div className="wardrobe-batch-summary">
            <label className="wardrobe-select-all">
              <Checkbox
                checked={!!results.length && selectedIds.length === results.length}
                indeterminate={selectedIds.length > 0 && selectedIds.length < results.length}
                disabled={!!busy || !results.length}
                onChange={(event) =>
                  setSelected(event.target.checked ? results.map((item) => item.id) : [])
                }
                slotProps={{ input: { 'aria-label': 'Выбрать все найденные вещи' } }}
              />
              Все найденные
            </label>
            <span role="status">
              Выбрано: {selectedIds.length} из {results.length}
            </span>
            <AppButton
              className="btn btn-ghost"
              disabled={!!busy || !selectedIds.length}
              onClick={() => setSelected([])}
            >
              Снять выбор
            </AppButton>
          </div>
          <div className="wardrobe-batch-controls">
            <label className="sr-only" htmlFor="wardrobe-batch-action">
              Действие с выбранными вещами
            </label>
            <select
              id="wardrobe-batch-action"
              value={batchAction}
              disabled={!!busy}
              onChange={(event) => setBatchAction(event.target.value)}
            >
              {Object.entries(BATCH_ITEM_ACTIONS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <AppButton
              className={`btn ${batchAction === 'delete' ? 'btn-danger' : 'btn-primary'}`}
              disabled={!!busy || !selectedIds.length}
              onClick={applySelected}
            >
              {busy ? 'Сохраняем…' : batchAction === 'delete' ? 'Удалить выбранные' : 'Применить'}
            </AppButton>
          </div>
          <p className="footnote">
            Выбор действует только на вещи, которые сейчас найдены. При изменении фильтров скрытые
            вещи исключаются.
          </p>
        </div>
      )}
      <div className="wardrobe-chips" role="group" aria-label="Категории гардероба">
        {[['', 'Все вещи'], ...Object.entries(CATEGORIES)].map(([key, label]) => (
          <AppButton
            key={key}
            type="button"
            className={`wardrobe-chip${filters.category === key ? ' is-active' : ''}`}
            aria-pressed={filters.category === key}
            disabled={!!busy}
            onClick={() => update('category', key)}
          >
            <span>{label}</span>
            <span className="chip-count">{key ? counts[key] : items.length}</span>
          </AppButton>
        ))}
      </div>
      <div className="filters wardrobe-toolbar">
        <label className="search-field">
          <Icon name="search" />
          <input
            className="search-input"
            id="wardrobe-search"
            type="search"
            maxLength={200}
            placeholder="Вещь, бренд, материал или стиль"
            aria-label="Поиск вещей"
            value={filters.query}
            disabled={!!busy}
            onChange={(event) => update('query', event.target.value)}
          />
          {filters.query && (
            <AppButton
              className="search-clear"
              aria-label="Очистить поиск вещей"
              disabled={!!busy}
              onClick={(event) => {
                event.preventDefault();
                update('query', '');
                document.getElementById('wardrobe-search')?.focus();
              }}
            >
              <Icon name="close" />
            </AppButton>
          )}
        </label>
        <select
          aria-label="Цвет"
          value={filters.color}
          disabled={!!busy}
          onChange={(event) => update('color', event.target.value)}
        >
          <option value="">Все цвета</option>
          {Object.entries(COLORS).map(([key, [label]]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Сезон"
          value={filters.season}
          disabled={!!busy}
          onChange={(event) => update('season', event.target.value)}
        >
          <option value="">Все сезоны</option>
          {Object.entries(SEASONS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Доступность"
          value={filters.availability}
          disabled={!!busy}
          onChange={(event) => update('availability', event.target.value)}
        >
          <option value="">Все вещи</option>
          <option value="available">Готовы к выходу</option>
          <option value="laundry">В стирке</option>
        </select>
        <select
          className="wardrobe-style-filter"
          aria-label="Стиль"
          value={filters.style}
          disabled={!!busy}
          onChange={(event) => update('style', event.target.value)}
        >
          <option value="">Все стили</option>
          {styles.map((style) => (
            <option key={style} value={style}>
              {STYLE_OPTIONS[style] || style}
            </option>
          ))}
        </select>
      </div>
      <div className="results-line">
        <span role="status">
          {quantity(results.length)}
          {active ? ` из ${items.length}` : ''}
        </span>
        <div className="wardrobe-sort">
          <label htmlFor="wardrobe-sort">Порядок</label>
          <select
            id="wardrobe-sort"
            aria-label="Сортировка вещей"
            value={sort}
            disabled={!!busy}
            onChange={(event) => update('sort', event.target.value)}
          >
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала добавленные</option>
            <option value="name">По названию</option>
            <option value="favorites">Сначала любимые</option>
          </select>
          {active && (
            <AppButton
              type="button"
              className="button button-ghost"
              onClick={reset}
              disabled={!!busy}
            >
              Сбросить фильтры
            </AppButton>
          )}
        </div>
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {results.length ? (
        <div
          className={`card-grid${selecting ? ' wardrobe-selection-grid' : ''}`}
          aria-busy={!!busy}
        >
          {results.map((item) =>
            selecting ? (
              <div
                key={item.id}
                className={`wardrobe-selectable-item${selectedSet.has(item.id) ? ' is-selected' : ''}`}
                inert={busy ? true : undefined}
              >
                <label className="wardrobe-item-select" title={`Выбрать: ${item.name}`}>
                  <Checkbox
                    checked={selectedSet.has(item.id)}
                    disabled={!!busy}
                    onChange={(event) => selectItem(item.id, event.target.checked)}
                    slotProps={{ input: { 'aria-label': `Выбрать вещь: ${item.name}` } }}
                  />
                  <span className="sr-only">{item.name}</span>
                </label>
                <ItemCard item={item} onEdit={setEditing} />
              </div>
            ) : (
              <ItemCard key={item.id} item={item} onEdit={setEditing} />
            ),
          )}
        </div>
      ) : items.length ? (
        <EmptyState
          icon="search"
          title="Ничего не нашлось"
          description="Попробуйте другой запрос или сбросьте фильтры."
        >
          <AppButton className="button button-primary" onClick={reset}>
            Сбросить фильтры
          </AppButton>
        </EmptyState>
      ) : (
        <EmptyState
          icon="wardrobe"
          title="Ваш гардероб начинается здесь"
          description="Добавьте любимую футболку, удобные джинсы или пару обуви."
        >
          <AppButton className="button button-primary" onClick={() => setEditing({})}>
            <Icon name="plus" />
            Добавить вещь
          </AppButton>
        </EmptyState>
      )}
      {editing && (
        <ItemForm key={editing.id || 'new-item'} item={editing} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Удалить выбранные вещи (${deleting.ids.length})?`}
          description="Вещи будут удалены из этого гардероба. Ссылки в образах, календаре, истории, капсулах и поездках сохранятся; недостающие вещи будут отмечены. Это действие нельзя отменить — при необходимости сначала сохраните резервную копию."
          onClose={() => {
            if (!batchFlight.current) setDeleting(null);
          }}
          onConfirm={() => performBatch('delete', deleting.ids, deleting.ownerId)}
        />
      )}
    </section>
  );
}
