'use client';
import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, COLORS, SEASONS, categoryCounts, filterItems, sortItems } from '@/lib/model.js';
import { STYLE_OPTIONS } from '@/lib/stylist.js';
import { useCloset } from './closet-provider.jsx';
import { EmptyState, Icon, Loading, PageHeader } from './ui.jsx';
import ItemCard from './item-card.jsx';
import ItemForm from './item-form.jsx';

const blankFilters = { query: '', category: '', color: '', season: '', style: '', availability: '' };
const quantity = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'вещь' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'вещи' : 'вещей'}`;
export default function WardrobePage({ favoritesOnly = false }) {
  const { state, ready } = useCloset();
  const [filters, setFilters] = useState(blankFilters);
  const [sort, setSort] = useState('newest');
  const [editing, setEditing] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const category = params.get('category');
    setFilters(current => ({ ...current, query: (params.get('q') || '').slice(0, 200), category: Object.hasOwn(CATEGORIES, category || '') ? category : '' }));
  }, []);
  const items = useMemo(() => favoritesOnly ? state.items.filter(item => item.favorite) : state.items, [state.items, favoritesOnly]);
  const counts = useMemo(() => categoryCounts(items), [items]);
  const styles = useMemo(() => [...new Set([...items.map(item => item.style.trim()).filter(Boolean), ...(filters.style ? [filters.style] : [])])].sort((a,b) => a.localeCompare(b, 'ru')), [items, filters.style]);
  const results = useMemo(() => sortItems(filterItems(items, filters), sort), [items, filters, sort]);
  const active = Object.values(filters).some(Boolean) || sort !== 'newest';
  const update = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  function reset() { setFilters(blankFilters); setSort('newest'); }
  if (!ready) return <Loading/>;
  return <section className="wardrobe-page">
    {favoritesOnly ? <div className="section-header"><h2>Любимые вещи</h2><span className="tag">{items.length}</span></div> : <PageHeader title="Мой гардероб" description="Любимые вещи. Удобный порядок. Больше удачных сочетаний."/>}
    <div className="wardrobe-chips" role="group" aria-label="Категории гардероба">{[['', 'Все вещи'], ...Object.entries(CATEGORIES)].map(([key, label]) => <button key={key} type="button" className={`wardrobe-chip${filters.category === key ? ' is-active' : ''}`} aria-pressed={filters.category === key} onClick={() => update('category', key)}><span>{label}</span><span className="chip-count">{key ? counts[key] : items.length}</span></button>)}</div>
    <div className="filters wardrobe-toolbar">
      <label className="search-field"><Icon name="search"/><input className="search-input" id="wardrobe-search" type="search" maxLength={200} placeholder="Вещь, бренд, материал или стиль" aria-label="Поиск вещей" value={filters.query} onChange={event => update('query', event.target.value)}/></label>
      <select aria-label="Цвет" value={filters.color} onChange={event => update('color', event.target.value)}><option value="">Все цвета</option>{Object.entries(COLORS).map(([key,[label]]) => <option key={key} value={key}>{label}</option>)}</select>
      <select aria-label="Сезон" value={filters.season} onChange={event => update('season', event.target.value)}><option value="">Все сезоны</option>{Object.entries(SEASONS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select aria-label="Доступность" value={filters.availability} onChange={event => update('availability', event.target.value)}><option value="">Все вещи</option><option value="available">Готовы к выходу</option><option value="laundry">В стирке</option></select>
      <select className="wardrobe-style-filter" aria-label="Стиль" value={filters.style} onChange={event => update('style', event.target.value)}><option value="">Все стили</option>{styles.map(style => <option key={style} value={style}>{STYLE_OPTIONS[style] || style}</option>)}</select>
    </div>
    <div className="results-line"><span role="status">{quantity(results.length)}{active ? ` из ${items.length}` : ''}</span><div className="wardrobe-sort"><label htmlFor="wardrobe-sort">Порядок</label><select id="wardrobe-sort" aria-label="Сортировка вещей" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Сначала новые</option><option value="oldest">Сначала добавленные</option><option value="name">По названию</option><option value="favorites">Сначала любимые</option></select>{active && <button type="button" className="button button-ghost" onClick={reset}>Сбросить фильтры</button>}</div></div>
    {results.length ? <div className="card-grid">{results.map(item => <ItemCard key={item.id} item={item} onEdit={setEditing}/>)}</div> : items.length ? <EmptyState icon="search" title="Ничего не нашлось" description="Попробуйте другой запрос или сбросьте фильтры."><button className="button button-primary" onClick={reset}>Сбросить фильтры</button></EmptyState> : <EmptyState icon="wardrobe" title="Ваш гардероб начинается здесь" description="Добавьте любимую футболку, удобные джинсы или пару обуви."><button className="button button-primary" onClick={() => setEditing({})}><Icon name="plus"/>Добавить вещь</button></EmptyState>}
    {editing && <ItemForm key={editing.id || 'new-item'} item={editing} onClose={() => setEditing(null)}/>}
  </section>;
}
