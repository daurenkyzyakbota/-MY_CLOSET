import { localDate } from './model.js';

export function outfitWeatherForDate(forecast, date, today = localDate()) {
  if (!forecast) return null;
  const day = forecast.days?.find(value => value.date === date);
  const current = date === today && forecast.current?.dateTime?.slice(0,10) === date ? forecast.current : null;
  if (!day && !current) return null;
  const number = value => Number.isFinite(value) ? value : null;
  return {
    feelsLike:number(current?.feelsLike) ?? number(day?.feelsMin),
    tempMin:number(day?.tempMin),tempMax:number(day?.tempMax),
    rainProbability:number(day?.rainProbability),windSpeed:number(day?.windSpeed) ?? number(current?.windSpeed)
  };
}

export function manualOutfitWeather({feelsLike='',rainProbability='',windSpeed=''}) {
  const numeric = (value,min,max,label,required=false) => {
    if (typeof value === 'string') value = value.trim();
    if (value === '' || value === null || value === undefined) { if (required) throw new Error(`Укажите ${label.toLocaleLowerCase('ru')}.`); return null; }
    if (!['number','string'].includes(typeof value)) throw new Error(`${label}: введите число.`);
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label}: допустимо от ${min} до ${max}.`);
    return number;
  };
  return {feelsLike:numeric(feelsLike,-80,60,'Ощущаемую температуру',true),rainProbability:numeric(rainProbability,0,100,'Вероятность осадков'),windSpeed:numeric(windSpeed,0,75,'Скорость ветра')};
}
