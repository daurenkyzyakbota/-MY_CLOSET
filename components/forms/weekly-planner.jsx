'use client';

import { useEffect, useState } from 'react';
import Checkbox from '@mui/material/Checkbox';
import { localDate } from '@/lib/data/model.js';
import { OCCASIONS, STYLE_OPTIONS } from '@/lib/styling/stylist.js';
import { manualOutfitWeather } from '@/lib/styling/outfit-weather.js';
import { buildWeekSuggestions } from '@/lib/styling/week-planner.js';
import { AppButton } from '@/components/ui/app-button.jsx';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { Field, Icon, ItemArt, Loading, Modal } from '@/components/ui/ui.jsx';

const labelDate = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
const dayKey = (value) => `${value.date}:${value.slot}`;
const counted = (count, forms) =>
  `${count} ${forms[count % 100 >= 11 && count % 100 <= 14 ? 2 : count % 10 === 1 ? 0 : count % 10 >= 2 && count % 10 <= 4 ? 1 : 2]}`;

export default function WeeklyPlanner({ onClose }) {
  const { state, ready, weather, weatherLoading, weatherError, saveWeek } = useCloset();
  const [criteria, setCriteria] = useState(() => ({
    startDate: localDate(),
    slot: 'day',
    occasion: 'everyday',
    style: 'any',
    weatherMode: 'auto',
    feelsLike: '',
    rainProbability: '',
    windSpeed: '',
  }));
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setPreview(null);
    setSelected([]);
  }, [state.items, state.outfits, state.plans, weather]);
  function change(key, value) {
    setCriteria((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setSelected([]);
    setError('');
  }
  function generate(event) {
    event.preventDefault();
    setError('');
    try {
      const result = buildWeekSuggestions({
        items: state.items,
        outfits: state.outfits,
        plans: state.plans,
        ...criteria,
        forecast: weather,
        manualWeather: criteria.weatherMode === 'manual' ? manualOutfitWeather(criteria) : null,
      });
      setPreview(result);
      setSelected(result.proposals.map(dayKey));
    } catch (cause) {
      setError(cause.message || 'Не удалось составить неделю.');
    }
  }
  async function save() {
    if (saving || !preview) return;
    const proposals = preview.proposals.filter((proposal) => selected.includes(dayKey(proposal)));
    if (!proposals.length) {
      setError('Выберите хотя бы один день для сохранения.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveWeek(proposals);
      onClose();
    } catch (cause) {
      setError(cause.message || 'Не удалось сохранить неделю. Планы не изменены.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Образы на неделю"
      description="Семь дней из вашего гардероба. Выберите предложения, которые хотите добавить в календарь."
      onClose={saving ? () => {} : onClose}
    >
      {!ready ? (
        <Loading />
      ) : (
        <div className="week-planner">
          <form onSubmit={generate}>
            <fieldset className="form-fieldset" disabled={saving}>
              <div className="form-grid">
                <Field label="Первый день *">
                  <input
                    type="date"
                    required
                    min={localDate()}
                    max="2200-12-25"
                    value={criteria.startDate}
                    onChange={(event) => change('startDate', event.target.value)}
                  />
                </Field>
                <Field label="Время дня">
                  <select
                    value={criteria.slot}
                    onChange={(event) => change('slot', event.target.value)}
                  >
                    <option value="day">День</option>
                    <option value="evening">Вечер</option>
                  </select>
                </Field>
                <Field label="Повод">
                  <select
                    value={criteria.occasion}
                    onChange={(event) => change('occasion', event.target.value)}
                  >
                    {Object.entries(OCCASIONS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Стиль">
                  <select
                    value={criteria.style}
                    onChange={(event) => change('style', event.target.value)}
                  >
                    {Object.entries(STYLE_OPTIONS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Учитывать погоду" className="field-full">
                  <select
                    value={criteria.weatherMode}
                    onChange={(event) => change('weatherMode', event.target.value)}
                  >
                    <option value="auto">Доступный прогноз для моего города</option>
                    <option value="manual">Указать условия для всей недели</option>
                    <option value="none">Без проверки погоды</option>
                  </select>
                </Field>
                {criteria.weatherMode === 'manual' && (
                  <>
                    <Field label="Ощущается, °C *">
                      <input
                        type="number"
                        required
                        min="-80"
                        max="60"
                        step="0.1"
                        value={criteria.feelsLike}
                        onChange={(event) => change('feelsLike', event.target.value)}
                      />
                    </Field>
                    <Field label="Осадки, %">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={criteria.rainProbability}
                        onChange={(event) => change('rainProbability', event.target.value)}
                      />
                    </Field>
                    <Field label="Ветер, м/с">
                      <input
                        type="number"
                        min="0"
                        max="75"
                        step="0.1"
                        value={criteria.windSpeed}
                        onChange={(event) => change('windSpeed', event.target.value)}
                      />
                    </Field>
                  </>
                )}
              </div>
              {criteria.weatherMode === 'auto' && (
                <p className="field-hint week-weather-note">
                  {weatherLoading
                    ? 'Получаем прогноз…'
                    : !state.profile.location
                      ? 'Город не выбран. Дни будут предложены без проверки погоды; город можно выбрать в настройках.'
                      : weatherError
                        ? `Прогноз недоступен: ${weatherError}`
                        : `Используем доступные даты прогноза: ${state.profile.city || 'ваш город'}. На остальные дни погоду нужно проверить самостоятельно.`}
                </p>
              )}
              <p className="field-hint">
                Подбор по правилам использует только ваши доступные вещи. Уже занятые промежутки
                остаются без изменений.
              </p>
              <AppButton type="submit" className="button button-secondary" disabled={saving}>
                <Icon name={preview ? 'refresh' : 'sparkle'} />
                {preview ? 'Подобрать заново' : 'Подобрать семь дней'}
              </AppButton>
            </fieldset>
          </form>
          {preview && (
            <section className="week-preview" aria-label="Предложения на семь дней">
              <div className="week-preview-heading">
                <h3>Ваша неделя</h3>
                <span>
                  {counted(preview.proposals.length, ['предложение', 'предложения', 'предложений'])}{' '}
                  · {counted(preview.uniqueOutfits, ['сочетание', 'сочетания', 'сочетаний'])}
                </span>
              </div>
              {preview.warnings.length > 0 && (
                <div className="notice">
                  {preview.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}
              <div className="week-days">
                {preview.days.map((day) => {
                  const proposal = day.proposal;
                  const existing =
                    day.existingPlan &&
                    state.outfits.find((outfit) => outfit.id === day.existingPlan.outfitId);
                  return (
                    <article key={day.date} className={`week-day week-day-${day.status}`}>
                      <div className="week-day-header">
                        {proposal ? (
                          <label className="week-day-select">
                            <Checkbox
                              size="small"
                              checked={selected.includes(dayKey(day))}
                              disabled={saving}
                              onChange={() =>
                                setSelected((current) =>
                                  current.includes(dayKey(day))
                                    ? current.filter((key) => key !== dayKey(day))
                                    : [...current, dayKey(day)],
                                )
                              }
                              slotProps={{
                                input: { 'aria-label': `Добавить ${labelDate(day.date)}` },
                              }}
                            />
                            <strong>{labelDate(day.date)}</strong>
                          </label>
                        ) : (
                          <strong>{labelDate(day.date)}</strong>
                        )}
                        <span className="tag">
                          {day.status === 'occupied'
                            ? 'Уже запланировано'
                            : day.status === 'unavailable'
                              ? 'Нужны вещи'
                              : 'Предложение'}
                        </span>
                      </div>
                      {proposal ? (
                        <>
                          <div className="week-outfit-pieces">
                            {proposal.outfit.itemIds.map((id) => {
                              const item = state.items.find((value) => value.id === id);
                              return item ? (
                                <div className="collection-piece" key={id} title={item.name}>
                                  <ItemArt item={item} />
                                </div>
                              ) : null;
                            })}
                          </div>
                          <h4>{proposal.outfit.name}</h4>
                          <p className="field-hint">{day.explanation}</p>
                          <p className="week-weather-copy">
                            <Icon name={day.weather ? 'cloud' : 'info'} size={16} />
                            {Number.isFinite(day.weather?.feelsLike)
                              ? `Ощущается ${Math.round(day.weather.feelsLike)}°C. `
                              : ''}
                            {day.weatherNote}
                          </p>
                          {!!day.warnings.length && (
                            <details className="week-explanations">
                              <summary>Что проверить перед выходом</summary>
                              <ul>
                                {day.warnings.map((warning) => (
                                  <li key={warning}>{warning}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </>
                      ) : (
                        <p className="field-hint">
                          {existing && (
                            <>
                              <b>{existing.name}</b>
                              <br />
                            </>
                          )}
                          {day.reason}
                          {day.status === 'unavailable' && (
                            <>
                              <br />
                              {day.weatherNote}
                            </>
                          )}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {error && (
            <p className="notice notice-error form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <AppButton className="button button-secondary" disabled={saving} onClick={onClose}>
              Закрыть
            </AppButton>
            <AppButton
              className="button button-primary"
              disabled={saving || !selected.length}
              onClick={save}
            >
              <Icon name="calendar" />
              {saving
                ? 'Сохраняем…'
                : `В календарь${selected.length ? ` · ${selected.length}` : ''}`}
            </AppButton>
          </div>
        </div>
      )}
    </Modal>
  );
}
