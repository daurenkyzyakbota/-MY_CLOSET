'use client';

import { AppButton } from '@/components/ui/app-button.jsx';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CATEGORIES,
  COLORS,
  SEASONS,
  categoryCounts,
  filterItems,
  sortItems,
} from '@/lib/data/model.js';
import { STYLE_OPTIONS } from '@/lib/styling/stylist.js';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { EmptyState, Icon, Loading, PageHeader } from '@/components/ui/ui.jsx';
import ItemCard from '@/components/cards/item-card.jsx';
import ItemForm from '@/components/forms/item-form.jsx';
import {
  LIST_PREFERENCE_KEYS,
  WARDROBE_PREFERENCES,
  sanitizeWardrobePreferences,
  wardrobeUrlOverrides,
  withoutWardrobeUrlFilters,
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
  return (
    <Suspense fallback={<Loading />}>
      <WardrobeList />
    </Suspense>
  );
}

function WardrobeList() {
  const search = useSearchParams().toString();
  const { state, ready } = useCloset();
  const [editing, setEditing] = useState(null);
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
    storageKey: LIST_PREFERENCE_KEYS.wardrobe,
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
  const active = Object.entries(filters).some(([key, value]) =>
    key === 'sort' ? value !== 'newest' : Boolean(value),
  );
  const update = (key, value) => {
    if (key === 'query' || key === 'category') clearUrlFilters([key]);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  function reset() {
    clearUrlFilters();
    setFilters(WARDROBE_PREFERENCES);
  }
  if (!ready || !restored) return <Loading />;
  return (
    <section className="wardrobe-page">
      <PageHeader
        title="Мой гардероб"
        description="Любимые вещи. Удобный порядок. Больше удачных сочетаний."
      />
      <div className="wardrobe-chips" role="group" aria-label="Категории гардероба">
        {[['', 'Все вещи'], ...Object.entries(CATEGORIES)].map(([key, label]) => (
          <AppButton
            key={key}
            type="button"
            className={`wardrobe-chip${filters.category === key ? ' is-active' : ''}`}
            aria-pressed={filters.category === key}
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
            onChange={(event) => update('query', event.target.value)}
          />
          {filters.query && (
            <AppButton
              className="search-clear"
              aria-label="Очистить поиск вещей"
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
            onChange={(event) => update('sort', event.target.value)}
          >
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала добавленные</option>
            <option value="name">По названию</option>
            <option value="favorites">Сначала любимые</option>
          </select>
          {active && (
            <AppButton type="button" className="button button-ghost" onClick={reset}>
              Сбросить фильтры
            </AppButton>
          )}
        </div>
      </div>
      {results.length ? (
        <div className="card-grid">
          {results.map((item) => (
            <ItemCard key={item.id} item={item} onEdit={setEditing} />
          ))}
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
    </section>
  );
}
