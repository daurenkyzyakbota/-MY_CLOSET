import { createWeatherService } from './weather.js';

export const weatherService = createWeatherService({
  getForecastApiKey: () => process.env.OPEN_METEO_API_KEY,
});
