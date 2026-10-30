'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { localDate, SLOTS } from '@/lib/data/model.js';
import { everydaySummary } from '@/lib/data/daily-summary.js';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Icon, ItemArt } from '@/components/ui/ui.jsx';

export default function DailyFocus({ onAddItem, onCreateOutfit }) {
  const { state, markWorn } = useCloset();
  const today = localDate();
  const summary = useMemo(() => everydaySummary(state, today), [state, today]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function wear(id, outfit) {
    if (busy) return;
    setBusy(id);
    setError('');
    try {
      await markWorn({
        date: today,
        ...(outfit ? { outfitId: id } : { itemIds: [id] }),
        notes: '',
      });
    } catch (cause) {
      setError(cause.message || 'Не удалось сохранить отметку.');
    } finally {
      setBusy('');
    }
  }
  const completeSteps = summary.steps.filter(Boolean).length;
  return (
    <section className="everyday-focus" aria-label="Ваш гардероб на сегодня">
      {completeSteps < 3 && (
        <div className="everyday-start">
          <div>
            <p className="eyebrow">СВОЙ РИТМ СТИЛЯ</p>
            <h2>Три шага к удобному гардеробу</h2>
            <p>Готово {completeSteps} из 3 — начните с того, что уже есть.</p>
          </div>
          <div className="everyday-steps">
            <AppButton className="btn btn-secondary" onClick={onAddItem}>
              <Icon name={summary.steps[0] ? 'check' : 'plus'} />
              Добавить вещь
            </AppButton>
            <AppButton className="btn btn-secondary" onClick={onCreateOutfit}>
              <Icon name={summary.steps[1] ? 'check' : 'outfits'} />
              Собрать образ
            </AppButton>
            <Link className="btn btn-secondary" href="/calendar">
              <Icon name={summary.steps[2] ? 'check' : 'calendar'} />
              Запланировать день
            </Link>
          </div>
        </div>
      )}
      {!!state.items.length && (
        <div className="everyday-grid">
          <div className="everyday-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">СЕГОДНЯ</p>
                <h2>Что наденем?</h2>
              </div>
              <Link href="/calendar" className="btn btn-ghost" aria-label="Открыть календарь">
                <Icon name="calendar" />
              </Link>
            </div>
            {summary.plans.length ? (
              summary.plans.map((row) => (
                <div className="everyday-plan" key={row.plan.id}>
                  <div>
                    <span className="tag">{SLOTS[row.plan.slot]}</span>
                    <h3>{row.outfit?.name || 'Образ нужно проверить'}</h3>
                    <p className="footnote">
                      {row.worn
                        ? 'Носка отмечена'
                        : row.complete
                          ? 'Состав готов к выходу'
                          : 'Есть недостающие или недоступные вещи'}
                    </p>
                  </div>
                  <AppButton
                    className="btn btn-secondary"
                    disabled={!!busy || row.worn || !row.complete}
                    onClick={() => wear(row.outfit.id, true)}
                  >
                    {busy === row.outfit?.id
                      ? 'Сохраняем…'
                      : row.worn
                        ? 'Отмечено ✓'
                        : 'Надела сегодня'}
                  </AppButton>
                </div>
              ))
            ) : (
              <div className="everyday-calm">
                <Icon name="calendar" size={28} />
                <p>На сегодня пока нет плана. Выберите образ заранее — утром будет проще.</p>
                <Link className="btn btn-secondary" href="/calendar">
                  Запланировать образ
                </Link>
              </div>
            )}
            <div className="everyday-mini-stats">
              <Link href="/outfits">
                Готовых образов: <strong>{summary.readyOutfits}</strong>
              </Link>
              <Link href="/wardrobe?reset=1&availability=unavailable">
                В стирке: <strong>{summary.laundryCount}</strong>
              </Link>
            </div>
          </div>
          <div className="everyday-card">
            <div className="section-header">
              <div>
                <p className="eyebrow">НОВОЕ В ПРИВЫЧНОМ</p>
                <h2>Дайте вещам ещё один выход</h2>
              </div>
            </div>
            {summary.forgotten.length ? (
              <div className="everyday-forgotten">
                {summary.forgotten.map((row) => (
                  <div className="everyday-garment" key={row.id}>
                    <Link
                      href={'/wardrobe?reset=1&q=' + encodeURIComponent(row.item.name)}
                      aria-label={`Открыть вещь: ${row.item.name}`}
                    >
                      <span className="everyday-garment-art">
                        <ItemArt item={row.item} />
                      </span>
                      <span>
                        <strong>{row.item.name}</strong>
                        <small>
                          {row.lastWorn
                            ? `Последняя отметка ${new Date(row.lastWorn + 'T12:00:00').toLocaleDateString('ru-RU')}`
                            : 'Ещё нет отметок носки'}
                        </small>
                      </span>
                    </Link>
                    <AppButton
                      className="btn btn-ghost"
                      disabled={!!busy}
                      onClick={() => wear(row.id, false)}
                      aria-label={`Отметить носку: ${row.item.name}`}
                    >
                      {busy === row.id ? '…' : 'Надела'}
                    </AppButton>
                  </div>
                ))}
              </div>
            ) : (
              <p className="footnote">
                У доступных вещей есть недавние отметки. Продолжайте находить любимые сочетания.
              </p>
            )}
            <Link className="btn btn-ghost" href="/insights">
              Вся история носки <Icon name="arrow-right" />
            </Link>
          </div>
        </div>
      )}
      {summary.trip && (
        <div className="everyday-trip">
          <Icon name="briefcase" size={26} />
          <div>
            <strong>{summary.trip.name}</strong>
            <p>
              {summary.trip.total
                ? `Собрано вещей: ${summary.trip.packed} из ${summary.trip.total}`
                : 'Добавьте вещи в список сборов'}
              {summary.trip.missing ? ` · удалены и требуют замены: ${summary.trip.missing}` : ''}
            </p>
          </div>
          <Link className="btn btn-secondary" href="/collections?tab=trips">
            Открыть поездки
          </Link>
        </div>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
