import { validateWeatherQuery, WeatherError } from '../../../lib/weather/weather.js';
import { weatherService } from '../../../lib/weather/weather-service.js';

export async function GET(request) {
  try {
    return Response.json(
      await weatherService.forecast(validateWeatherQuery(new URL(request.url).searchParams)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof WeatherError
            ? error.message
            : 'Не удалось получить прогноз. Укажите погоду вручную.',
      },
      {
        status: error instanceof WeatherError ? error.status : 500,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
