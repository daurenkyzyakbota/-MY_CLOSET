'use client';

import { AppButton } from '@/components/ui/app-button.jsx';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { localDate, SEASONS, outfitStatus } from '@/lib/data/model.js';
import { downloadOutfitPng } from '@/lib/media/outfit-export.js';
import { OCCASIONS, STYLE_OPTIONS } from '@/lib/styling/stylist.js';
import { createStoreSearchLinks, shoppingDraftFromMissing } from '@/lib/styling/shopping.js';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { Icon, ItemArt } from '@/components/ui/ui.jsx';
import OutfitForm from '@/components/forms/outfit-form.jsx';
import { ShoppingForm } from '@/components/forms/shopping-form.jsx';

const plural = (n, one, few, many) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many}`;

export default function OutfitCard({ outfit, onEdit }) {
  const { state, toggleOutfit, markWorn } = useCloset();
  const [editing, setEditing] = useState(null);
  const [shopping, setShopping] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [wearing, setWearing] = useState(false);
  const exportArtwork = useRef(null);
  const status = outfitStatus(outfit, state.items);
  const missing = outfit.missingItems || [];
  const edit = (draft) => (onEdit ? onEdit(draft) : setEditing(draft));
  async function favorite() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await toggleOutfit(outfit.id);
    } catch (cause) {
      setError(cause.message || 'Не удалось сохранить изменение.');
    } finally {
      setBusy(false);
    }
  }
  async function exportImage() {
    if (exporting) return;
    setExporting(true);
    setError('');
    try {
      await downloadOutfitPng({
        outfit,
        items: state.items,
        artworkElement: exportArtwork.current,
      });
    } catch (cause) {
      setError(cause.message || 'Не удалось скачать картинку.');
    } finally {
      setExporting(false);
    }
  }
  async function wornToday() {
    if (wearing) return;
    setWearing(true);
    setError('');
    try {
      await markWorn({ outfitId: outfit.id, date: localDate(), notes: '' });
    } catch (cause) {
      setError(cause.message || 'Не удалось сохранить отметку.');
    } finally {
      setWearing(false);
    }
  }
  return (
    <>
      <article className="outfit-card">
        <div className="outfit-preview">
          {status.items.slice(0, 4).map((item) => (
            <div className="outfit-piece" key={item.id}>
              <ItemArt item={item} />
            </div>
          ))}
          {missing.map((item) => (
            <div className="missing-piece" key={item.id}>
              <span className="missing-piece-icon">
                <Icon name="shopping" />
              </span>
              <span className="missing-piece-label">Нужно добавить</span>
              <strong>{item.name}</strong>
            </div>
          ))}
          {!status.items.length && !missing.length && (
            <div className="empty-preview">
              <Icon name="outfits" />
            </div>
          )}
          <AppButton
            className={`icon-btn favorite-btn${outfit.favorite ? ' is-active' : ''}`}
            type="button"
            disabled={busy}
            aria-label={`${outfit.favorite ? 'Убрать из избранного' : 'В избранное'}: ${outfit.name}`}
            aria-pressed={outfit.favorite}
            onClick={favorite}
          >
            <Icon name="heart" />
          </AppButton>
        </div>
        <div className="card-body">
          <p className="eyebrow">
            {plural(status.items.length, 'ваша вещь', 'ваши вещи', 'ваших вещей')}
          </p>
          <h3>{outfit.name}</h3>
          <p className={`outfit-completeness${missing.length ? ' missing-outfit-badge' : ''}`}>
            {missing.length
              ? 'Требует покупки'
              : status.missing.length
                ? 'Проверьте состав'
                : 'Полный'}
          </p>
          <div className="tag-row">
            <span className="tag">{OCCASIONS[outfit.occasion] || OCCASIONS.everyday}</span>
            {outfit.style && (
              <span className="tag">{STYLE_OPTIONS[outfit.style] || outfit.style}</span>
            )}
            {outfit.season && <span className="tag">{SEASONS[outfit.season]}</span>}
          </div>
          {outfit.description && (
            <p className="item-meta outfit-description">{outfit.description}</p>
          )}
          {status.missing.length > 0 && (
            <p className="outfit-warning">
              {plural(status.missing.length, 'вещь удалена', 'вещи удалены', 'вещей удалены')}.
              Обновите состав.
            </p>
          )}
          {status.unavailable.length > 0 && <p className="outfit-warning">Есть вещи в стирке</p>}
          {!status.missing.length && !status.unavailable.length && !missing.length && (
            <p className="item-meta">Всё готово к выходу</p>
          )}
          {missing.length > 0 && (
            <details className="saved-missing-details">
              <summary>Недостающие детали · {missing.length}</summary>
              {missing.map((item) => {
                const links = createStoreSearchLinks(item);
                return (
                  <div className="saved-missing-item" key={item.id}>
                    <strong>{item.name}</strong>
                    <p>{item.reason}</p>
                    <AppButton
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setShopping(shoppingDraftFromMissing(item))}
                    >
                      <Icon name="shopping" />В покупки
                    </AppButton>
                    {links.length > 0 && (
                      <details className="shopping-store-links">
                        <summary>Поиск похожих</summary>
                        <p className="footnote">
                          Откроется поиск в магазине. Наличие, цены и подходящий размер проверяйте
                          на его сайте.
                        </p>
                        <div>
                          {links.map((link) => (
                            <a
                              className="shopping-link"
                              href={link.url}
                              key={link.id || link.name}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {link.name} <Icon name="arrow-right" />
                            </a>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })}
            </details>
          )}
          <div className="card-actions">
            <AppButton
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => edit(outfit)}
            >
              <Icon name="edit" />
              Изменить
            </AppButton>
            <Link
              className="btn btn-ghost"
              href={`/calendar?outfit=${encodeURIComponent(outfit.id)}`}
            >
              <Icon name="calendar" />В календарь
            </Link>
          </div>
          <div className="outfit-media-actions">
            <AppButton
              type="button"
              className="btn btn-secondary"
              data-action="export-outfit"
              aria-label={`Скачать образ PNG: ${outfit.name}`}
              disabled={exporting || busy || wearing}
              onClick={exportImage}
            >
              <Icon name="download" />
              {exporting ? 'Готовим PNG…' : 'Скачать PNG'}
            </AppButton>
            {status.complete && (
              <AppButton
                type="button"
                className="btn btn-ghost"
                data-action="wear-outfit"
                aria-label={`Отметить носку: ${outfit.name}`}
                disabled={wearing || busy || exporting}
                onClick={wornToday}
              >
                <Icon name="check" />
                {wearing ? 'Сохраняем…' : 'Надела сегодня'}
              </AppButton>
            )}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </article>
      <div ref={exportArtwork} hidden aria-hidden="true">
        {status.items
          .filter((item) => !item.photo)
          .map((item) => (
            <span key={item.id} data-export-item={item.id}>
              <ItemArt item={item} />
            </span>
          ))}
      </div>
      {editing && (
        <OutfitForm
          key={editing.id || 'new-outfit'}
          outfit={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {shopping && <ShoppingForm entry={shopping} onClose={() => setShopping(null)} />}
    </>
  );
}
