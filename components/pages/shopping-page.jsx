'use client';

import { AppButton } from '@/components/ui/app-button.jsx';

import { useMemo, useState } from 'react';
import { CATEGORIES, COLORS, SEASONS } from '@/lib/data/model.js';
import { STYLE_OPTIONS } from '@/lib/styling/stylist.js';
import { createStoreSearchLinks } from '@/lib/styling/shopping.js';
import { filterShoppingList, SHOPPING_SORTS } from '@/lib/styling/shopping-filters.js';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import {
  ConfirmDialog,
  EmptyState,
  Icon,
  ItemArt,
  Loading,
  PageHeader,
} from '@/components/ui/ui.jsx';
import ItemForm from '@/components/forms/item-form.jsx';
import { ShoppingForm } from '@/components/forms/shopping-form.jsx';
import {
  LIST_PREFERENCE_KEYS,
  SHOPPING_PREFERENCES,
  sanitizeShoppingPreferences,
} from '@/lib/data/list-preferences.js';
import { useListPreferences } from '@/components/hooks/use-list-preferences.js';

const money = (value) =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} ₸`;
const normalize = (value) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('ru')
    .replace(/\s+/g, ' ');

export default function ShoppingPage() {
  const { state, ready, saveShopping, removeShopping, purchaseShopping } = useCloset();
  const [filters, setFilters, restored] = useListPreferences({
    storageKey: LIST_PREFERENCE_KEYS.shopping,
    enabled: ready,
    defaults: SHOPPING_PREFERENCES,
    sanitize: sanitizeShoppingPreferences,
  });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [garment, setGarment] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const list = useMemo(
    () => filterShoppingList(state.shoppingList, filters),
    [state.shoppingList, filters],
  );
  const planned = state.shoppingList.filter((item) => item.status === 'planned');
  const budgeted = planned.filter((item) => item.budget !== null);
  const total = budgeted.reduce((sum, item) => sum + item.budget, 0);
  const statusCount = state.shoppingList.filter(
    (item) => filters.status === 'all' || item.status === filters.status,
  ).length;
  const active = !!filters.query.trim() || !!filters.category || filters.sort !== 'newest';
  const narrowed = !!filters.query.trim() || !!filters.category;
  const reset = () =>
    setFilters((current) => ({ ...current, query: '', category: '', sort: 'newest' }));
  async function status(item) {
    if (busy) return;
    setBusy(item.id);
    setError('');
    try {
      if (item.status === 'planned') await purchaseShopping(item.id);
      else {
        const duplicate = state.shoppingList.some(
          (entry) =>
            entry.id !== item.id &&
            entry.status === 'planned' &&
            entry.category === item.category &&
            normalize(entry.name) === normalize(item.name) &&
            normalize(entry.size) === normalize(item.size) &&
            [...entry.colors].sort().join(',') === [...item.colors].sort().join(','),
        );
        if (duplicate)
          throw new Error('Такое желание уже есть в планах. Измените существующую запись.');
        await saveShopping({ ...item, status: 'planned', itemId: '' });
      }
    } catch (cause) {
      setError(cause.message || 'Не удалось изменить статус покупки.');
    } finally {
      setBusy('');
    }
  }
  function addGarment(entry) {
    setGarment({
      name: entry.name,
      category: entry.category,
      colors: [...entry.colors],
      seasons: entry.season ? [entry.season] : [],
      size: entry.size,
      style: entry.style,
      shoppingId: entry.id,
    });
  }
  if (!ready || !restored) return <Loading />;
  return (
    <>
      <PageHeader
        title="Хочу в свой гардероб"
        description="Продуманные покупки для ваших любимых образов."
      >
        <AppButton type="button" className="btn btn-primary" onClick={() => setEditing({})}>
          <Icon name="plus" />
          Добавить желание
        </AppButton>
      </PageHeader>
      <div className="shopping-toolbar">
        <div className="shopping-tabs" role="group" aria-label="Показать покупки">
          {[
            ['planned', 'В планах'],
            ['purchased', 'Куплено'],
            ['all', 'Все'],
          ].map(([value, label]) => (
            <AppButton
              type="button"
              className={filters.status === value ? 'is-active' : ''}
              aria-pressed={filters.status === value}
              key={value}
              onClick={() => setFilters((current) => ({ ...current, status: value }))}
            >
              {label}
              <span>
                {
                  state.shoppingList.filter((item) => value === 'all' || item.status === value)
                    .length
                }
              </span>
            </AppButton>
          ))}
        </div>
        {budgeted.length > 0 && (
          <p className="shopping-total">
            Запланированный бюджет: <strong>{money(total)}</strong>
            <span>
              Сумма ваших лимитов · {budgeted.length} из {planned.length} покупок
            </span>
          </p>
        )}
      </div>
      <p className="footnote shopping-intro">
        Здесь ваши желания и бюджет, который вы указали сами. Ссылки ведут на поиск в магазинах;
        реальные товары и цены сайт не загружает.
      </p>
      {state.shoppingList.length > 0 && (
        <>
          <div className="filters shopping-filters">
            <label className="search-field">
              <Icon name="search" />
              <input
                id="shopping-search"
                className="search-input"
                type="search"
                maxLength={120}
                placeholder="Название, заметка или размер"
                aria-label="Поиск в покупках"
                value={filters.query}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, query: event.target.value }))
                }
              />
              {filters.query && (
                <AppButton
                  className="search-clear"
                  aria-label="Очистить поиск покупок"
                  onClick={(event) => {
                    event.preventDefault();
                    setFilters((current) => ({ ...current, query: '' }));
                    document.getElementById('shopping-search')?.focus();
                  }}
                >
                  <Icon name="close" />
                </AppButton>
              )}
            </label>
            <select
              aria-label="Категория покупки"
              value={filters.category}
              onChange={(event) =>
                setFilters((current) => ({ ...current, category: event.target.value }))
              }
            >
              <option value="">Все категории</option>
              {Object.entries(CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Порядок покупок"
              value={filters.sort}
              onChange={(event) =>
                setFilters((current) => ({ ...current, sort: event.target.value }))
              }
            >
              {Object.entries(SHOPPING_SORTS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="shopping-results-line">
            <span className="shopping-result-count" role="status">
              Найдено: {list.length} из {statusCount}
            </span>
            {active && (
              <AppButton type="button" className="btn btn-ghost" onClick={reset}>
                Сбросить фильтры
              </AppButton>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {list.length ? (
        <div className="shopping-grid">
          {list.map((entry) => {
            const owned = state.items.some((item) => item.id === entry.itemId);
            const links = createStoreSearchLinks(entry);
            return (
              <article className="shopping-card" data-shopping-id={entry.id} key={entry.id}>
                <div className="shopping-card-header">
                  <div className="shopping-illustration" aria-hidden="true">
                    <ItemArt item={entry} />
                  </div>
                  <span
                    className={`shopping-status${entry.status === 'purchased' ? ' is-purchased' : ''}`}
                  >
                    {entry.status === 'purchased' ? 'Куплено' : 'В планах'}
                  </span>
                </div>
                <div className="shopping-card-body">
                  <p className="eyebrow">{CATEGORIES[entry.category]}</p>
                  <h3>{entry.name}</h3>
                  <div className="shopping-meta tag-row">
                    {entry.colors.map((color) => (
                      <span
                        className="color-dot"
                        key={color}
                        title={COLORS[color][0]}
                        style={{ background: COLORS[color][1] }}
                      >
                        <span className="sr-only">{COLORS[color][0]}</span>
                      </span>
                    ))}
                    {[
                      entry.season ? SEASONS[entry.season] : '',
                      entry.size ? `Размер ${entry.size}` : '',
                      entry.style ? STYLE_OPTIONS[entry.style] || entry.style : '',
                    ]
                      .filter(Boolean)
                      .map((label, index) => (
                        <span className="tag" key={index}>
                          {label}
                        </span>
                      ))}
                  </div>
                  <p className="shopping-budget">
                    {entry.budget !== null ? (
                      <>
                        Ваш бюджет: до <strong>{money(entry.budget)}</strong>
                      </>
                    ) : (
                      'Бюджет не указан'
                    )}
                  </p>
                  {entry.notes && <p className="shopping-notes">{entry.notes}</p>}
                  {links.length > 0 && (
                    <details className="shopping-store-links">
                      <summary>Поиск похожих</summary>
                      <p className="footnote">
                        Откроется поиск в магазине. Наличие, цены и подходящий размер проверяйте на
                        его сайте.
                      </p>
                      <div>
                        {links.map((link) => (
                          <a
                            className="shopping-link"
                            key={link.id || link.name}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {link.name} <Icon name="arrow-right" />
                          </a>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className="shopping-actions">
                    <AppButton
                      type="button"
                      className="btn btn-ghost"
                      disabled={!!busy}
                      onClick={() => setEditing(entry)}
                    >
                      <Icon name="edit" />
                      Изменить
                    </AppButton>
                    <AppButton
                      type="button"
                      className="btn btn-secondary"
                      disabled={!!busy}
                      onClick={() => status(entry)}
                    >
                      <Icon name={entry.status === 'purchased' ? 'refresh' : 'check'} />
                      {busy === entry.id
                        ? 'Сохраняем…'
                        : entry.status === 'planned'
                          ? 'Отметить купленным'
                          : 'Снова в план'}
                    </AppButton>
                    {entry.status === 'purchased' &&
                      (owned ? (
                        <span className="shopping-added">✓ Уже в гардеробе</span>
                      ) : (
                        <AppButton
                          type="button"
                          className="btn btn-primary"
                          disabled={!!busy}
                          onClick={() => addGarment(entry)}
                        >
                          <Icon name="plus" />
                          Добавить в гардероб
                        </AppButton>
                      ))}
                    <AppButton
                      type="button"
                      className="btn btn-ghost"
                      disabled={!!busy}
                      aria-label={`Удалить желание: ${entry.name}`}
                      onClick={() => setDeleting(entry)}
                    >
                      <Icon name="trash" />
                      Удалить
                    </AppButton>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : state.shoppingList.length > 0 && narrowed ? (
        <EmptyState
          icon="search"
          title="Ничего не нашлось"
          description="Измените запрос или категорию. Сброс сохранит выбранную вкладку покупок."
        >
          <AppButton type="button" className="btn btn-primary" onClick={reset}>
            <Icon name="plus" />
            Сбросить фильтры
          </AppButton>
        </EmptyState>
      ) : (
        <EmptyState
          icon="shopping"
          title={
            filters.status === 'purchased'
              ? 'Пока без покупок'
              : filters.status === 'all'
                ? 'Оставьте место для желаний'
                : 'Всё нужное — по плану'
          }
          description={
            filters.status === 'purchased'
              ? 'Когда найдёте подходящую вещь, отметьте её купленной.'
              : 'Добавьте вещь вручную или сохраните недостающую деталь из образа.'
          }
        >
          <AppButton type="button" className="btn btn-primary" onClick={() => setEditing({})}>
            <Icon name="plus" />
            Добавить желание
          </AppButton>
        </EmptyState>
      )}
      {editing && (
        <ShoppingForm
          key={editing.id || 'new-shopping'}
          entry={editing}
          onClose={() => setEditing(null)}
        />
      )}{' '}
      {garment && <ItemForm item={garment} onClose={() => setGarment(null)} />}{' '}
      {deleting && (
        <ConfirmDialog
          title="Удалить желание?"
          description={`«${deleting.name}» будет удалено из списка покупок. Вещь из гардероба, если вы её добавляли, останется.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await removeShopping(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}
