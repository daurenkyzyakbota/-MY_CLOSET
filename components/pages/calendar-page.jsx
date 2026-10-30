'use client';

import { AppButton } from '@/components/ui/app-button.jsx';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SLOTS, localDate, monthCells, outfitStatus, validDate } from '@/lib/data/model.js';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { ConfirmDialog, Field, Icon, Loading, Modal, PageHeader } from '@/components/ui/ui.jsx';
import WeeklyPlanner from '@/components/forms/weekly-planner.jsx';

const dateLabel = (value) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

function PlanForm({ plan, onClose, onSave }) {
  const { state, savePlan } = useCloset();
  const [draft, setDraft] = useState(plan);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const outfit = state.outfits.find((item) => item.id === draft.outfitId);
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (!validDate(draft.date)) {
      setError('Выберите корректную дату.');
      return;
    }
    if (!outfit) {
      setError('Выберите сохранённый образ.');
      return;
    }
    if (
      state.plans.some(
        (item) => item.id !== draft.id && item.date === draft.date && item.slot === draft.slot,
      )
    ) {
      setError(
        'На это время уже назначен образ. Измените существующий план или выберите другое время.',
      );
      return;
    }
    setSaving(true);
    try {
      await savePlan(draft);
      onSave(draft.date);
      onClose();
    } catch (cause) {
      setError(cause.message || 'Не удалось сохранить план.');
    } finally {
      setSaving(false);
    }
  }
  if (!state.outfits.length)
    return (
      <Modal
        title="Запланировать образ"
        description="Завтрашнее утро начинается сегодня."
        onClose={onClose}
      >
        <p className="notice">Сначала сохраните хотя бы один образ.</p>
        <div className="form-actions">
          <AppButton type="button" className="btn btn-secondary" onClick={onClose}>
            Закрыть
          </AppButton>
          <Link className="btn btn-primary" href="/outfits/create" onClick={onClose}>
            Собрать образ
          </Link>
        </div>
      </Modal>
    );
  return (
    <Modal
      title={plan.id ? 'Изменить план' : 'Запланировать образ'}
      description="Завтрашнее утро начинается сегодня."
      onClose={saving ? () => {} : onClose}
    >
      <form id="plan-form" onSubmit={submit}>
        <fieldset className="form-fieldset" disabled={saving}>
          <div className="form-grid">
            <Field label="Дата *">
              <input
                type="date"
                name="date"
                required
                min="1900-01-01"
                max="2200-12-31"
                value={draft.date}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, date: event.target.value }))
                }
              />
            </Field>
            <Field label="Время дня">
              <select
                name="slot"
                value={draft.slot}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, slot: event.target.value }))
                }
              >
                {Object.entries(SLOTS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                    {state.plans.some(
                      (item) =>
                        item.id !== draft.id && item.date === draft.date && item.slot === value,
                    )
                      ? ' — уже занято'
                      : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Образ *" className="field-full">
              <select
                name="outfitId"
                required
                value={draft.outfitId}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, outfitId: event.target.value }))
                }
              >
                <option value="">Выберите образ</option>
                {state.outfits.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {!outfitStatus(item, state.items).complete ? ' — проверьте состав' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="field-hint">
            На дату можно сохранить один дневной и один вечерний план. Занятые промежутки не
            заменяются автоматически.
          </p>
        </fieldset>
        {error && (
          <p className="notice notice-error form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <AppButton
            type="button"
            className="button button-secondary"
            disabled={saving}
            onClick={onClose}
          >
            Отмена
          </AppButton>
          <AppButton type="submit" className="button button-primary" disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить план'}
          </AppButton>
        </div>
      </form>
    </Modal>
  );
}

export default function CalendarPage() {
  const { state, ready, removePlan } = useCloset();
  const [selectedDate, setSelectedDate] = useState(() => localDate());
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [weekly, setWeekly] = useState(false);
  const [linkOutfit, setLinkOutfit] = useState('');
  const [linkDate, setLinkDate] = useState('');
  const [linkError, setLinkError] = useState('');
  const usedLink = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setLinkOutfit(params.get('outfit') || '');
    const dates = params.getAll('date');
    if (!dates.length) return;
    if (dates.length !== 1 || !validDate(dates[0])) {
      setLinkError('Дата в ссылке некорректна. Показываем сегодняшний день.');
      return;
    }
    const date = dates[0];
    setLinkDate(date);
    setSelectedDate(date);
    setMonth(new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1));
  }, []);
  useEffect(() => {
    if (!ready || !linkOutfit || usedLink.current) return;
    usedLink.current = true;
    const outfit = state.outfits.find((item) => item.id === linkOutfit);
    if (!outfit) {
      setLinkError('Образ из ссылки не найден. Выберите другой сохранённый образ.');
      return;
    }
    const date = linkDate || localDate();
    const slot = state.plans.some((item) => item.date === date && item.slot === 'day')
      ? 'evening'
      : 'day';
    setEditing({ date, slot, outfitId: outfit.id });
  }, [ready, linkOutfit, linkDate, state.outfits, state.plans]);
  function selectDate(date) {
    setSelectedDate(date);
  }
  function savedDate(date) {
    setSelectedDate(date);
    setMonth(new Date(`${date.slice(0, 7)}-01T12:00:00`));
  }
  function addPlan(slot = 'day') {
    setEditing({ date: selectedDate, slot, outfitId: state.outfits[0]?.id || '' });
  }
  if (!ready) return <Loading />;
  return (
    <>
      <PageHeader
        title="Календарь образов"
        description="Продумайте день заранее — оставьте утро для себя."
      >
        <AppButton type="button" className="btn btn-secondary" onClick={() => setWeekly(true)}>
          <Icon name="sparkle" />
          Спланировать неделю
        </AppButton>
        <AppButton type="button" className="btn btn-primary" onClick={() => addPlan()}>
          <Icon name="calendar" />
          Запланировать образ
        </AppButton>
      </PageHeader>
      {linkError && (
        <p className="notice" role="status">
          {linkError}
        </p>
      )}
      <div className="calendar-layout">
        <section className="calendar-panel">
          <div className="calendar-toolbar">
            <AppButton
              className="icon-btn"
              type="button"
              aria-label="Предыдущий месяц"
              onClick={() =>
                setMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))
              }
            >
              <Icon name="chevron-left" />
            </AppButton>
            <h2>{month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</h2>
            <AppButton
              className="icon-btn"
              type="button"
              aria-label="Следующий месяц"
              onClick={() =>
                setMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))
              }
            >
              <Icon name="chevron-right" />
            </AppButton>
            <AppButton
              type="button"
              className="btn btn-ghost"
              onClick={() => savedDate(localDate())}
            >
              Сегодня
            </AppButton>
          </div>
          <div className="calendar-grid">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => (
              <span key={day} className="calendar-weekday">
                {day}
              </span>
            ))}
            {monthCells(month.getFullYear(), month.getMonth()).map((date, index) =>
              date ? (
                <AppButton
                  key={date}
                  type="button"
                  data-date={date}
                  className={`calendar-cell${selectedDate === date ? ' is-active' : ''}${localDate() === date ? ' is-today' : ''}`}
                  aria-label={`${dateLabel(date)}${state.plans.some((plan) => plan.date === date) ? ', есть планы' : ''}`}
                  aria-pressed={selectedDate === date}
                  aria-current={localDate() === date ? 'date' : undefined}
                  onClick={() => selectDate(date)}
                >
                  <span className="calendar-day">{Number(date.slice(-2))}</span>
                  <span className="calendar-slots">
                    {state.plans
                      .filter((plan) => plan.date === date)
                      .map((plan) => (
                        <span
                          key={plan.id}
                          className="calendar-plan-dot"
                          title={SLOTS[plan.slot]}
                        />
                      ))}
                  </span>
                </AppButton>
              ) : (
                <div
                  key={`blank-${index}`}
                  className="calendar-cell calendar-empty"
                  aria-hidden="true"
                />
              ),
            )}
          </div>
        </section>
        <aside className="settings-card calendar-details">
          <p className="eyebrow">ВЫБРАННЫЙ ДЕНЬ</p>
          <h2>{dateLabel(selectedDate)}</h2>
          <Link className="btn btn-secondary" href={`/stylist?date=${selectedDate}`}>
            <Icon name="sparkle" />
            Подобрать на эту дату
          </Link>
          {Object.entries(SLOTS).map(([slot, label]) => {
            const plan = state.plans.find(
              (item) => item.date === selectedDate && item.slot === slot,
            );
            const outfit = state.outfits.find((item) => item.id === plan?.outfitId);
            return (
              <div className="calendar-entry" key={slot}>
                <p className="eyebrow">{label}</p>
                {outfit ? (
                  <>
                    <h3>{outfit.name}</h3>
                    {!outfitStatus(outfit, state.items).complete && (
                      <p className="outfit-warning">
                        {outfit.missingItems?.length
                          ? 'Для этого образа ещё нужны покупки.'
                          : 'Проверьте состав: есть недоступные вещи.'}
                      </p>
                    )}
                    <div className="card-actions">
                      <AppButton
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setEditing({ ...plan })}
                      >
                        <Icon name="edit" />
                        Изменить
                      </AppButton>
                      <AppButton
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setDeleting(plan)}
                      >
                        <Icon name="trash" />
                        Убрать
                      </AppButton>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="item-meta">Пока без планов</p>
                    <AppButton
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => addPlan(slot)}
                    >
                      <Icon name="plus" />
                      Выбрать образ
                    </AppButton>
                  </>
                )}
              </div>
            );
          })}
        </aside>
      </div>
      {editing && (
        <PlanForm plan={editing} onClose={() => setEditing(null)} onSave={savedDate} />
      )}{' '}
      {deleting && (
        <ConfirmDialog
          title="Убрать план?"
          description={`${dateLabel(deleting.date)}, ${SLOTS[deleting.slot].toLocaleLowerCase('ru')}. Сохранённый образ останется в коллекции.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await removePlan(deleting.id);
            setDeleting(null);
          }}
        />
      )}
      {weekly && <WeeklyPlanner onClose={() => setWeekly(false)} />}
    </>
  );
}
