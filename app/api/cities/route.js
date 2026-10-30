import { validateCityQuery, WeatherError } from '../../../lib/weather/weather.js';
import { weatherService } from '../../../lib/weather/weather-service.js';

export async function GET(request) {
  try {
    return Response.json(
      await weatherService.searchCities(validateCityQuery(new URL(request.url).searchParams)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof WeatherError
            ? error.message
            : 'Не удалось найти город. Попробуйте позже.',
      },
      {
        status: error instanceof WeatherError ? error.status : 500,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
