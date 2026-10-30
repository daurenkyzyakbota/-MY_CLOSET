'use client';
import { useState } from 'react';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import ItemCard from '@/components/cards/item-card.jsx';
import OutfitCard from '@/components/cards/outfit-card.jsx';
import ItemForm from '@/components/forms/item-form.jsx';
import OutfitForm from '@/components/forms/outfit-form.jsx';
import { PageHeader, EmptyState } from '@/components/ui/ui.jsx';
export default function FavoritesPage() {
  const { state } = useCloset();
  const [item, setItem] = useState(null);
  const [outfit, setOutfit] = useState(null);
  const items = state.items.filter((value) => value.favorite);
  const outfits = state.outfits.filter((value) => value.favorite);
  return (
    <>
      <PageHeader
        title="Избранное"
        description="Вещи и сочетания, которые особенно вам нравятся."
      />
      {!items.length && !outfits.length && (
        <EmptyState
          icon="heart"
          title="Сохраните то, что любите"
          description="Нажмите на сердечко у вещи или образа — они появятся здесь."
        />
      )}
      {!!items.length && (
        <section>
          <div className="section-header">
            <h2>Любимые вещи</h2>
            <span className="tag">{items.length}</span>
          </div>
          <div className="card-grid">
            {items.map((value) => (
              <ItemCard item={value} key={value.id} onEdit={() => setItem(value)} />
            ))}
          </div>
        </section>
      )}
      {!!outfits.length && (
        <section>
          <div className="section-header">
            <h2>Любимые образы</h2>
            <span className="tag">{outfits.length}</span>
          </div>
          <div className="card-grid outfit-grid">
            {outfits.map((value) => (
              <OutfitCard outfit={value} key={value.id} onEdit={() => setOutfit(value)} />
            ))}
          </div>
        </section>
      )}
      {item && <ItemForm item={item} onClose={() => setItem(null)} />}
      {outfit && <OutfitForm outfit={outfit} onClose={() => setOutfit(null)} />}
    </>
  );
}
