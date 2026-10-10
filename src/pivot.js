// -----------------------------------------------------------------------------
// Slim metric forecast → the Gladys pivot weather format (contract B.18).
//
// The core whitelists, bounds and normalizes the payload (normalizeWeather):
// this module produces exactly the fields it keeps, in the unit system of the
// request, and leaves out what the model does not know rather than sending a
// null.
//
//   current   temperature, weather, datetime (required), apparent temperature,
//             humidity, pressure, dew point, wind speed / direction / gust,
//             visibility, cloud cover, UV index, sunrise, sunset, is_day;
//   hours     the current hour and the next 23 (Gladys keeps 24);
//   days      today and the next 7 (Gladys keeps 8).
//
// No `alerts`: Open-Meteo publishes no official warning. Sending none keeps
// the core's weather-alert trigger silent rather than fed with invented
// alerts; the documentation points to the Météo France and Pirate Weather
// integrations for that.
// -----------------------------------------------------------------------------

import { isDay, toCondition } from './conditions.js';
import { fromMetric, round } from './units.js';

const MAX_HOURS = 24;
const MAX_DAYS = 8;

/**
 * @description Copy the defined values of an object (drop null/undefined).
 * @param {object} fields - The candidate fields.
 * @returns {object} The fields with a value.
 * @example
 * compact({ a: 1, b: null }); // -> { a: 1 }
 */
function compact(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null && value !== undefined),
  );
}

/**
 * @description UNIX seconds as an ISO date.
 * @param {number|null} seconds - UNIX seconds.
 * @returns {string|null} The ISO date.
 * @example
 * isoDate(0); // -> '1970-01-01T00:00:00.000Z'
 */
function isoDate(seconds) {
  return seconds === null || seconds === undefined ? null : new Date(seconds * 1000).toISOString();
}

/**
 * @description The day of the forecast that holds a time.
 * @param {Array<object>} days - The slim daily points.
 * @param {number} time - UNIX seconds.
 * @returns {object|undefined} The day.
 * @example
 * dayOf(forecast.daily, forecast.current.time);
 */
function dayOf(days, time) {
  return days.find((day) => day.time <= time && time < day.time + 24 * 3600);
}

/**
 * @description Build the pivot weather of a forecast, in one unit system.
 * @param {object} forecast - The slim metric forecast (forecast.js).
 * @param {object} options - Options.
 * @param {string} options.units - 'metric' or 'us', as the core requested.
 * @param {number} [options.now] - The current time in ms.
 * @returns {object} The pivot weather payload.
 * @example
 * buildWeather(forecast, { units: 'us' });
 */
function buildWeather(forecast, { units, now = Date.now() }) {
  const convert = fromMetric(units);
  const nowSeconds = Math.floor(now / 1000);
  const { current, daily } = forecast;
  const today = dayOf(daily, current.time);

  const weather = compact({
    temperature: convert.temperature(current.temperature),
    weather: toCondition(current),
    datetime: isoDate(current.time),
    apparent_temperature: convert.temperature(current.apparentTemperature),
    humidity: round(current.humidity, 0),
    pressure: convert.pressure(current.pressure),
    dew_point: convert.temperature(current.dewPoint),
    wind_speed: convert.speed(current.windSpeed),
    wind_direction: round(current.windDirection, 0),
    wind_gust: convert.speed(current.windGust),
    visibility: convert.visibility(current.visibility),
    cloud_cover: round(current.cloudCover, 0),
    uv_index: round(current.uvIndex, 0),
    sunrise: isoDate(today?.sunrise),
    sunset: isoDate(today?.sunset),
    is_day: isDay(current.time, current.isDay, daily),
  });

  // Open-Meteo stamps an hourly sum at the END of its hour: the precipitation
  // (and its probability) of the row stamped 15:00 fell from 14:00 to 15:00.
  // A pivot hour is the hour that STARTS at its datetime, so the hour 14:00
  // reads them from the row stamped 15:00; the last hour, without a next row,
  // leaves them out rather than showing the previous hour's.
  const hourlyByTime = new Map(forecast.hourly.map((hour) => [hour.time, hour]));

  // The hour under way and the following ones: a forecast served from the
  // cache an hour later must not lead with an hour already past.
  weather.hours = forecast.hourly
    .filter((hour) => hour.time + 3600 > nowSeconds)
    .slice(0, MAX_HOURS)
    .map((hour) => {
      const ending = hourlyByTime.get(hour.time + 3600);
      return compact({
        temperature: convert.temperature(hour.temperature),
        weather: toCondition(hour),
        datetime: isoDate(hour.time),
        apparent_temperature: convert.temperature(hour.apparentTemperature),
        humidity: round(hour.humidity, 0),
        pressure: convert.pressure(hour.pressure),
        wind_speed: convert.speed(hour.windSpeed),
        wind_direction: round(hour.windDirection, 0),
        wind_gust: convert.speed(hour.windGust),
        cloud_cover: round(hour.cloudCover, 0),
        precipitation: convert.precipitation(ending?.precipitation),
        precipitation_probability: round(ending?.precipitationProbability, 0),
        uv_index: round(hour.uvIndex, 0),
        is_day: isDay(hour.time, hour.isDay, daily),
      });
    });

  weather.days = daily
    .filter((day) => day.time + 24 * 3600 > nowSeconds)
    .slice(0, MAX_DAYS)
    .map((day) =>
      compact({
        temperature_min: convert.temperature(day.temperatureMin),
        temperature_max: convert.temperature(day.temperatureMax),
        datetime: isoDate(day.time),
        weather: toCondition(day),
        humidity: round(day.humidity, 0),
        wind_speed: convert.speed(day.windSpeed),
        wind_direction: round(day.windDirection, 0),
        wind_gust: convert.speed(day.windGust),
        precipitation: convert.precipitation(day.precipitation),
        precipitation_probability: round(day.precipitationProbability, 0),
        uv_index: round(day.uvIndex, 0),
        sunrise: isoDate(day.sunrise),
        sunset: isoDate(day.sunset),
      }),
    );

  return weather;
}

export { MAX_DAYS, MAX_HOURS, buildWeather };
