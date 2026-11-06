'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CATEGORIES, MAX_TRASH_RECORDS } from '@/lib/data/model.js';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { ConfirmDialog, EmptyState, Icon, ItemArt, Loading, PageHeader } from '@/components/ui/ui.jsx';

export default function TrashPage() {
  const closet = useCloset();
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [planChoices, setPlanChoices] = useState({});
  if (!closet.ready) return <Loading />;
  const entries = closet.state.trash || [];
  const visible = entries.filter((entry) => filter === 'all' || entry.type === filter)
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.id.localeCompare(b.id));

  async function restore(entry) {
    if (busy) return;
    setBusy(entry.id);
    setError('');
    try {
      await closet.restoreTrash(entry.id, { restorePlans: planChoices[entry.id] !== false });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="trash-page">
      <PageHeader title="Корзина" description="Удалённые вещи и образы можно вернуть вместе с фотографиями и прежними идентификаторами.">
        <Link className="button button-secondary" href="/wardrobe">В гардероб</Link>
        <AppButton className="button button-danger" disabled={!!busy || !entries.length} onClick={() => setConfirmation({ ids: entries.map((entry) => entry.id) })}>
          Очистить корзину
        </AppButton>
      </PageHeader>
      <p className="footnote">Записей: {entries.length} из {MAX_TRASH_RECORDS}. Автоматического удаления нет. Корзина входит в резервную копию и подключённую синхронизацию.</p>
      <div className="trash-filters" role="group" aria-label="Тип удалённых записей">
        {[['all', 'Все'], ['item', 'Вещи'], ['outfit', 'Образы']].map(([value, label]) => (
          <AppButton key={value} className={`button ${filter === value ? 'button-primary' : 'button-secondary'}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</AppButton>
        ))}
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {visible.length ? (
        <div className="trash-list">
          {visible.map((entry) => (
            <article className="trash-card" key={entry.id}>
              <div className="trash-preview">
                {entry.type === 'item'
                  ? entry.record.photo ? <img src={entry.record.photo} alt={entry.record.name} loading="lazy" /> : <ItemArt item={entry.record} />
                  : <Icon name="outfits" size={42} />}
              </div>
              <div className="trash-card-content">
                <p className="eyebrow">{entry.type === 'item' ? CATEGORIES[entry.record.category] : 'ОБРАЗ'}</p>
                <h2>{entry.record.name}</h2>
                <p className="footnote">Удалено: {new Date(entry.deletedAt).toLocaleString('ru-RU')}</p>
                {entry.type === 'outfit' && entry.plans.length > 0 && (
                  <label className="checkbox-row">
                    <input type="checkbox" checked={planChoices[entry.id] !== false} disabled={!!busy} onChange={(event) => setPlanChoices({ ...planChoices, [entry.id]: event.target.checked })} />
                    Восстановить прежние планы ({entry.plans.length}), если время свободно
                  </label>
                )}
                <div className="card-actions">
                  <AppButton className="button button-primary" disabled={!!busy} onClick={() => restore(entry)}>{busy === entry.id ? 'Восстанавливаем…' : 'Восстановить'}</AppButton>
                  <AppButton className="button button-ghost" disabled={!!busy} onClick={() => setConfirmation({ entry })}>Удалить окончательно</AppButton>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon="trash" title={entries.length ? 'Таких записей в корзине нет' : 'Корзина пуста'} description="Вещи и образы появятся здесь после удаления. Они не исчезают автоматически." />
      )}
      {confirmation && (
        <ConfirmDialog
          title={confirmation.entry ? 'Удалить запись окончательно?' : 'Очистить корзину?'}
          description={confirmation.entry
            ? `«${confirmation.entry.record.name}» будет удалена из корзины вместе с сохранённой фотографией и связанными планами. Для долгого хранения сначала скачайте резервную копию.`
            : `Будут удалены все ${confirmation.ids.length} записей, их фотографии и сохранённые планы. Сначала скачайте резервную копию, если они вам нужны.`}
          onClose={() => setConfirmation(null)}
          onConfirm={() => confirmation.entry
            ? closet.purgeTrash(confirmation.entry.id)
            : closet.emptyTrash({ expectedIds: confirmation.ids })}
        />
      )}
    </section>
  );
}
