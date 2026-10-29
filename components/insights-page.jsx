'use client';

import { useMemo, useState } from 'react';
import { AppButton } from './app-button.jsx';
import { useCloset } from './closet-provider.jsx';
import { localDate, outfitStatus, validDate, WEAR_ITEM_LIMIT } from '@/lib/model.js';
import { getWearStatistics } from '@/lib/wardrobe-life.js';
import { ConfirmDialog, EmptyState, Field, Icon, ItemArt, Loading, Modal, PageHeader } from './ui.jsx';

const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

function WearForm({ onClose }) {
  const { state, markWorn } = useCloset();
  const [date, setDate] = useState(localDate());
  const [outfitId, setOutfitId] = useState('');
  const [itemIds, setItemIds] = useState([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const available = state.items.filter(item => item.available);
  const outfits = state.outfits.filter(outfit => outfitStatus(outfit, state.items).complete);
  async function save(event) {
    event.preventDefault(); if (busy) return; setError('');
    if (!validDate(date) || date > localDate()) { setError('Укажите сегодняшний или прошедший день.'); return; }
    setBusy(true);
    try { await markWorn({ date, outfitId, ...(outfitId ? {} : { itemIds }), notes: notes.trim() }); onClose(); }
    catch (cause) { setError(cause.message); setBusy(false); }
  }
  return <Modal title="Что вы надели?" description="Отмечайте реальные выходы — планы календаря не считаются ноской автоматически." onClose={() => { if (!busy) onClose(); }}>
    <form id="wear-form" onSubmit={save}><fieldset className="form-fieldset" disabled={busy}>
      <div className="form-grid"><Field label="Дата *"><input name="date" type="date" required min="1900-01-01" max={localDate()} value={date} onChange={event => setDate(event.target.value)}/></Field><Field label="Сохранённый образ"><select name="outfitId" value={outfitId} onChange={event => setOutfitId(event.target.value)}><option value="">Выберу вещи вручную</option>{outfits.map(outfit => <option key={outfit.id} value={outfit.id}>{outfit.name}</option>)}</select></Field></div>
      {!outfitId && <fieldset className="form-section"><legend>Вещи · выбрано {itemIds.length} из {WEAR_ITEM_LIMIT}</legend><div className="wear-item-choices">{available.map(item => <label className={`wear-item-choice${itemIds.includes(item.id) ? ' is-active' : ''}`} key={item.id}><input name="itemIds" type="checkbox" value={item.id} checked={itemIds.includes(item.id)} disabled={!itemIds.includes(item.id) && itemIds.length >= WEAR_ITEM_LIMIT} onChange={event => setItemIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/><span className="wear-item-art"><ItemArt item={item}/></span><span>{item.name}</span></label>)}</div>{!available.length && <p className="notice">Нет доступных вещей. Добавьте вещь в гардероб или верните её из стирки.</p>}</fieldset>}
      <Field label="Заметка"><textarea name="notes" rows={2} maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Например, прогулка в парке"/></Field>
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><AppButton className="button button-secondary" type="button" disabled={busy} onClick={onClose}>Отмена</AppButton><AppButton className="button button-primary" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить отметку'}</AppButton></div></form>
  </Modal>;
}

export default function InsightsPage() {
  const { state, ready, removeWear } = useCloset();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [tab, setTab] = useState('history');
  const [forgotten, setForgotten] = useState(false);
  const [shown, setShown] = useState(20);
  const today = localDate();
  const stats = useMemo(() => getWearStatistics(state, today), [state, today]);
  const recent = useMemo(() => [...state.wearLog].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)), [state.wearLog]);
  const rows = [...stats.items].filter(row => !forgotten || row.lastWorn === null || row.daysSinceLastWorn >= 30).sort((a, b) => forgotten ? (a.lastWorn || '').localeCompare(b.lastWorn || '') || a.item.name.localeCompare(b.item.name, 'ru') : b.wearCount - a.wearCount || a.item.name.localeCompare(b.item.name, 'ru'));
  const byId = new Map(state.items.map(item => [item.id, item]));
  const wornThisMonth = state.wearLog.filter(record => record.date <= today && record.date.startsWith(today.slice(0, 7))).length;
  if (!ready) return <Loading/>;
  return <>
    <PageHeader title="История вашего стиля" description="Любимые вещи, реальные выходы и идеи для того, что давно ждёт своего дня."><AppButton className="button button-primary" onClick={() => setAdding(true)}><Icon name="check"/>Отметить носку</AppButton></PageHeader>
    <div className="stats-grid bootstrap-layout"><div className="row bootstrap-stats-row">{[[stats.totalWears,'Реальных отметок','calendar'],[wornThisMonth,'В этом месяце','sun'],[stats.items.length-stats.neverWornCount,'Вещей носили','wardrobe'],[stats.neverWornCount,'Пока без отметок','hanger']].map(([value, label, icon]) => <div className="col-6 col-sm-3 bootstrap-grid-col d-flex" key={label}><div className="stat-card"><span className="stat-icon"><Icon name={icon}/></span><strong>{value}</strong><span>{label}</span></div></div>)}</div></div>
    <p className="footnote">Статистика строится только по вашим отметкам. Давно не носили — 30 дней и больше или ещё нет ни одной отметки.</p>
    <div className="life-tabs" role="group" aria-label="Раздел статистики"><AppButton className={`wardrobe-chip${tab==='history'?' is-active':''}`} aria-pressed={tab==='history'} onClick={() => setTab('history')}>История выходов</AppButton><AppButton className={`wardrobe-chip${tab==='items'?' is-active':''}`} aria-pressed={tab==='items'} onClick={() => setTab('items')}>Вещи и частота</AppButton></div>
    {tab === 'history' ? recent.length ? <div className="wear-history">{recent.slice(0, shown).map(record => <article className="settings-card wear-record" data-wear-id={record.id} key={record.id}><div className="wear-record-heading"><div><p className="eyebrow">{dateLabel(record.date)}</p><h3>{record.outfitId ? state.outfits.find(outfit => outfit.id === record.outfitId)?.name || 'Образ из истории' : 'Своё сочетание'}</h3></div><AppButton className="icon-button" aria-label={`Удалить отметку за ${record.date}`} onClick={() => setDeleting(record)}><Icon name="trash"/></AppButton></div><div className="wear-record-items">{record.itemIds.map(id => { const item = byId.get(id); return <div className="wear-record-item" key={id}><span className="wear-item-art">{item ? <ItemArt item={item}/> : <Icon name="hanger"/>}</span><span>{item?.name || 'Вещь удалена из гардероба'}</span></div>; })}</div>{record.notes && <p className="wear-note">{record.notes}</p>}</article>)}{shown < recent.length && <AppButton className="button button-secondary" onClick={() => setShown(value => value + 20)}>Показать ещё</AppButton>}</div> : <EmptyState icon="calendar" title="Каждый выход — часть вашей истории" description="Отметьте, что надели сегодня. Позже здесь появятся любимые сочетания и частота носки."><AppButton className="button button-primary" onClick={() => setAdding(true)}>Добавить первую отметку</AppButton></EmptyState> : <>
      <div className="insights-filter"><label className="checkbox-row"><input type="checkbox" checked={forgotten} onChange={event => setForgotten(event.target.checked)}/>Только то, что давно не носили</label><span className="footnote">Вещей: {rows.length}</span></div>
      {rows.length ? <div className="insights-items">{rows.map(row => <article className="settings-card insights-item" key={row.id}><span className="insights-item-art"><ItemArt item={row.item}/></span><div><h3>{row.item.name}</h3><p>Отметок носки: <strong>{row.wearCount}</strong></p><p className="footnote">{row.lastWorn ? `Последняя: ${dateLabel(row.lastWorn)}` : 'Ещё нет отметок'}</p></div>{row.wearCount > 0 && <span className="tag">{row.daysSinceLastWorn === 0 ? 'Сегодня' : `${row.daysSinceLastWorn} дн. назад`}</span>}</article>)}</div> : <EmptyState icon="wardrobe" title={state.items.length ? 'Вещи не найдены' : 'Здесь будет ваш гардероб'} description={state.items.length ? 'Все вещи носили недавно. Снимите фильтр, чтобы увидеть весь гардероб.' : 'Добавьте вещи, затем отмечайте реальные выходы.'}/>}
    </>}
    {adding && <WearForm onClose={() => setAdding(false)}/>}
    {deleting && <ConfirmDialog title="Удалить отметку носки?" description={`Выход за ${dateLabel(deleting.date)} будет удалён из истории. Вещи и образы останутся в гардеробе.`} onClose={() => setDeleting(null)} onConfirm={async () => { await removeWear(deleting.id); setDeleting(null); }}/>}
  </>;
}
