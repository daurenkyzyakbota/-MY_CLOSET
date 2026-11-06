// Open-Meteo is called only by the local server, through fixed HTTPS endpoints.
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const BODY_LIMIT = 256 * 1024;
const WEATHER_CODES = new Set([
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86,
  95, 96, 99,
]);

export class WeatherError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'WeatherError';
    this.status = status;
  }
}
const invalidProvider = () =>
  new WeatherError(502, 'Сервис погоды вернул неполные данные. Попробуйте обновить прогноз позже.');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value, min = -Infinity, max = Infinity) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
const weatherCode = (value) => (WEATHER_CODES.has(value) ? value : null);
const shortText = (value, limit = 160) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';

function validDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function validDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))
    return false;
  return (
    validDate(value.slice(0, 10)) &&
    Number(value.slice(11, 13)) <= 23 &&
    Number(value.slice(14, 16)) <= 59 &&
    (value.length === 16 || Number(value.slice(17, 19)) <= 59)
  );
}
function validTimezone(value) {
  if (typeof value !== 'string' || !value || value.length > 100) return null;
  try {
    new Intl.DateTimeFormat('ru', { timeZone: value });
    return value;
  } catch {
    return null;
  }
}
function single(params, name) {
  if (params.getAll(name).length > 1)
    throw new WeatherError(400, 'Параметры запроса не должны повторяться.');
  return params.get(name);
}

export function validateCityQuery(params) {
  const raw = single(params, 'q');
  const query = typeof raw === 'string' ? raw.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  if (query.length < 2 || query.length > 80 || /[\u0000-\u001f\u007f]/.test(raw || '')) {
    throw new WeatherError(400, 'Введите название города: от 2 до 80 символов.');
  }
  return query;
}

export function validateWeatherQuery(params) {
  const parseCoordinate = (key, limit) => {
    const raw = single(params, key);
    if (raw === null || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) {
      throw new WeatherError(400, 'Выберите город из результатов поиска.');
    }
    const number = Number(raw);
    if (!Number.isFinite(number) || Math.abs(number) > limit)
      throw new WeatherError(400, 'Координаты города указаны неверно.');
    return number;
  };
  const latitude = parseCoordinate('lat', 90);
  const longitude = parseCoordinate('lon', 180);
  const refresh = single(params, 'refresh');
  if (refresh !== null && refresh !== '0' && refresh !== '1')
    throw new WeatherError(400, 'Некорректный запрос обновления прогноза.');
  return { latitude, longitude, refresh: refresh === '1' };
}

export function normalizeCities(data) {
  if (!isObject(data) || data.error || (data.results !== undefined && !Array.isArray(data.results)))
    throw invalidProvider();
  const seen = new Set();
  const cities = [];
  for (const city of (data.results || []).slice(0, 100)) {
    const timezone = validTimezone(city?.timezone);
    if (
      !isObject(city) ||
      !Number.isSafeInteger(city.id) ||
      city.id <= 0 ||
      !shortText(city.name) ||
      finite(city.latitude, -90, 90) === null ||
      finite(city.longitude, -180, 180) === null ||
      !timezone ||
      seen.has(city.id)
    )
      continue;
    seen.add(city.id);
    cities.push({
      id: city.id,
      name: shortText(city.name, 120),
      country: shortText(city.country, 100),
      admin1: shortText(city.admin1, 120),
      latitude: city.latitude,
      longitude: city.longitude,
      timezone,
    });
    if (cities.length === 6) break;
  }
  return { cities };
}

export function normalizeForecast(data, updatedAt = new Date().toISOString()) {
  if (
    !isObject(data) ||
    data.error ||
    finite(data.latitude, -90, 90) === null ||
    finite(data.longitude, -180, 180) === null ||
    !validTimezone(data.timezone) ||
    !isObject(data.daily) ||
    !Array.isArray(data.daily.time) ||
    data.daily.time.length < 1 ||
    data.daily.time.length > 16
  )
    throw invalidProvider();
  const daily = data.daily;
  const fields = [
    'temperature_2m_min',
    'temperature_2m_max',
    'apparent_temperature_min',
    'apparent_temperature_max',
    'precipitation_probability_max',
    'wind_speed_10m_max',
    'weather_code',
  ];
  for (const field of fields)
    if (daily[field] !== undefined && !Array.isArray(daily[field])) throw invalidProvider();
  const seen = new Set();
  const days = daily.time
    .map((date, index) => {
      if (!validDate(date) || seen.has(date)) throw invalidProvider();
      seen.add(date);
      const at = (field) => daily[field]?.[index];
      return {
        date,
        tempMin: finite(at('temperature_2m_min'), -100, 70),
        tempMax: finite(at('temperature_2m_max'), -100, 70),
        feelsMin: finite(at('apparent_temperature_min'), -150, 100),
        feelsMax: finite(at('apparent_temperature_max'), -150, 100),
        rainProbability: finite(at('precipitation_probability_max'), 0, 100),
        windSpeed: finite(at('wind_speed_10m_max'), 0, 180),
        weatherCode: weatherCode(at('weather_code')),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const current =
    isObject(data.current) && validDateTime(data.current.time)
      ? {
          dateTime: data.current.time,
          temperature: finite(data.current.temperature_2m, -100, 70),
          feelsLike: finite(data.current.apparent_temperature, -150, 100),
          windSpeed: finite(data.current.wind_speed_10m, 0, 180),
          weatherCode: weatherCode(data.current.weather_code),
        }
      : null;
  return {
    source: 'Open-Meteo',
    attributionUrl: 'https://open-meteo.com/',
    updatedAt,
    timezone: data.timezone,
    latitude: data.latitude,
    longitude: data.longitude,
    current,
    days,
  };
}

async function fetchJson(url, fetcher) {
  let response;
  try {
    response = await fetcher(url, {
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok)
      throw new WeatherError(
        503,
        'Сервис погоды временно недоступен. Попробуйте позже или задайте погоду вручную.',
      );
    if (Number(response.headers.get('content-length')) > BODY_LIMIT) throw invalidProvider();
    if (
      !response.headers.get('content-type')?.toLowerCase().includes('application/json') ||
      !response.body
    )
      throw invalidProvider();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let body = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > BODY_LIMIT) {
          await reader.cancel();
          throw invalidProvider();
        }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    try {
      return JSON.parse(body);
    } catch {
      throw invalidProvider();
    }
  } catch (error) {
    if (error instanceof WeatherError) {
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      throw error;
    }
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
      throw new WeatherError(504, 'Сервис погоды отвечает слишком долго. Попробуйте ещё раз.');
    throw new WeatherError(
      503,
      'Не удалось получить погоду. Проверьте интернет или задайте погоду вручную.',
    );
  }
}

function boundedCache(limit, ttl, now) {
  const entries = new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (now() - entry.time >= ttl) {
        entries.delete(key);
        return null;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },
    set(key, value, forcedAt = null) {
      entries.delete(key);
      entries.set(key, { value, time: now(), forcedAt });
      while (entries.size > limit) entries.delete(entries.keys().next().value);
    },
  };
}

export function createWeatherService({ fetcher = globalThis.fetch, now = Date.now } = {}) {
  const cities = boundedCache(120, 30 * 60 * 1000, now);
  const forecasts = boundedCache(64, 10 * 60 * 1000, now);
  const pending = new Map();
  let calls = [];
  async function request(key, work) {
    if (pending.has(key)) return pending.get(key);
    const time = now();
    calls = calls.filter((value) => time - value < 60000);
    if (calls.length >= 30)
      throw new WeatherError(429, 'Слишком много запросов. Подождите минуту и попробуйте снова.');
    calls.push(time);
    const promise = Promise.resolve().then(work);
    pending.set(key, promise);
    try {
      return await promise;
    } finally {
      pending.delete(key);
    }
  }
  return {
    async searchCities(query) {
      const key = query.toLocaleLowerCase('ru');
      const cached = cities.get(key);
      if (cached) return cached.value;
      return request('city:' + key, async () => {
        const url = new URL(GEO_URL);
        url.search = new URLSearchParams({
          name: query,
          count: '6',
          language: 'ru',
          format: 'json',
        });
        const value = normalizeCities(await fetchJson(url, fetcher));
        cities.set(key, value);
        return value;
      });
    },
    async forecast({ latitude, longitude, refresh = false }) {
      const key = latitude.toFixed(4) + ',' + longitude.toFixed(4);
      const cached = forecasts.get(key);
      if (cached && !refresh) return cached.value;
      if (
        refresh &&
        cached?.forcedAt !== null &&
        cached?.forcedAt !== undefined &&
        now() - cached.forcedAt < 10000
      ) {
        throw new WeatherError(
          429,
          'Прогноз уже обновлён. Подождите 10 секунд перед следующим обновлением.',
        );
      }
      return request('weather:' + key, async () => {
        const url = new URL(FORECAST_URL);
        url.search = new URLSearchParams({
          latitude: String(latitude),
          longitude: String(longitude),
          timezone: 'auto',
          forecast_days: '16',
          wind_speed_unit: 'ms',
          temperature_unit: 'celsius',
          current: 'temperature_2m,apparent_temperature,wind_speed_10m,weather_code',
          daily:
            'temperature_2m_min,temperature_2m_max,apparent_temperature_min,apparent_temperature_max,precipitation_probability_max,wind_speed_10m_max,weather_code',
        });
        const value = normalizeForecast(
          await fetchJson(url, fetcher),
          new Date(now()).toISOString(),
        );
        forecasts.set(key, value, refresh ? now() : null);
        return value;
      });
    },
  };
}
