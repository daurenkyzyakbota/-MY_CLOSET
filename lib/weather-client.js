async function json(path, fetcher) {
  const response = await fetcher(path,{cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(14000)});
  let result; try { result = await response.json(); } catch { throw new Error('Не удалось прочитать прогноз. Попробуйте позже.'); }
  if (!response.ok) throw new Error(result.error || 'Сервис погоды временно недоступен.');
  return result;
}
export function searchCities(query, fetcher = globalThis.fetch) { return json('/api/cities?'+new URLSearchParams({q:query}),fetcher); }
export function fetchWeather(location, refresh = false, fetcher = globalThis.fetch) {
  return json('/api/weather?'+new URLSearchParams({lat:String(location.latitude),lon:String(location.longitude),...(refresh ? {refresh:'1'} : {})}),fetcher);
}
