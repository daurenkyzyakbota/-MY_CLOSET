import test from 'node:test';
import assert from 'node:assert/strict';
import { outfitWeatherForDate, manualOutfitWeather } from '../lib/styling/outfit-weather.js';

const forecast = {
  current: { dateTime: '2026-10-30T13:00', feelsLike: 17, windSpeed: 2 },
  days: [
    { date: '2026-10-30', feelsMin: 5, tempMin: 8, tempMax: 20, rainProbability: 30, windSpeed: 7 },
    { date: '2026-10-31', feelsMin: 3, tempMin: 6, tempMax: 17, rainProbability: 60, windSpeed: 9 },
  ],
};
test('today uses actual current sensation and future dates use the recorded lower boundary', () => {
  assert.deepEqual(outfitWeatherForDate(forecast, '2026-10-30', '2026-10-30'), {
    feelsLike: 17,
    tempMin: 8,
    tempMax: 20,
    rainProbability: 30,
    windSpeed: 7,
  });
  assert.deepEqual(outfitWeatherForDate(forecast, '2026-10-31', '2026-10-30'), {
    feelsLike: 3,
    tempMin: 6,
    tempMax: 17,
    rainProbability: 60,
    windSpeed: 9,
  });
});
test('unknown or far-future weather never becomes a fabricated forecast or zero', () => {
  assert.equal(outfitWeatherForDate(forecast, '2027-01-01', '2026-10-30'), null);
  assert.equal(outfitWeatherForDate(null, '2026-10-30'), null);
  const data = {
    days: [
      {
        date: '2026-10-30',
        feelsMin: null,
        tempMin: null,
        tempMax: NaN,
        rainProbability: null,
        windSpeed: null,
      },
    ],
  };
  assert.deepEqual(outfitWeatherForDate(data, '2026-10-30', '2026-10-30'), {
    feelsLike: null,
    tempMin: null,
    tempMax: null,
    rainProbability: null,
    windSpeed: null,
  });
});
test('manual weather accepts real zero values, keeps optional unknowns and rejects malformed inputs', () => {
  assert.deepEqual(manualOutfitWeather({ feelsLike: '0', rainProbability: '0', windSpeed: '0' }), {
    feelsLike: 0,
    rainProbability: 0,
    windSpeed: 0,
  });
  assert.deepEqual(manualOutfitWeather({ feelsLike: '18', rainProbability: ' ', windSpeed: '' }), {
    feelsLike: 18,
    rainProbability: null,
    windSpeed: null,
  });
  for (const fields of [
    { feelsLike: '' },
    { feelsLike: ' ' },
    { feelsLike: NaN },
    { feelsLike: false },
    { feelsLike: 100 },
    { feelsLike: 20, rainProbability: 101 },
    { feelsLike: 20, windSpeed: -1 },
  ])
    assert.throws(() => manualOutfitWeather(fields));
});
