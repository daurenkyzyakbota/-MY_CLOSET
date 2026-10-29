'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AppButton } from './app-button.jsx';
import { useCloset } from './closet-provider.jsx';
import { outfitStatus, SEASONS } from '@/lib/model.js';
import { OCCASIONS, STYLE_OPTIONS } from '@/lib/stylist.js';
import { EmptyState, Icon, Loading, PageHeader } from './ui.jsx';
import OutfitCard from './outfit-card.jsx';
import OutfitForm from './outfit-form.jsx';

const defaults = { query: '', occasion: '', status: '', sort: 'newest' };
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е');

export default function OutfitsPage({ favoritesOnly = false, create = false }) {
  const { state, ready } = useCloset();
  const [editing, setEditing] = useState(create ? {} : null);
  const [filters, setFilters] = useState(defaults);
  const search = useRef(null);
  const outfits = useMemo(() => favoritesOnly ? state.outfits.filter(outfit => outfit.favorite) : state.outfits, [state.outfits, favoritesOnly]);
  const results = useMemo(() => {
    const words = normalize(filters.query).trim().split(/\s+/).filter(Boolean);
    const byId = new Map(state.items.map(item => [item.id, item]));
    const result = outfits.filter(outfit => {
      if (filters.occasion && outfit.occasion !== filters.occasion) return false;
      const complete = outfitStatus(outfit, state.items).complete;
      if (filters.status === 'ready' && !complete || filters.status === 'attention' && complete) return false;
      const garments = outfit.itemIds.map(id => byId.get(id)).filter(Boolean);
      const text = normalize([outfit.name, outfit.description, OCCASIONS[outfit.occasion], STYLE_OPTIONS[outfit.style], outfit.style, SEASONS[outfit.season], ...garments.flatMap(item => [item.name, item.brand]), ...(outfit.missingItems || []).map(item => item.name)].filter(Boolean).join(' '));
      return words.every(word => text.includes(word));
    });
    const newest = (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    return result.sort(filters.sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }) || newest(a, b) : filters.sort === 'oldest' ? (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id) : filters.sort === 'favorite' ? (a, b) => Number(b.favorite) - Number(a.favorite) || newest(a, b) : newest);
  }, [outfits, state.items, filters]);
  const active = !!filters.query.trim() || !!filters.occasion || !!filters.status || filters.sort !== 'newest';
  const update = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  if (!ready) return <Loading/>;
  return <section className="outfits-page">
    {favoritesOnly ? <div className="section-header"><h2>Любимые образы</h2><span className="tag">{outfits.length}</span></div> : <PageHeader title="Мои образы" description="Сочетания, к которым хочется возвращаться."><AppButton className="button button-primary" onClick={() => setEditing({})}><Icon name="plus"/>Собрать образ</AppButton></PageHeader>}
    {!favoritesOnly && <div className="section-header"><p className="subtitle">{outfits.length} сохранённых образов</p><div className="outfits-tools"><Link href="/favorites" className="button button-ghost"><Icon name="heart"/>Избранное</Link><Link href="/stylist" className="button button-secondary"><Icon name="sparkle"/>Подобрать образ</Link></div></div>}
    {outfits.length > 0 && <>
      <div className="filters outfit-filters">
        <label className="search-field"><Icon name="search"/><input ref={search} id="outfit-search" className="search-input" type="search" maxLength={200} placeholder="Название, вещь или описание" aria-label="Поиск образов" value={filters.query} onChange={event => update('query', event.target.value)}/>{filters.query && <AppButton type="button" className="search-clear" aria-label="Очистить поиск образов" onClick={() => { update('query', ''); search.current?.focus(); }}><Icon name="close"/></AppButton>}</label>
        <select aria-label="Повод образа" value={filters.occasion} onChange={event => update('occasion', event.target.value)}><option value="">Все поводы</option>{Object.entries(OCCASIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="Готовность образов" value={filters.status} onChange={event => update('status', event.target.value)}><option value="">Все образы</option><option value="ready">Готовы к выходу</option><option value="attention">Нужно дополнить</option></select>
        <select aria-label="Порядок образов" value={filters.sort} onChange={event => update('sort', event.target.value)}><option value="newest">Сначала новые</option><option value="oldest">Сначала добавленные</option><option value="name">По названию</option><option value="favorite">Сначала любимые</option></select>
      </div>
      <div className="results-line outfit-filter-summary"><span role="status">Найдено: {results.length} из {outfits.length}</span>{active && <AppButton className="button button-ghost" type="button" onClick={() => setFilters(defaults)}>Сбросить фильтры образов</AppButton>}</div>
    </>}
    {results.length ? <div className="card-grid outfit-grid">{results.map(outfit => <OutfitCard key={outfit.id} outfit={outfit} onEdit={setEditing}/>)}</div> : outfits.length ? <EmptyState icon="search" title="Образы не найдены" description="Попробуйте другое название, повод или готовность образа."><AppButton className="button button-primary" onClick={() => setFilters(defaults)}>Сбросить фильтры образов</AppButton></EmptyState> : <EmptyState icon="outfits" title="Что наденем сегодня?" description="Выберите вещи из гардероба, дайте образу название и сохраните его."><AppButton className="button button-primary" onClick={() => setEditing({})}><Icon name="plus"/>Собрать первый образ</AppButton></EmptyState>}
    <p className="footnote">Стилист учитывает повод, стиль, цвета и погоду. Каждый предложенный образ можно изменить и сохранить.</p>
    {editing && <OutfitForm key={editing.id || 'new-outfit'} outfit={editing} onClose={() => setEditing(null)}/>}
  </section>;
}
