import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherService, normalizeCities, normalizeForecast, validateCityQuery, validateWeatherQuery, WeatherError } from '../lib/weather.js';

const params = value => new URLSearchParams(value);
const point = { latitude: 43.25, longitude: 76.95 };
const payload = () => ({
  ...point, timezone: 'Asia/Almaty',
  current: { time: '2026-10-23T12:00', temperature_2m: 0, apparent_temperature: null, wind_speed_10m: 2.4, weather_code: 3 },
  daily: {
    time: ['2026-10-23', '2026-10-24'], temperature_2m_min: [-2, null], temperature_2m_max: [8, 9],
    apparent_temperature_min: [null, -3], apparent_temperature_max: [6, 7],
    precipitation_probability_max: [0, 70], wind_speed_10m_max: [3.5, 5], weather_code: [3, 61]
  }
});
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const status = expected => error => error instanceof WeatherError && error.status === expected;

test('request validation retains zero coordinates and rejects blank, out of range, repeated and nondecimal values', () => {
  assert.deepEqual(validateWeatherQuery(params('lat=0&lon=0')), { latitude: 0, longitude: 0, refresh: false });
  assert.deepEqual(validateWeatherQuery(params('lat=-90&lon=180&refresh=1')), { latitude: -90, longitude: 180, refresh: true });
  for (const input of ['lat=&lon=0', 'lat=91&lon=0', 'lat=0&lon=-181', 'lat=0x10&lon=0', 'lat=0&lat=1&lon=0', 'lat=0&lon=0&refresh=yes']) {
    assert.throws(() => validateWeatherQuery(params(input)), status(400));
  }
  assert.equal(validateCityQuery(params({ q: '  Алматы  ' })), 'Алматы');
  assert.throws(() => validateCityQuery(params({ q: 'а' })), status(400));
  assert.throws(() => validateCityQuery(params('q=Almaty&q=Paris')), status(400));
  assert.throws(() => validateCityQuery(params({ q: 'a\nb' })), status(400));
});

test('forecast retains provider dates, actual zero values and nullable data', () => {
  const input = payload();
  input.daily.temperature_2m_max[1] = '9';
  input.daily.weather_code[1] = 999;
  const result = normalizeForecast(input, '2026-10-23T07:00:00.000Z');
  assert.equal(result.current.temperature, 0);
  assert.equal(result.current.feelsLike, null);
  assert.equal(result.current.windSpeed, 2.4);
  assert.equal(result.days.length, 2);
  assert.deepEqual(result.days.map(day => day.date), input.daily.time);
  assert.equal(result.days[0].rainProbability, 0);
  assert.equal(result.days[1].tempMin, null);
  assert.equal(result.days[1].tempMax, null);
  assert.equal(result.days[1].weatherCode, null);
  assert.equal(result.source, 'Open-Meteo');
  assert.equal(result.updatedAt, '2026-10-23T07:00:00.000Z');
  delete input.current;
  delete input.daily.apparent_temperature_min;
  assert.equal(normalizeForecast(input).current, null);
  assert.equal(normalizeForecast(input).days[0].feelsMin, null);
});

test('forecast rejects malformed dates, timezone and daily arrays', () => {
  for (const mutate of [
    value => { value.daily.time[0] = '2026-02-30'; },
    value => { value.daily.time[1] = value.daily.time[0]; },
    value => { value.timezone = 'Invalid/Zone'; },
    value => { value.daily.temperature_2m_min = {}; },
    value => { value.latitude = null; },
    value => { value.daily.time = []; }
  ]) {
    const value = payload(); mutate(value);
    assert.throws(() => normalizeForecast(value), status(502));
  }
});

test('geocoding supports no matches and returns only cities persistable under profile limits', () => {
  assert.deepEqual(normalizeCities({}), { cities: [] });
  const result = normalizeCities({ results: [
    { id: 1, name: 'Test', latitude: 0, longitude: 0, timezone: 'UTC' },
    { id: 2, name: 'Invalid', latitude: null, longitude: 1, timezone: 'UTC' },
    { id: 1, name: 'Duplicate', latitude: 0, longitude: 0, timezone: 'UTC' },
    { id: 3, name: 'No timezone', latitude: 0, longitude: 0 },
    { id: 4, name: 'Invalid timezone', latitude: 0, longitude: 0, timezone: 'Invalid/Zone' },
    { id: 5, name: 'N'.repeat(180), country: 'C'.repeat(160), admin1: 'A'.repeat(160), latitude: 1, longitude: 1, timezone: 'Asia/Almaty' }
  ] });
  assert.deepEqual(result.cities, [
    { id: 1, name: 'Test', country: '', admin1: '', latitude: 0, longitude: 0, timezone: 'UTC' },
    { id: 5, name: 'N'.repeat(120), country: 'C'.repeat(100), admin1: 'A'.repeat(120), latitude: 1, longitude: 1, timezone: 'Asia/Almaty' }
  ]);
  assert.throws(() => normalizeCities({ results: null }), status(502));
});

test('forecast cache lasts 10 minutes; forced update bypasses it and has cooldown', async () => {
  let now = Date.parse('2026-10-23T07:00:00Z');
  let calls = 0;
  const service = createWeatherService({ now: () => now, fetcher: async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://api.open-meteo.com');
    assert.equal(url.searchParams.get('forecast_days'), '16');
    assert.equal(url.searchParams.get('wind_speed_unit'), 'ms');
    assert.equal(url.searchParams.get('timezone'), 'auto');
    assert.equal(options.redirect, 'error');
    return json(payload());
  } });
  const first = await service.forecast(point);
  assert.strictEqual(await service.forecast(point), first);
  assert.equal(calls, 1);
  now += 1000;
  const refreshed = await service.forecast({ ...point, refresh: true });
  assert.notEqual(refreshed.updatedAt, first.updatedAt);
  assert.equal(calls, 2);
  await assert.rejects(service.forecast({ ...point, refresh: true }), status(429));
  now += 10000;
  await service.forecast({ ...point, refresh: true });
  assert.equal(calls, 3);
  now += 600000;
  await service.forecast(point);
  assert.equal(calls, 4);
});

test('city cache lasts 30 minutes and concurrent identical requests are deduplicated', async () => {
  let now = 0;
  let calls = 0;
  const service = createWeatherService({ now: () => now, fetcher: async url => {
    calls++;
    assert.equal(url.origin, 'https://geocoding-api.open-meteo.com');
    assert.equal(url.searchParams.get('count'), '6');
    assert.equal(url.searchParams.get('language'), 'ru');
    return json({ results: [] });
  } });
  await Promise.all([service.searchCities('Алматы'), service.searchCities('Алматы')]);
  await service.searchCities('АЛМАТЫ');
  assert.equal(calls, 1);
  now += 1800000;
  await service.searchCities('Алматы');
  assert.equal(calls, 2);
});

test('cache entry count is bounded and upstream limit rejects request 31 within a minute', async () => {
  let now = 0;
  let calls = 0;
  const service = createWeatherService({ now: () => now, fetcher: async () => { calls++; return json(payload()); } });
  for (let index = 0; index < 65; index++) {
    if (index > 0 && index % 30 === 0) now += 60001;
    await service.forecast({ latitude: index, longitude: 0 });
  }
  await service.forecast({ latitude: 0, longitude: 0 });
  assert.equal(calls, 66, 'oldest forecast must be evicted after 64 cached locations');
  const limited = createWeatherService({ now: () => 0, fetcher: async () => json({}) });
  for (let index = 0; index < 30; index++) await limited.searchCities('City' + index);
  await assert.rejects(limited.searchCities('City31'), status(429));
});

test('provider failures, timeouts, malformed JSON and oversized responses have explicit errors', async () => {
  const cases = [
    [async () => { throw new TypeError('offline'); }, 503],
    [async () => { throw new DOMException('timeout', 'TimeoutError'); }, 504],
    [async () => new Response('blocked', { status: 429 }), 503],
    [async () => new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }), 502],
    [async () => new Response('{broken', { headers: { 'content-type': 'application/json' } }), 502],
    [async () => new Response(' '.repeat(256 * 1024 + 1), { headers: { 'content-type': 'application/json' } }), 502],
    [async () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '262145' } }), 502]
  ];
  for (const [fetcher, expected] of cases) {
    const service = createWeatherService({ fetcher });
    await assert.rejects(service.forecast(point), status(expected));
  }
});
