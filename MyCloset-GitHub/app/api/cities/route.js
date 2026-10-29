import { createWeatherService, validateCityQuery, WeatherError } from '../../../weather.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const serviceKey = Symbol.for('mycloset.weather-service');
const weatherService = globalThis[serviceKey] ??= createWeatherService();

export async function GET(request) {
  try {
    const query = validateCityQuery(new URL(request.url).searchParams);
    const result = await weatherService.searchCities(query);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof WeatherError ? error.status : 503;
    const message = error instanceof Error ? error.message : 'Не удалось найти город.';
    return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}