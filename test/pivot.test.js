// -----------------------------------------------------------------------------
// The pivot payload against the rules of the core (normalizeWeather, Gladys
// server/lib/external-integration): the field whitelists below are copied
// from it — a field outside them is silently dropped by the core.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_CONDITIONS } from '@gladysassistant/integration-sdk';
import { parseForecast } from '../src/forecast.js';
import { MAX_DAYS, MAX_HOURS, buildWeather } from '../src/pivot.js';
import { BERLIN_NOW, ENSCHEDE_NOW, SYNTHETIC_NOW, loadFixture } from './helpers/fixtures.js';

const CURRENT_FIELDS = [
  'temperature',
  'weather',
  'datetime',
  'apparent_temperature',
  'humidity',
  'pressure',
  'dew_point',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'visibility',
  'cloud_cover',
  'uv_index',
  'sunrise',
  'sunset',
  'is_day',
  'hours',
  'days',
];
const HOUR_FIELDS = [
  'temperature',
  'weather',
  'datetime',
  'apparent_temperature',
  'humidity',
  'pressure',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'cloud_cover',
  'precipitation',
  'precipitation_probability',
  'uv_index',
  'is_day',
];
const DAY_FIELDS = [
  'temperature_min',
  'temperature_max',
  'datetime',
  'weather',
  'humidity',
  'wind_speed',
  'wind_direction',
  'wind_gust',
  'precipitation',
  'precipitation_probability',
  'uv_index',
  'sunrise',
  'sunset',
];
const PERCENT_FIELDS = ['humidity', 'cloud_cover', 'precipitation_probability'];
const CONDITIONS = new Set(Object.values(WEATHER_CONDITIONS));

/**
 * @description Check an entry against a whitelist and the value rules.
 * @param {object} entry - A pivot entry.
 * @param {Array<string>} allowed - The allowed fields.
 * @param {string} where - For the messages.
 */
function checkEntry(entry, allowed, where) {
  for (const [key, value] of Object.entries(entry)) {
    assert.ok(allowed.includes(key), `${where}: ${key} would be dropped by the core`);
    assert.notEqual(value, null, `${where}: ${key} is null`);
    if (PERCENT_FIELDS.includes(key)) {
      assert.ok(value >= 0 && value <= 100, `${where}: ${key} = ${value}`);
    }
    if (key === 'is_day') {
      assert.equal(typeof value, 'boolean', `${where}: is_day must be a strict boolean`);
    }
    if (['datetime', 'sunrise', 'sunset'].includes(key)) {
      assert.ok(!Number.isNaN(new Date(value).getTime()), `${where}: ${key}`);
    }
    if (key === 'weather') {
      assert.ok(CONDITIONS.has(value), `${where}: ${value}`);
      assert.notEqual(value, 'night');
    }
  }
}

/**
 * @description Check a whole payload.
 * @param {object} weather - The pivot payload.
 */
function checkPayload(weather) {
  assert.equal(typeof weather.temperature, 'number');
  assert.equal(typeof weather.weather, 'string');
  assert.equal(typeof weather.datetime, 'string');
  assert.equal(weather.alerts, undefined, 'Open-Meteo has no alerts: none is invented');
  assert.equal(weather.units, undefined, 'the core stamps the units itself');
  checkEntry(weather, CURRENT_FIELDS, 'current');
  assert.ok(weather.hours.length <= MAX_HOURS);
  assert.ok(weather.days.length <= MAX_DAYS);
  weather.hours.forEach((hour, i) => {
    checkEntry(hour, HOUR_FIELDS, `hours[${i}]`);
    assert.equal(typeof hour.temperature, 'number');
  });
  weather.days.forEach((day, i) => {
    checkEntry(day, DAY_FIELDS, `days[${i}]`);
    assert.equal(typeof day.temperature_min, 'number');
    assert.equal(typeof day.temperature_max, 'number');
  });
}

const FIXTURES = [
  ['synthetic-paris-rain-soon.json', SYNTHETIC_NOW],
  ['synthetic-oklahoma-city-thunderstorm.json', SYNTHETIC_NOW],
  ['synthetic-queenstown-snow.json', SYNTHETIC_NOW],
  ['real-enschede-iso8601-kmh.json', ENSCHEDE_NOW],
  ['real-berlin-home-assistant.json', BERLIN_NOW],
];

test('every fixture gives a payload the core keeps whole, in both unit systems', () => {
  for (const [name, now] of FIXTURES) {
    const forecast = parseForecast(loadFixture(name), { fetchedAt: now });
    for (const units of ['metric', 'us']) {
      checkPayload(buildWeather(forecast, { units, now }));
    }
  }
});

test('Paris, metric: the current conditions, 24 hours from the current one, 8 days', () => {
  const forecast = parseForecast(loadFixture('synthetic-paris-rain-soon.json'));
  const weather = buildWeather(forecast, { units: 'metric', now: SYNTHETIC_NOW });
  assert.equal(weather.temperature, 18.9);
  assert.equal(weather.weather, 'cloud');
  assert.equal(weather.datetime, '2026-10-10T14:00:00.000Z');
  assert.equal(weather.is_day, true);
  assert.equal(weather.wind_speed, 3);
  assert.equal(weather.visibility, 24.1);
  assert.equal(weather.uv_index, 3);
  assert.equal(weather.hours.length, 24);
  assert.equal(weather.hours[0].datetime, '2026-10-10T14:00:00.000Z');
  assert.equal(weather.hours[1].weather, 'rain');
  assert.equal(weather.hours[1].precipitation_probability, 85);
  assert.equal(weather.days.length, 8);
  // Today, from the local midnight of Paris.
  assert.equal(weather.days[0].datetime, '2026-10-09T22:00:00.000Z');
  assert.equal(weather.days[2].weather, 'fog');
  assert.equal(weather.sunrise, weather.days[0].sunrise);
});

test('Oklahoma City, us units: °F, mph, inches, miles; hPa kept', () => {
  const forecast = parseForecast(loadFixture('synthetic-oklahoma-city-thunderstorm.json'));
  const metric = buildWeather(forecast, { units: 'metric', now: SYNTHETIC_NOW });
  const us = buildWeather(forecast, { units: 'us', now: SYNTHETIC_NOW });
  assert.equal(metric.temperature, 26);
  assert.equal(us.temperature, 78.8);
  assert.equal(us.weather, 'thunderstorm');
  assert.equal(us.wind_speed, 6.7); // 3 m/s
  assert.equal(us.visibility, 15); // 24.14 km
  assert.equal(us.pressure, metric.pressure);
  assert.equal(metric.hours[0].precipitation, 1.7);
  assert.equal(us.hours[0].precipitation, 0.07);
  assert.equal(us.days[0].temperature_max, 87.8);
  assert.equal(us.days[5].weather, 'thunderstorm', 'hail stays a thunderstorm');
});

test('Queenstown, southern hemisphere: night, snow, freezing fog', () => {
  const forecast = parseForecast(loadFixture('synthetic-queenstown-snow.json'));
  const weather = buildWeather(forecast, { units: 'metric', now: SYNTHETIC_NOW });
  assert.equal(weather.is_day, false);
  assert.equal(weather.weather, 'snow');
  assert.equal(weather.hours[3].weather, 'freezing-fog');
  assert.equal(weather.hours[3].is_day, false);
  assert.equal(weather.days[2].weather, 'freezing-fog', 'rime fog');
  assert.equal(weather.days[5].weather, 'freezing-rain');
  // Today in New Zealand started at 11:00 UTC the day before... the 10th.
  assert.equal(weather.days[0].datetime, '2026-10-10T11:00:00.000Z');
});

test('a forecast served late does not lead with past hours or days', () => {
  const forecast = parseForecast(loadFixture('synthetic-paris-rain-soon.json'));
  const later = SYNTHETIC_NOW + 2 * 3600 * 1000 + 60 * 1000;
  const weather = buildWeather(forecast, { units: 'metric', now: later });
  assert.equal(weather.hours[0].datetime, '2026-10-10T16:00:00.000Z');
  assert.equal(weather.hours.length, 24);
  const nextDay = buildWeather(forecast, { units: 'metric', now: SYNTHETIC_NOW + 86400000 });
  assert.equal(nextDay.days[0].datetime, '2026-10-10T22:00:00.000Z');
  assert.equal(nextDay.days.length, 7);
});

test('what the model does not know is left out, never sent as null or 0', () => {
  const raw = loadFixture('synthetic-paris-rain-soon.json');
  raw.current.uv_index = null;
  raw.current.visibility = null;
  raw.hourly.precipitation_probability = raw.hourly.precipitation_probability.map(() => null);
  const weather = buildWeather(parseForecast(raw), { units: 'metric', now: SYNTHETIC_NOW });
  assert.equal('uv_index' in weather, false);
  assert.equal('visibility' in weather, false);
  assert.ok(weather.hours.every((hour) => !('precipitation_probability' in hour)));
});

test('-0 °C reads 0', () => {
  const raw = loadFixture('synthetic-paris-rain-soon.json');
  raw.current.temperature_2m = -0.04;
  const weather = buildWeather(parseForecast(raw), { units: 'metric', now: SYNTHETIC_NOW });
  assert.ok(Object.is(weather.temperature, 0));
});
