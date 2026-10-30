'use client';

import { useState } from 'react';
import Checkbox from '@mui/material/Checkbox';
import LinearProgress from '@mui/material/LinearProgress';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { CATEGORIES, localDate, validDate } from '@/lib/data/model.js';
import { AppButton } from '@/components/ui/app-button.jsx';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import {
  ConfirmDialog,
  EmptyState,
  Field,
  Icon,
  ItemArt,
  Loading,
  Modal,
  PageHeader,
} from '@/components/ui/ui.jsx';

const dateLabel = (date) =>
  validDate(date)
    ? new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'Дата не указана';
const counted = (count, forms) =>
  `${count} ${forms[count % 100 >= 11 && count % 100 <= 14 ? 2 : count % 10 === 1 ? 0 : count % 10 >= 2 && count % 10 <= 4 ? 1 : 2]}`;

function selection(entry, state) {
  const outfits = (entry.outfitIds || []).map((id) =>
    state.outfits.find((outfit) => outfit.id === id),
  );
  const ids = [
    ...new Set([
      ...(entry.itemIds || []),
      ...outfits.filter(Boolean).flatMap((outfit) => outfit.itemIds),
    ]),
  ];
  const items = ids.map((id) => state.items.find((item) => item.id === id));
  return {
    ids,
    items: items.filter(Boolean),
    missingItems: ids.filter((id, index) => !items[index]),
    outfits: outfits.filter(Boolean),
    missingOutfits: (entry.outfitIds || []).filter((id, index) => !outfits[index]),
    incompleteOutfits: outfits.filter((outfit) => outfit?.missingItems?.length),
  };
}

function SelectionWarnings({ content }) {
  if (
    !content.missingItems.length &&
    !content.missingOutfits.length &&
    !content.incompleteOutfits.length
  )
    return null;
  return (
    <div className="notice collection-warning">
      <Icon name="warning" size={17} />
      <div>
        {content.missingItems.length > 0 && (
          <p>Удалённых вещей: {content.missingItems.length}. Проверьте состав и замените их.</p>
        )}
        {content.missingOutfits.length > 0 && (
          <p>
            Удалённых образов: {content.missingOutfits.length}. Ссылки можно убрать при
            редактировании.
          </p>
        )}
        {content.incompleteOutfits.length > 0 && (
          <p>
            В образах «{content.incompleteOutfits.map((outfit) => outfit.name).join('», «')}» есть
            недостающие детали. Они не включены в список своих вещей.
          </p>
        )}
      </div>
    </div>
  );
}

function CollectionForm({ entry, type, onClose }) {
  const { state, saveCapsule, saveTrip } = useCloset();
  const trip = type === 'trips';
  const [draft, setDraft] = useState(() => ({
    name: '',
    ...(trip
      ? {
          destination: '',
          startDate: localDate(),
          endDate: localDate(),
          notes: '',
          packedItemIds: [],
        }
      : { description: '' }),
    ...entry,
    itemIds: [...(entry?.itemIds || [])],
    outfitIds: [...(entry?.outfitIds || [])],
  }));
  const [query, setQuery] = useState('');
  const [picker, setPicker] = useState('items');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const content = selection(draft, state);
  const visibleItems = state.items.filter((item) =>
    `${item.name} ${item.style || ''} ${CATEGORIES[item.category]}`
      .toLocaleLowerCase('ru')
      .includes(query.trim().toLocaleLowerCase('ru')),
  );
  const visibleOutfits = state.outfits.filter((outfit) =>
    `${outfit.name} ${outfit.description || ''}`
      .toLocaleLowerCase('ru')
      .includes(query.trim().toLocaleLowerCase('ru')),
  );
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const toggle = (key, id) =>
    setDraft((current) => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter((value) => value !== id)
        : [...current[key], id],
    }));
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (!draft.name.trim()) {
      setError('Введите название.');
      return;
    }
    if (
      trip &&
      (!validDate(draft.startDate) || !validDate(draft.endDate) || draft.endDate < draft.startDate)
    ) {
      setError('Проверьте даты: возвращение не может быть раньше начала поездки.');
      return;
    }
    if (
      trip &&
      (Date.parse(`${draft.endDate}T00:00:00Z`) - Date.parse(`${draft.startDate}T00:00:00Z`)) /
        86400000 >
        365
    ) {
      setError('Продолжительность одной поездки — не более 365 дней.');
      return;
    }
    if (!trip && !draft.itemIds.length && !draft.outfitIds.length) {
      setError('Выберите хотя бы одну вещь или образ для капсулы.');
      return;
    }
    setSaving(true);
    try {
      const result = {
        ...draft,
        name: draft.name.trim(),
        ...(trip
          ? {
              destination: draft.destination.trim(),
              notes: draft.notes.trim(),
              itemIds: [...content.ids],
              packedItemIds: (draft.packedItemIds || []).filter((id) => content.ids.includes(id)),
            }
          : { description: draft.description.trim() }),
      };
      await (trip ? saveTrip(result) : saveCapsule(result));
      onClose();
    } catch (cause) {
      setError(cause.message || 'Не удалось сохранить коллекцию.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={
        entry?.id
          ? trip
            ? 'Изменить поездку'
            : 'Изменить капсулу'
          : trip
            ? 'Новая поездка'
            : 'Новая капсула'
      }
      description={
        trip
          ? 'Соберите вещи и образы в дорогу, затем отмечайте всё упакованное.'
          : 'Объедините вещи и образы одной идеей, сезоном или настроением.'
      }
      onClose={saving ? () => {} : onClose}
    >
      <form onSubmit={submit}>
        <fieldset className="form-fieldset" disabled={saving}>
          <div className="form-grid">
            <Field label="Название *" className="field-full">
              <input
                required
                autoFocus
                maxLength={100}
                value={draft.name}
                placeholder={trip ? 'Например, выходные в Алматы' : 'Например, спокойная осень'}
                onChange={(event) => set('name', event.target.value)}
              />
            </Field>
            {trip ? (
              <>
                <Field label="Куда едем" className="field-full">
                  <input
                    maxLength={120}
                    value={draft.destination}
                    placeholder="Город или место"
                    onChange={(event) => set('destination', event.target.value)}
                  />
                </Field>
                <Field label="Начало поездки *">
                  <input
                    required
                    type="date"
                    min="1900-01-01"
                    max="2200-12-31"
                    value={draft.startDate}
                    onChange={(event) => set('startDate', event.target.value)}
                  />
                </Field>
                <Field label="Возвращение *">
                  <input
                    required
                    type="date"
                    min={validDate(draft.startDate) ? draft.startDate : '1900-01-01'}
                    max="2200-12-31"
                    value={draft.endDate}
                    onChange={(event) => set('endDate', event.target.value)}
                  />
                </Field>
                <Field label="Заметки" className="field-full">
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={draft.notes}
                    placeholder="Планы, дресс-код и всё, о чём хочется помнить"
                    onChange={(event) => set('notes', event.target.value)}
                  />
                </Field>
              </>
            ) : (
              <Field label="Идея капсулы" className="field-full">
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={draft.description}
                  placeholder="Для чего эти вещи и как вы хотите их сочетать"
                  onChange={(event) => set('description', event.target.value)}
                />
              </Field>
            )}
          </div>
          <div className="collection-selection-summary">
            <span>
              Своих вещей: <strong>{content.items.length}</strong>
            </span>
            <span>
              Образов: <strong>{draft.outfitIds.length}</strong>
            </span>
          </div>
          <SelectionWarnings content={content} />
          {(content.missingItems.length > 0 || content.missingOutfits.length > 0) && (
            <div className="collection-stale-references">
              {content.missingItems
                .filter((id) => draft.itemIds.includes(id))
                .map((id) => (
                  <AppButton
                    key={id}
                    className="button button-secondary button-small"
                    onClick={() => toggle('itemIds', id)}
                  >
                    <Icon name="close" />
                    Убрать удалённую вещь
                  </AppButton>
                ))}
              {content.missingOutfits.map((id) => (
                <AppButton
                  key={id}
                  className="button button-secondary button-small"
                  onClick={() => toggle('outfitIds', id)}
                >
                  <Icon name="close" />
                  Убрать удалённый образ
                </AppButton>
              ))}
            </div>
          )}
          <div className="collection-picker-heading">
            <h3>{trip ? 'Что берём с собой' : 'Состав капсулы'}</h3>
            <p className="field-hint">
              {trip
                ? 'При сохранении вещи из выбранных образов добавятся в список поездки. '
                : 'Вещи из выбранных образов учитываются автоматически. '}
              Недоступные вещи можно добавить и подготовить заранее.
            </p>
          </div>
          <Tabs
            value={picker}
            onChange={(_event, value) => {
              setPicker(value);
              setQuery('');
            }}
            aria-label="Выбор состава"
            className="collection-tabs"
            variant="fullWidth"
          >
            <Tab
              value="items"
              label="Мои вещи"
              id="collection-picker-items"
              aria-controls="collection-picker-panel-items"
            />
            <Tab
              value="outfits"
              label="Мои образы"
              id="collection-picker-outfits"
              aria-controls="collection-picker-panel-outfits"
            />
          </Tabs>
          <Field
            label={picker === 'items' ? 'Найти вещь' : 'Найти образ'}
            className="collection-search"
          >
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Введите название"
            />
          </Field>
          <div
            role="tabpanel"
            id={`collection-picker-panel-${picker}`}
            aria-labelledby={`collection-picker-${picker}`}
          >
            {picker === 'items' ? (
              <div className="collection-item-picker">
                {visibleItems.map((item) => (
                  <label
                    key={item.id}
                    className={`collection-choice${draft.itemIds.includes(item.id) ? ' is-selected' : ''}`}
                  >
                    <div className="collection-choice-art">
                      <ItemArt item={item} />
                    </div>
                    <div className="collection-choice-copy">
                      <strong>{item.name}</strong>
                      <span>
                        {item.available
                          ? CATEGORIES[item.category]
                          : 'Недоступна · подготовить заранее'}
                        {!draft.itemIds.includes(item.id) && content.ids.includes(item.id)
                          ? ' · входит в образ'
                          : ''}
                      </span>
                    </div>
                    <Checkbox
                      size="small"
                      checked={draft.itemIds.includes(item.id)}
                      onChange={() => toggle('itemIds', item.id)}
                      slotProps={{ input: { 'aria-label': `Выбрать вещь ${item.name}` } }}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <div className="collection-outfit-picker">
                {visibleOutfits.map((outfit) => (
                  <label
                    className={`collection-choice collection-outfit-choice${draft.outfitIds.includes(outfit.id) ? ' is-selected' : ''}`}
                    key={outfit.id}
                  >
                    <div className="collection-outfit-mini">
                      {outfit.itemIds.slice(0, 3).map((id) => {
                        const item = state.items.find((value) => value.id === id);
                        return item ? (
                          <div key={id}>
                            <ItemArt item={item} />
                          </div>
                        ) : null;
                      })}
                      {!outfit.itemIds.length && <Icon name="outfits" />}
                    </div>
                    <div className="collection-choice-copy">
                      <strong>{outfit.name}</strong>
                      <span>
                        {outfit.itemIds.length} вещей
                        {outfit.missingItems?.length ? ' · есть недостающие детали' : ''}
                        {outfit.itemIds.some((id) => !state.items.some((item) => item.id === id))
                          ? ' · есть удалённые вещи'
                          : ''}
                      </span>
                    </div>
                    <Checkbox
                      size="small"
                      checked={draft.outfitIds.includes(outfit.id)}
                      onChange={() => toggle('outfitIds', outfit.id)}
                      slotProps={{ input: { 'aria-label': `Выбрать образ ${outfit.name}` } }}
                    />
                  </label>
                ))}
              </div>
            )}
            {(picker === 'items' ? !visibleItems.length : !visibleOutfits.length) && (
              <p className="collection-picker-empty">
                {query
                  ? 'По этому запросу ничего не нашлось.'
                  : picker === 'items'
                    ? 'В гардеробе пока нет вещей. Добавьте их в разделе «Гардероб».'
                    : 'Сохраните образ в разделе «Образы», и он появится здесь.'}
              </p>
            )}
          </div>
        </fieldset>
        {error && (
          <p className="notice notice-error form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <AppButton className="button button-secondary" disabled={saving} onClick={onClose}>
            Отмена
          </AppButton>
          <AppButton type="submit" className="button button-primary" disabled={saving}>
            <Icon name="check" />
            {saving ? 'Сохраняем…' : trip ? 'Сохранить поездку' : 'Сохранить капсулу'}
          </AppButton>
        </div>
      </form>
    </Modal>
  );
}

function CollectionCard({ entry, trip, onEdit, onDelete }) {
  const { state, toggleTripPacked } = useCloset();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const linkedContent = selection(entry, state);
  const content = trip
    ? {
        ...linkedContent,
        items: (entry.itemIds || [])
          .map((id) => state.items.find((item) => item.id === id))
          .filter(Boolean),
      }
    : linkedContent;
  const changedOutfitItems = trip
    ? linkedContent.ids.filter((id) => !entry.itemIds.includes(id))
    : [];
  const packed = content.items.filter((item) => entry.packedItemIds?.includes(item.id)).length;
  const packingTotal = trip ? entry.itemIds.length : 0;
  const percent = packingTotal ? Math.round((packed / packingTotal) * 100) : 0;
  async function pack(id) {
    if (busy) return;
    setBusy(id);
    setError('');
    try {
      await toggleTripPacked(entry.id, id);
    } catch (cause) {
      setError(cause.message || 'Не удалось обновить список.');
    } finally {
      setBusy('');
    }
  }
  return (
    <article className="collection-card">
      <div className="collection-card-top">
        <span className="collection-kind">
          <Icon name={trip ? 'shopping' : 'outfits'} size={16} />
          {trip ? 'В ДОРОГУ' : 'КАПСУЛА'}
        </span>
        <div className="collection-card-actions">
          <AppButton className="icon-button" aria-label={`Изменить ${entry.name}`} onClick={onEdit}>
            <Icon name="edit" />
          </AppButton>
          <AppButton
            className="icon-button"
            aria-label={`Удалить ${entry.name}`}
            onClick={onDelete}
          >
            <Icon name="trash" />
          </AppButton>
        </div>
      </div>
      <h2>{entry.name}</h2>
      {trip && (
        <p className="collection-destination">
          <Icon name="pin" size={16} />
          {entry.destination || 'Место пока не выбрано'}
        </p>
      )}
      <div className="collection-cover">
        {content.items.slice(0, 4).map((item) => (
          <div className="collection-piece" key={item.id}>
            <ItemArt item={item} />
          </div>
        ))}
        {!content.items.length && (
          <div className="collection-cover-empty">
            <Icon name={trip ? 'shopping' : 'wardrobe'} size={36} />
            <span>{trip ? 'Чемодан ждёт первых вещей' : 'Добавьте вещи в капсулу'}</span>
          </div>
        )}
      </div>
      <div className="collection-meta">
        <span>{counted(content.items.length, ['вещь', 'вещи', 'вещей'])}</span>
        <span>{counted(content.outfits.length, ['образ', 'образа', 'образов'])}</span>
        {trip && (
          <span>
            {dateLabel(entry.startDate)} — {dateLabel(entry.endDate)}
          </span>
        )}
      </div>
      {(trip ? entry.notes : entry.description) && (
        <p className="collection-description">{trip ? entry.notes : entry.description}</p>
      )}
      <SelectionWarnings content={content} />
      {changedOutfitItems.length > 0 && (
        <p className="notice collection-warning">
          В выбранных образах изменился состав. Откройте поездку и сохраните её, чтобы добавить
          новые вещи в список сборов.
        </p>
      )}
      {content.outfits.length > 0 && (
        <div className="collection-outfit-tags" aria-label="Выбранные образы">
          {content.outfits.map((outfit) => (
            <span className="tag" key={outfit.id}>
              {outfit.name}
            </span>
          ))}
        </div>
      )}
      {trip ? (
        <div className="packing-section">
          <div className="packing-heading">
            <strong>
              {packingTotal > 0 && packed === packingTotal ? 'Всё собрано' : 'Собираем чемодан'}
            </strong>
            <span>
              {packed} из {packingTotal}
            </span>
          </div>
          <LinearProgress
            className="packing-progress"
            variant="determinate"
            value={percent}
            aria-label={`Собрано ${packed} из ${packingTotal} вещей`}
          />
          {content.items.length ? (
            <details className="packing-details">
              <summary>Список вещей · {percent}%</summary>
              <div className="packing-list">
                {content.items.map((item) => (
                  <label
                    key={item.id}
                    className={`packing-item${entry.packedItemIds?.includes(item.id) ? ' is-packed' : ''}`}
                  >
                    <Checkbox
                      size="small"
                      checked={entry.packedItemIds?.includes(item.id) || false}
                      disabled={!!busy}
                      onChange={() => pack(item.id)}
                      slotProps={{ input: { 'aria-label': `Упаковано: ${item.name}` } }}
                    />
                    <span>
                      {item.name}
                      {!item.available && <small>Недоступна · подготовьте перед поездкой</small>}
                    </span>
                  </label>
                ))}
              </div>
            </details>
          ) : (
            <p className="field-hint">Выберите вещи или образы, чтобы начать сборы.</p>
          )}
          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        content.items.length > 0 && (
          <details className="capsule-details">
            <summary>Все вещи капсулы</summary>
            <ul>
              {content.items.map((item) => (
                <li key={item.id}>
                  {item.name}
                  {!item.available && <span> · недоступна</span>}
                </li>
              ))}
            </ul>
          </details>
        )
      )}
    </article>
  );
}

export default function CollectionsPage() {
  const { state, ready, removeCapsule, removeTrip } = useCloset();
  const [tab, setTab] = useState('capsules');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  if (!ready) return <Loading />;
  const entries = state[tab] || [];
  const trip = tab === 'trips';
  return (
    <>
      <PageHeader
        title="Коллекции и поездки"
        description="Меньше суеты при выборе. Соберите свои вещи по идее или направлению."
      >
        <AppButton
          className="button button-primary"
          onClick={() => setEditing({ type: tab, entry: null })}
        >
          <Icon name="plus" />
          {trip ? 'Новая поездка' : 'Новая капсула'}
        </AppButton>
      </PageHeader>
      <div className="collection-intro">
        <div className="collection-intro-icon">
          <Icon name={trip ? 'shopping' : 'outfits'} size={28} />
        </div>
        <div>
          <p className="eyebrow">{trip ? 'ЛЁГКИЕ СБОРЫ' : 'ПРОДУМАННЫЙ ГАРДЕРОБ'}</p>
          <h2>{trip ? 'Всё нужное — в одном списке' : 'Любимые вещи, больше сочетаний'}</h2>
          <p>
            {trip
              ? 'Выберите вещи и готовые образы. Отмечайте упакованное, чтобы ничего не забыть.'
              : 'Капсула объединяет вещи одной идеей: для работы, сезона или спокойных выходных.'}
          </p>
        </div>
      </div>
      <Tabs
        className="collection-tabs collection-page-tabs"
        value={tab}
        onChange={(_event, value) => setTab(value)}
        aria-label="Коллекции и поездки"
        variant="fullWidth"
      >
        <Tab
          id="collections-tab-capsules"
          value="capsules"
          label={`Капсулы · ${(state.capsules || []).length}`}
          aria-controls="collections-panel-capsules"
        />
        <Tab
          id="collections-tab-trips"
          value="trips"
          label={`Поездки · ${(state.trips || []).length}`}
          aria-controls="collections-panel-trips"
        />
      </Tabs>
      <section
        role="tabpanel"
        id={`collections-panel-${tab}`}
        aria-labelledby={`collections-tab-${tab}`}
      >
        {entries.length ? (
          <div className="collections-grid">
            {entries.map((entry) => (
              <CollectionCard
                key={entry.id}
                entry={entry}
                trip={trip}
                onEdit={() => setEditing({ type: tab, entry })}
                onDelete={() => setDeleting({ type: tab, entry })}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={trip ? 'shopping' : 'outfits'}
            title={trip ? 'Куда отправимся?' : 'Ваша первая капсула'}
            description={
              trip
                ? 'Создайте поездку, выберите даты и соберите список своих вещей.'
                : 'Выберите свои вещи и образы, которые хочется носить вместе.'
            }
          >
            <AppButton
              className="button button-primary"
              onClick={() => setEditing({ type: tab, entry: null })}
            >
              <Icon name="plus" />
              {trip ? 'Создать поездку' : 'Создать капсулу'}
            </AppButton>
          </EmptyState>
        )}
      </section>
      {editing && (
        <CollectionForm
          type={editing.type}
          entry={editing.entry}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={deleting.type === 'trips' ? 'Удалить поездку?' : 'Удалить капсулу?'}
          description={`«${deleting.entry.name}» будет удалена${deleting.type === 'trips' ? ' вместе с отметками сборов' : ''}. Вещи и образы останутся в гардеробе.`}
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            deleting.type === 'trips'
              ? removeTrip(deleting.entry.id)
              : removeCapsule(deleting.entry.id)
          }
        />
      )}
    </>
  );
}
