'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { CATEGORIES, COLORS } from '@/lib/data/model.js';
import { matchPublishedOutfit } from '@/lib/styling/inspiration.js';
import OutfitForm from '@/components/forms/outfit-form.jsx';
import { Icon, ItemArt, Modal } from '@/components/ui/ui.jsx';
import { SocialNotice, socialCountWord } from './social-common.jsx';

const colorsLabel = (colors) =>
  colors
    .map((color) => COLORS[color]?.[0])
    .filter(Boolean)
    .join(', ') || 'Цвет не указан';

// A poll post holds two outfits: start from the one the viewer voted for (or «А»).
function initialSelection(post) {
  const items = post.snapshot?.items || [];
  const option = post.poll?.options?.[post.poll.myVote ?? 0];
  if (!option) return items.map((_, index) => index);
  const wanted = new Set(option.itemIds);
  return items.flatMap((item, index) => (wanted.has(item.id) ? [index] : []));
}

export default function InspirationDialog({ post, onClose }) {
  const closet = useCloset();
  const social = useSocial();
  const [owner] = useState(closet.ownerId);
  const [selection, setSelection] = useState(() => initialSelection(post));
  const [draft, setDraft] = useState(null);
  const [shopping, setShopping] = useState({ busy: false, added: 0, skipped: 0, error: '' });
  const expectedOwner = social.user?.id || '';
  const safeScope = closet.ready && closet.ownerId === owner && owner === expectedOwner;
  useEffect(() => {
    if (!safeScope) onClose();
  }, [safeScope, onClose]);
  const result = useMemo(() => {
    if (!safeScope) return null;
    try {
      return matchPublishedOutfit(post.snapshot, closet.state.items, {
        title: post.title,
        selectedIndexes: selection,
      });
    } catch (error) {
      return { error: error.message };
    }
  }, [safeScope, post.snapshot, post.title, closet.state.items, selection]);
  if (!safeScope || !result) return null;
  if (draft) return <OutfitForm outfit={draft} onClose={onClose} />;
  function toggle(index) {
    setShopping({ busy: false, added: 0, skipped: 0, error: '' });
    setSelection((current) =>
      current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index].sort((a, b) => a - b),
    );
  }
  const rows = new Map((result.matches || []).map((row) => [row.source.index, row]));
  const missing = (result.matches || []).filter(
    (row) => !row.item && selection.includes(row.source.index),
  );
  // Missing pieces go to the shopping list; ones already planned there are skipped.
  async function addMissingToShopping() {
    if (shopping.busy || !missing.length) return;
    setShopping({ busy: true, added: 0, skipped: 0, error: '' });
    let added = 0;
    let skipped = 0;
    try {
      for (const row of missing) {
        try {
          await closet.saveShopping({
            name: row.source.name,
            category: row.source.category,
            colors: row.source.colors,
            notes: `Для образа «${post.title}» из сообщества`.slice(0, 500),
          });
          added += 1;
        } catch (cause) {
          if (!/уже есть в планах/.test(cause.message || '')) throw cause;
          skipped += 1;
        }
      }
      setShopping({ busy: false, added, skipped, error: '' });
    } catch (cause) {
      setShopping({
        busy: false,
        added,
        skipped,
        error: cause.message || 'Не удалось добавить вещи в покупки.',
      });
    }
  }
  const shoppingDone = !shopping.busy && shopping.added + shopping.skipped === missing.length;
  return (
    <Modal
      title="Повторить образ"
      description="Сравним категории и цветовые группы с вашим гардеробом. В черновик попадут только ваши вещи, а недостающие можно добавить в покупки."
      onClose={onClose}
    >
      <div className="inspiration-dialog">
        <p className="inspiration-source">
          По мотивам образа <strong>«{post.title}»</strong>
        </p>
        {result.error ? (
          <SocialNotice error>{result.error}</SocialNotice>
        ) : (
          <>
            <div className="inspiration-headline" aria-live="polite">
              <strong>
                {result.selectedCount > 0 && result.matchedCount === result.selectedCount
                  ? 'Всё есть в вашем гардеробе ✓'
                  : `У вас есть ${result.matchedCount} из ${result.selectedCount} ${socialCountWord(
                      result.selectedCount,
                      'вещи',
                      'вещей',
                      'вещей',
                    )}`}
              </strong>
              {missing.length > 0 && (
                <span>
                  Не хватает:{' '}
                  {missing.map((row) => row.source.name.toLocaleLowerCase('ru')).join(', ')}
                </span>
              )}
              {missing.length > 0 &&
                (shoppingDone && shopping.added + shopping.skipped > 0 ? (
                  <Link
                    href="/shopping-list"
                    className="inspiration-shopping-done"
                    onClick={onClose}
                  >
                    <Icon name="check" size={16} />
                    {shopping.added
                      ? `Добавлено в покупки: ${shopping.added}`
                      : 'Уже есть в покупках'}{' '}
                    · открыть список
                  </Link>
                ) : (
                  <AppButton
                    className="btn btn-secondary"
                    disabled={shopping.busy}
                    onClick={addMissingToShopping}
                  >
                    <Icon name="shopping" />
                    {shopping.busy ? 'Добавляем…' : 'Добавить недостающее в покупки'}
                  </AppButton>
                ))}
              <SocialNotice error>{shopping.error}</SocialNotice>
            </div>
            <div className="inspiration-summary">
              <span>
                <strong>{result.matchedCount}</strong> подобрано из вашего гардероба
              </span>
              <span>
                <strong>{result.missingCount}</strong>{' '}
                {socialCountWord(
                  result.missingCount,
                  'недостающая деталь',
                  'недостающие детали',
                  'недостающих деталей',
                )}
              </span>
              <span>
                <strong>{result.approximateCount}</strong> с отличиями в цвете
              </span>
            </div>
            {result.warnings.map((warning) => (
              <SocialNotice key={warning}>{warning}</SocialNotice>
            ))}
            {(!result.availableCount || !result.matchedCount) && (
              <Link href="/wardrobe" className="btn btn-primary" onClick={onClose}>
                <Icon name="wardrobe" />
                Открыть мой гардероб
              </Link>
            )}
            <p className="footnote">
              Снимите отметки у деталей, которые не нужны. Посадка, материал, погода и сочетание
              вещей автоматически не проверяются.
            </p>
            <div className="inspiration-match-list">
              {result.sources.map((source) => {
                const checked = selection.includes(source.index);
                const match = rows.get(source.index);
                return (
                  <div
                    className={`inspiration-match${checked ? '' : ' is-excluded'}`}
                    key={source.index}
                  >
                    <label className="inspiration-select">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(source.index)}
                        aria-label={`Включить деталь: ${source.name}`}
                      />
                      <span>
                        <strong>{source.name}</strong>
                        <small>
                          {CATEGORIES[source.category]} · {colorsLabel(source.colors)}
                        </small>
                      </span>
                    </label>
                    {checked && match && (
                      <div className={`inspiration-owned inspiration-status-${match.colorStatus}`}>
                        {match.item ? (
                          <>
                            <div className="inspiration-owned-art">
                              <ItemArt item={match.item} />
                            </div>
                            <div>
                              <p className="eyebrow">ВАША ВЕЩЬ</p>
                              <strong>{match.item.name}</strong>
                              <p className="footnote">{colorsLabel(match.item.colors || [])}</p>
                              <p className="inspiration-explanation">{match.explanation}</p>
                            </div>
                          </>
                        ) : (
                          <div>
                            <span className="inspiration-missing-label">
                              <Icon name="plus" />
                              Недостающая деталь
                            </span>
                            <p className="inspiration-explanation">
                              {match.explanation} В конструкторе можно выбрать замену или оставить
                              её в планах.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="notice">
              Предпросмотр ничего не сохраняет и не добавляет чужие вещи. В конструкторе проверьте
              состав и нажмите «Сохранить образ», если результат вам подходит.
            </p>
          </>
        )}
        <div className="form-actions">
          <AppButton className="btn btn-secondary" onClick={onClose}>
            Отмена
          </AppButton>
          <AppButton
            className="btn btn-primary"
            disabled={!result.canCreate}
            onClick={() => {
              if (safeScope && result.canCreate) setDraft(result.draft);
            }}
          >
            <Icon name="outfits" />
            Открыть конструктор
          </AppButton>
        </div>
      </div>
    </Modal>
  );
}
