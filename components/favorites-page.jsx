'use client';
import { useState } from 'react';
import { useCloset } from './closet-provider.jsx';
import ItemCard from './item-card.jsx';
import OutfitCard from './outfit-card.jsx';
import ItemForm from './item-form.jsx';
import OutfitForm from './outfit-form.jsx';
import { PageHeader, EmptyState } from './ui.jsx';
export default function FavoritesPage() {
  const { state } = useCloset();
  const [item, setItem] = useState(null);
  const [outfit, setOutfit] = useState(null);
  const items = state.items.filter(value => value.favorite);
  const outfits = state.outfits.filter(value => value.favorite);
  return <><PageHeader title="Избранное" description="Вещи и сочетания, которые особенно вам нравятся."/>
    {!items.length && !outfits.length && <EmptyState icon="heart" title="Сохраните то, что любите" description="Нажмите на сердечко у вещи или образа — они появятся здесь."/>}
    {!!items.length && <section><div className="section-header"><h2>Любимые вещи</h2><span className="tag">{items.length}</span></div><div className="card-grid">{items.map(value => <ItemCard item={value} key={value.id} onEdit={() => setItem(value)}/>)}</div></section>}
    {!!outfits.length && <section><div className="section-header"><h2>Любимые образы</h2><span className="tag">{outfits.length}</span></div><div className="card-grid outfit-grid">{outfits.map(value => <OutfitCard outfit={value} key={value.id} onEdit={() => setOutfit(value)}/>)}</div></section>}
    {item && <ItemForm item={item} onClose={() => setItem(null)}/>}{outfit && <OutfitForm outfit={outfit} onClose={() => setOutfit(null)}/>}
  </>;
}
