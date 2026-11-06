'use client';

import { useEffect, useRef, useState } from 'react';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { searchCities } from '@/lib/weather/weather-client.js';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Field, Icon, Modal } from '@/components/ui/ui.jsx';

export function CityPicker({ onClose }) {
  const { state, saveProfile } = useCloset();
  const [query, setQuery] = useState(state.profile.city);
  const [cities, setCities] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  async function findCity(event) {
    event.preventDefault();
    if (busy) return;
    const current = ++request.current;
    setBusy(true);
    setError('');
    setCities([]);
    try {
      const result = await searchCities(query.trim());
      if (current !== request.current) return;
      setCities(result.cities);
      if (!result.cities.length) setError('Город не найден. Попробуйте другое написание.');
    } catch (cause) {
      if (current === request.current) setError(cause.message || 'Не удалось найти город.');
    } finally {
      if (current === request.current) setBusy(false);
    }
  }

  async function choose(city) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await saveProfile({ city: city.name, location: city });
      onClose();
    } catch (cause) {
      setError(cause.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Выберите город"
      description="Найдите свой город и проверьте регион в результатах поиска."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form id="city-form" onSubmit={findCity}>
        <div className="city-picker">
          <Field label="Город">
            <input
              id="city-query"
              name="query"
              type="search"
              minLength={2}
              maxLength={80}
              required
              autoFocus
              placeholder="Например, Кызылорда"
              value={query}
              disabled={busy}
              onChange={(event) => {
                request.current++;
                setQuery(event.target.value);
                setCities([]);
                setError('');
              }}
            />
          </Field>
          <p className="footnote">
            Геолокация не нужна. Для поиска города и погоды используется Open-Meteo.
          </p>
          <div id="city-results" className="city-results" aria-live="polite">
            {busy && (
              <p className="weather-status" role="status">
                Ищем город…
              </p>
            )}
            {cities.map((city) => (
              <AppButton
                key={city.id}
                type="button"
                className="city-result"
                disabled={busy}
                onClick={() => choose(city)}
              >
                <span>
                  <Icon name="pin" />
                  <strong>{city.name}</strong>
                </span>
                <span className="city-result-meta">
                  {[city.admin1, city.country].filter(Boolean).join(', ')}
                </span>
              </AppButton>
            ))}
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <AppButton className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>
            Отмена
          </AppButton>
          <AppButton className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Ищем…' : 'Найти город'}
          </AppButton>
        </div>
      </form>
    </Modal>
  );
}
