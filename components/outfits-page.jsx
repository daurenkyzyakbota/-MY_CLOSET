'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useCloset } from './closet-provider.jsx';
import { EmptyState, Icon, Loading, PageHeader } from './ui.jsx';
import OutfitCard from './outfit-card.jsx';
import OutfitForm from './outfit-form.jsx';
export default function OutfitsPage({ favoritesOnly = false, create = false }) {
  const { state, ready } = useCloset();
  const [editing, setEditing] = useState(create ? {} : null);
  const outfits = favoritesOnly ? state.outfits.filter(outfit => outfit.favorite) : state.outfits;
  if (!ready) return <Loading/>;
  return <section className="outfits-page">
    {favoritesOnly ? <div className="section-header"><h2>Любимые образы</h2><span className="tag">{outfits.length}</span></div> : <PageHeader title="Мои образы" description="Сочетания, к которым хочется возвращаться."><button className="button button-primary" onClick={() => setEditing({})}><Icon name="plus"/>Собрать образ</button></PageHeader>}
    {!favoritesOnly && <div className="section-header"><p className="subtitle">{outfits.length} сохранённых образов</p><div className="outfits-tools"><Link href="/favorites" className="button button-ghost"><Icon name="heart"/>Избранное</Link><Link href="/stylist" className="button button-secondary"><Icon name="sparkle"/>Подобрать образ</Link></div></div>}
    {outfits.length ? <div className="card-grid outfit-grid">{[...outfits].reverse().map(outfit => <OutfitCard key={outfit.id} outfit={outfit} onEdit={setEditing}/>)}</div> : <EmptyState icon="outfits" title="Что наденем сегодня?" description="Выберите вещи из гардероба, дайте образу название и сохраните его."><button className="button button-primary" onClick={() => setEditing({})}><Icon name="plus"/>Собрать первый образ</button></EmptyState>}
    <p className="footnote">Стилист учитывает повод, стиль, цвета и погоду. Каждый предложенный образ можно изменить и сохранить.</p>
    {editing && <OutfitForm key={editing.id || 'new-outfit'} outfit={editing} onClose={() => setEditing(null)}/>}
  </section>;
}
