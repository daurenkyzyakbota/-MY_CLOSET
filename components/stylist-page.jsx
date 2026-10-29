'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useCloset } from './closet-provider.jsx';
import { CATEGORIES, localDate, SEASONS, validDate } from '../lib/model.js';
import { OCCASIONS, recommendOutfits, STYLE_OPTIONS } from '../lib/stylist.js';
import { buildMissingRecommendations, createStoreSearchLinks, shoppingDraftFromMissing } from '../lib/shopping.js';
import { manualOutfitWeather, outfitWeatherForDate } from '../lib/outfit-weather.js';
import { EmptyState, Field, Icon, ItemArt, Loading, PageHeader } from './ui.jsx';
import { CityPicker } from './settings-page.jsx';
import OutfitForm from './outfit-form.jsx';
import { ShoppingForm } from './shopping-page.jsx';

const unique = values => [...new Set(values)];
const degrees = value => Number.isFinite(value) ? Math.round(value) + '°' : '—';
const dateLabel = value => validDate(value) ? new Date(value + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Выберите дату';
const weatherGlyph = code => code === 0 ? 'sun' : code !== null && code >= 51 ? 'rain' : 'cloud';
function weatherDescription(code) {
  if (code === null || code === undefined) return 'Погода';
  if (code === 0) return 'Ясно';
  if (code <= 3) return 'Облачно';
  if (code <= 48) return 'Туман';
  if (code <= 67) return 'Дождь';
  if (code <= 77) return 'Снег';
  if (code <= 82) return 'Ливень';
  if (code <= 86) return 'Снегопад';
  return 'Гроза';
}

export default function StylistPage() {
  const { state, ready, loadWeather, weather, weatherLoading, weatherError } = useCloset();
  const [criteria, setCriteria] = useState(() => ({ occasion: 'everyday', style: 'any', season: '', date: localDate(), anchorItemId: '', weatherMode: 'auto', feelsLike: '', rainProbability: '', windSpeed: '' }));
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cityOpen, setCityOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [shopping, setShopping] = useState(null);
  const requestId = useRef(0);
  const variant = useRef(0);
  const wardrobeKey = JSON.stringify(state.items.map(item => [item.id, item.name, item.category, item.colors, item.seasons, item.style, item.available, item.favorite, item.warmth, item.rainproof]));
  const cityKey = state.profile.location ? state.profile.location.latitude + ',' + state.profile.location.longitude : '';
  useEffect(() => { requestId.current++; setResult(null); }, [wardrobeKey, cityKey]);
  useEffect(() => () => { requestId.current++; }, []);
  useEffect(() => {
    const date = new URLSearchParams(window.location.search).get('date');
    if (validDate(date)) setCriteria(previous => ({ ...previous, date }));
  }, []);

  function change(key, value) {
    requestId.current++;
    setCriteria(previous => ({ ...previous, [key]: value }));
    setResult(null); setError(''); variant.current = 0;
  }

  async function generate(event) {
    event?.preventDefault();
    if (busy) return;
    setError(''); setBusy(true); setResult(null);
    const currentRequest = ++requestId.current;
    try {
      if (!validDate(criteria.date)) throw new Error('Выберите корректную дату.');
      let conditions = null;
      if (criteria.weatherMode === 'manual') conditions = manualOutfitWeather(criteria);
      if (criteria.weatherMode === 'auto') {
        if (!state.profile.location) throw new Error('Выберите город или укажите погоду вручную.');
        const forecast = await loadWeather(criteria.date);
        if (!forecast) throw new Error('Прогноз недоступен. Укажите погоду вручную или выберите «Без погоды».');
        conditions = outfitWeatherForDate(forecast, criteria.date);
        if (!conditions) throw new Error('На эту дату прогноза пока нет. Выберите другую дату, ручной ввод или подбор без погоды.');
      }
      const options = { occasion: criteria.occasion, style: criteria.style, season: criteria.season, anchorItemId: criteria.anchorItemId, weather: conditions, variant: variant.current++, limit: 3 };
      const full = recommendOutfits(state.items, options);
      const partial = full.outfits.length ? null : buildMissingRecommendations(state.items, options, full);
      if (currentRequest !== requestId.current) return;
      setResult({ outfits: full.outfits.length ? full.outfits : partial.outfits, warnings: unique([...full.warnings, ...(partial?.warnings || [])]), missingCategories: full.missingCategories || [], options });
    } catch (cause) {
      if (currentRequest === requestId.current) setError(cause.message || 'Не удалось подобрать образ.');
    } finally { setBusy(false); }
  }

  function editRecommendation(outfit) {
    setEditing({ name: outfit.title, itemIds: [...outfit.itemIds], missingItems: outfit.missingItems || [], description: outfit.description, occasion: result.options.occasion, style: result.options.style === 'any' ? '' : result.options.style, season: result.options.season, favorite: false });
  }

  if (!ready) return <Loading/>;
  const day = weather?.days?.find(value => value.date === criteria.date);
  const current = criteria.date === localDate() && weather?.current?.dateTime?.slice(0, 10) === criteria.date ? weather.current : null;
  const weatherCode = current?.weatherCode ?? day?.weatherCode ?? null;
  const updated = weather?.updatedAt ? new Date(weather.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
  const hasPartial = result?.outfits.some(outfit => outfit.missingItems?.length);
  const missingCategories = (result?.missingCategories || []).filter(category => !state.items.some(item => item.category === category));
  const ownedBase = state.items.some(item => item.category === 'dress') || (state.items.some(item => item.category === 'top') && state.items.some(item => item.category === 'bottom'));
  const warnings = result ? result.warnings.filter(warning => !hasPartial || !warning.startsWith('Полный комплект не собран.')).map(warning => {
    if (warning.startsWith('Для указанного холода') && state.items.some(item => item.category === 'outerwear')) return 'Для холода нет подходящей верхней одежды. Проверьте характеристики своей вещи или измените условия подбора.';
    if (warning === 'Для основы нужны верх и низ либо платье.' && ownedBase) return 'Для выбранных условий не найдена подходящая основа. Проверьте доступность и сезон своих вещей.';
    return warning;
  }) : [];

  return <>
    <PageHeader title="Что наденем сегодня?" description="Ваш гардероб, новые сочетания и чуть больше времени для себя."/>
    <div className="stylist-intro"><span className="rule-badge"><Icon name="sparkle"/>Подбор по правилам</span><p>Учитываем повод, стиль, цвета, сезон и погоду. Сначала предложим готовые сочетания. Если чего-то не хватает — покажем, что можно добавить.</p></div>
    <div className="stylist-layout">
      <section className="settings-card stylist-controls">
        <p className="eyebrow">ВАШИ ПЛАНЫ</p><h2>Образ для вашего дня</h2>
        <form id="stylist-form" className="stylist-form" onSubmit={generate}>
          <fieldset disabled={busy} className="stylist-fields">
            <Field label="Куда собираетесь?"><select name="occasion" value={criteria.occasion} onChange={event => change('occasion', event.target.value)}>{Object.entries(OCCASIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
            <div className="form-grid">
              <Field label="Стиль"><select name="style" value={criteria.style} onChange={event => change('style', event.target.value)}>{Object.entries(STYLE_OPTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
              <Field label="Сезон"><select name="season" value={criteria.season} onChange={event => change('season', event.target.value)}><option value="">Любой сезон</option>{Object.entries(SEASONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
            </div>
            <Field label="На какую дату?"><input type="date" name="date" required min="1900-01-01" max="2200-12-31" value={criteria.date} onChange={event => change('date', event.target.value)}/></Field>
            <Field label="Начать с любимой вещи"><select name="anchorItemId" value={criteria.anchorItemId} onChange={event => change('anchorItemId', event.target.value)}><option value="">Довериться подбору</option>{state.items.filter(item => item.available).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <fieldset className="field"><legend>Как учитывать погоду?</legend><div className="weather-mode-options">{[['auto', 'Прогноз'], ['manual', 'Вручную'], ['none', 'Без погоды']].map(([key, label]) => <label className="weather-mode-option" key={key}><input type="radio" name="weatherMode" value={key} checked={criteria.weatherMode === key} onChange={() => change('weatherMode', key)}/><span>{label}</span></label>)}</div></fieldset>
            <div id="stylist-weather-panel">
              {criteria.weatherMode === 'none' && <p className="notice">Погода не учитывается. Подбор использует выбранный сезон, повод и сочетаемость вещей.</p>}
              {criteria.weatherMode === 'manual' && <div className="manual-weather form-grid">
                <Field label="Ощущаемая температура, °C *"><input name="feelsLike" type="number" required min="-80" max="60" step="0.1" value={criteria.feelsLike} onChange={event => change('feelsLike', event.target.value)} placeholder="Например, 12"/></Field>
                <Field label="Вероятность осадков, %"><input name="rainProbability" type="number" min="0" max="100" value={criteria.rainProbability} onChange={event => change('rainProbability', event.target.value)} placeholder="0–100"/></Field>
                <Field label="Ветер, м/с"><input name="windSpeed" type="number" min="0" max="75" step="0.1" value={criteria.windSpeed} onChange={event => change('windSpeed', event.target.value)} placeholder="Например, 3"/></Field>
                <p className="footnote full-width">Указано вручную для {dateLabel(criteria.date)}. Эти значения не являются прогнозом.</p>
              </div>}
              {criteria.weatherMode === 'auto' && <section className="settings-card weather-card" aria-label="Прогноз погоды">
                {!state.profile.location ? <div className="weather-placeholder"><span className="weather-symbol"><Icon name="cloud"/></span><div><p className="eyebrow">ПОГОДА И ВАШ ГАРДЕРОБ</p><h2>У каждого дня свой образ</h2><p>Выберите город, чтобы учитывать температуру, дождь и ветер при подборе.</p><button className="btn btn-secondary" type="button" onClick={() => setCityOpen(true)}><Icon name="pin"/>Выбрать город</button></div></div> : <>
                  <div className="weather-card-header"><div><p className="eyebrow">{dateLabel(criteria.date)}</p><h2 className="weather-location"><Icon name="pin"/>{state.profile.location.name}</h2></div><button className="btn btn-ghost" type="button" onClick={() => setCityOpen(true)}>Сменить город</button></div>
                  {weatherError && <p className="weather-error" role="alert">{weatherError} В стилисте можно указать погоду вручную.</p>}
                  {weatherLoading && <p className="weather-status" role="status">Загружаем прогноз…</p>}
                  {weather && !day && !current && <p className="weather-status">На выбранную дату прогноза пока нет. Укажите погоду вручную или выберите другую дату.</p>}
                  <div className="weather-current"><span className="weather-symbol"><Icon name={weatherGlyph(weatherCode)}/></span><strong className="weather-temperature">{current ? degrees(current.temperature) : day ? degrees(day.tempMin) + ' / ' + degrees(day.tempMax) : '—'}</strong><div><span>{day || current ? weatherDescription(weatherCode) : 'Прогноз ещё не загружен'}</span>{current ? <p className="item-meta">Сейчас · ощущается как {degrees(current.feelsLike)}</p> : day && <p className="item-meta">Ощущается {degrees(day.feelsMin)} / {degrees(day.feelsMax)}</p>}</div></div>
                  {(day || current) && <div className="weather-facts"><span><Icon name="rain"/>Вероятность осадков: {Number.isFinite(day?.rainProbability) ? day.rainProbability + '%' : 'нет данных'}</span><span><Icon name="wind"/>Ветер: {Number.isFinite(current?.windSpeed ?? day?.windSpeed) ? (current?.windSpeed ?? day?.windSpeed) + ' м/с' : 'нет данных'}</span></div>}
                  <div className="weather-meta">{weather ? <span>Источник: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>{updated && ' · обновлено ' + updated}</span> : <span>Прогноз появится при подключении к интернету.</span>}<button className="btn btn-ghost" type="button" disabled={weatherLoading} onClick={() => loadWeather(criteria.date, true)}><Icon name="refresh"/>Обновить</button></div>
                </>}
              </section>}
            </div>
            {error && <p id="stylist-error" className="form-error" role="alert">{error}</p>}
            <button className="btn btn-primary stylist-submit" type="submit" disabled={busy}><Icon name="sparkle"/>{busy ? 'Подбираем…' : 'Подобрать образ'}</button>
            <p className="footnote">Подбор работает без внешнего ИИ. Теплоту и защиту от дождя можно уточнить в карточке каждой вещи.</p>
          </fieldset>
        </form>
      </section>
      <section id="stylist-results" className="stylist-results" aria-live="polite">
        {!result ? <div className="stylist-waiting"><span className="empty-icon"><Icon name="sparkle"/></span><p className="eyebrow">ВАШЕ НОВОЕ СОЧЕТАНИЕ</p><h2>{busy ? 'Ищем ваши сочетания' : 'Вдохновение уже в гардеробе'}</h2><p>Выберите, куда собираетесь. Мы предложим до трёх сочетаний из ваших доступных вещей и объясним выбор.</p><div className="stylist-steps"><span>01 · Укажите повод</span><span>02 · Учтите погоду</span><span>03 · Сохраните образ</span></div></div> : <>
          <div className="stylist-results-header"><div><p className="eyebrow">ПОДОБРАНО ДЛЯ ВАС</p><h2>{hasPartial ? 'Что дополнит ваш гардероб' : result.outfits.length ? 'Готовые идеи на ваш день' : 'Пока не нашлось сочетания'}</h2><p>{dateLabel(criteria.date)} · {OCCASIONS[criteria.occasion]}</p></div>{result.outfits.length > 0 && <button className="btn btn-secondary" type="button" onClick={generate} disabled={busy}><Icon name="refresh"/>Ещё варианты</button>}</div>
          {warnings.map(message => <p className="notice" key={message}>{message}</p>)}
          {!hasPartial && missingCategories.length > 0 && <p className="notice">В вашем гардеробе пока нет: {missingCategories.map(category => CATEGORIES[category]).join(', ')}.</p>}
          {!result.outfits.length && (missingCategories.length > 0 ? <EmptyState title="В гардеробе не хватает деталей" description="Добавьте свои вещи недостающих категорий или измените условия подбора."><Link href="/wardrobe" className="btn btn-secondary"><Icon name="plus"/>Добавить вещь</Link></EmptyState> : <EmptyState icon="hanger" title="Проверьте условия подбора" description="Вещи уже есть в гардеробе. Проверьте доступность, сезон и погоду или соберите образ вручную."><Link href="/outfits" className="btn btn-secondary"><Icon name="outfits"/>Собрать вручную</Link></EmptyState>)}
          <div className="recommendation-grid">{result.outfits.map((outfit, index) => {
            const items = outfit.itemIds.map(id => state.items.find(item => item.id === id)).filter(Boolean);
            const missing = outfit.missingItems || [];
            return <article className="recommendation-card" key={index}>
              <div className="recommendation-preview"><span className="recommendation-number">0{index + 1}</span><div className="recommendation-pieces">{items.map(item => <div className="outfit-piece" key={item.id} title={item.name}><ItemArt item={item}/></div>)}{missing.map(item => <div className="missing-piece" key={item.id}><span className="missing-piece-icon"><Icon name="shopping"/></span><span className="missing-piece-label">Нужно добавить</span><strong>{item.name}</strong></div>)}</div></div>
              <div className="recommendation-body"><p className="eyebrow">{OCCASIONS[result.options.occasion]}</p><h3>{outfit.title}</h3>{missing.length > 0 && <p className="missing-outfit-badge">Требует покупки</p>}<p>{outfit.description}</p><div className="tag-row">{items.map(item => <span className="tag" key={item.id}>{item.name}</span>)}</div>
                {outfit.warnings.length > 0 && <p className="recommendation-caution">Проверьте рекомендации перед выходом</p>}
                <details className="recommendation-details"><summary>{outfit.warnings.length ? 'Почему этот образ · что проверить' : 'Почему этот образ?'}</summary>{outfit.reasons.length > 0 && <ul className="recommendation-reasons">{outfit.reasons.map(reason => <li key={reason}><Icon name="check"/>{reason}</li>)}</ul>}{outfit.warnings.map(warning => <p className="recommendation-warning" key={warning}>{warning}</p>)}</details>
                {missing.length > 0 && <details className="saved-missing-details"><summary>Что добавить · {missing.length}</summary>{missing.map(item => <div className="saved-missing-item" key={item.id}><strong>{item.name}</strong><p>{item.reason}</p><button className="btn btn-secondary" type="button" onClick={() => setShopping(shoppingDraftFromMissing(item))}><Icon name="shopping"/>В покупки</button><details className="shopping-store-links"><summary>Поиск похожих</summary><p className="footnote">Откроется поиск в магазине. Наличие, цены и подходящий размер проверяйте на его сайте.</p><div>{createStoreSearchLinks(item).map(store => <a className="shopping-link" key={store.id} href={store.url} target="_blank" rel="noopener noreferrer">{store.name}<Icon name="arrow-right"/></a>)}</div></details></div>)}</details>}
                <button className="btn btn-primary" type="button" onClick={() => editRecommendation(outfit)}><Icon name="plus"/>Изменить и сохранить</button>
              </div>
            </article>;
          })}</div>
        </>}
      </section>
    </div>
    {cityOpen && <CityPicker onClose={() => setCityOpen(false)}/>}
    {editing && <OutfitForm outfit={editing} onClose={() => setEditing(null)}/>}
    {shopping && <ShoppingForm entry={shopping} onClose={() => setShopping(null)}/>}
  </>;
}
