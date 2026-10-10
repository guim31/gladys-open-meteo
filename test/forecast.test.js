import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseForecast, readTime } from '../src/forecast.js';
import { loadFixture } from './helpers/fixtures.js';

test('readTime reads UNIX seconds and local ISO times', () => {
  assert.equal(readTime(1791640800, 7200), 1791640800);
  // 12:30 at UTC+2 is 10:30 UTC.
  assert.equal(readTime('2026-10-03T12:30', 7200), Date.UTC(2026, 9, 3, 10, 30) / 1000);
  // A date is the local midnight.
  assert.equal(readTime('2026-10-03', 7200), Date.UTC(2026, 9, 2, 22, 0) / 1000);
  assert.equal(readTime('yesterday', 0), null);
  assert.equal(readTime(null, 0), null);
});

test('a synthetic response is turned into rows, in metric units', () => {
  const forecast = parseForecast(loadFixture('synthetic-paris-rain-soon.json'), {
    fetchedAt: 1,
    model: 'best_match',
  });
  assert.equal(forecast.timezone, 'Europe/Paris');
  assert.equal(forecast.utcOffsetSeconds, 7200);
  assert.equal(forecast.fetchedAt, 1);
  assert.equal(forecast.current.time, Date.UTC(2026, 9, 10, 14, 0) / 1000);
  assert.equal(forecast.current.weatherCode, 3);
  assert.equal(forecast.current.isDay, true);
  assert.equal(forecast.current.windSpeed, 3, 'm/s stays m/s');
  assert.equal(forecast.current.visibility, 24.14, 'metres become km');
  assert.equal(forecast.hourly.length, 48);
  assert.equal(forecast.daily.length, 8);
  assert.equal(forecast.minutely15.length, 12);
  // Daily rows start at the local midnight.
  assert.equal(forecast.daily[0].time, Date.UTC(2026, 9, 9, 22, 0) / 1000);
  assert.ok(forecast.daily[0].sunrise > forecast.daily[0].time);
  assert.ok(forecast.daily[0].sunset > forecast.daily[0].sunrise);
});

test('the real Enschede response: ISO local times and km/h are converted', () => {
  const forecast = parseForecast(loadFixture('real-enschede-iso8601-kmh.json'));
  assert.equal(forecast.current.time, Date.UTC(2026, 9, 3, 10, 30) / 1000);
  assert.equal(forecast.current.temperature, 17.7);
  // 3.6 km/h is 1 m/s.
  assert.ok(Math.abs(forecast.current.windSpeed - 1) < 1e-9);
  assert.ok(Math.abs(forecast.current.windGust - 11.9 / 3.6) < 1e-9);
  assert.ok(Math.abs(forecast.current.visibility - 36.08) < 1e-9);
  assert.equal(forecast.current.isDay, true);
  assert.equal(forecast.current.weatherCode, 2);
  // Sunrise 07:36 local on 2026-10-03 is 05:36 UTC.
  assert.equal(forecast.daily[0].sunrise, Date.UTC(2026, 9, 3, 5, 36) / 1000);
  assert.equal(forecast.daily[1].weatherCode, 45);
  // The 15-minute block starts with the current step.
  assert.equal(forecast.minutely15[0].time, forecast.current.time);
  assert.deepEqual(
    forecast.minutely15.map((step) => step.precipitation),
    [0, 0, 0, 0],
  );
  // `snowfall` and `weather_code` were not asked in that recording: null.
  assert.equal(forecast.minutely15[0].snowfall, null);
});

test('the real Berlin response (Home Assistant) parses, missing fields as null', () => {
  const forecast = parseForecast(loadFixture('real-berlin-home-assistant.json'));
  assert.equal(forecast.timezone, 'Europe/Berlin');
  assert.equal(forecast.hourly.length, 168);
  assert.equal(forecast.daily.length, 7);
  assert.equal(forecast.current.humidity, null);
  assert.equal(forecast.current.isDay, null);
  assert.equal(forecast.minutely15, null);
  assert.equal(forecast.hourly[0].precipitationProbability, null);
  assert.equal(forecast.daily[5].weatherCode, 77);
});

test('nulls sent by a model become nulls, never zeros', () => {
  const raw = loadFixture('synthetic-paris-rain-soon.json');
  raw.current.uv_index = null;
  raw.current.visibility = null;
  raw.hourly.precipitation_probability = raw.hourly.precipitation_probability.map(() => null);
  raw.minutely_15.precipitation = raw.minutely_15.precipitation.map(() => null);
  const forecast = parseForecast(raw);
  assert.equal(forecast.current.uvIndex, null);
  assert.equal(forecast.current.visibility, null);
  assert.ok(forecast.hourly.every((hour) => hour.precipitationProbability === null));
  assert.ok(forecast.minutely15.every((step) => step.precipitation === null));
});

test('a polar day or night has no sun times', () => {
  const raw = loadFixture('synthetic-queenstown-snow.json');
  raw.daily.sunrise[0] = raw.daily.sunset[0];
  raw.daily.sunset[1] = raw.daily.time[1] + 30 * 3600;
  const forecast = parseForecast(raw);
  assert.equal(forecast.daily[0].sunrise, null);
  assert.equal(forecast.daily[0].sunset, null);
  assert.equal(forecast.daily[1].sunset, null);
  assert.notEqual(forecast.daily[2].sunrise, null);
});

test('rows without the required values are dropped', () => {
  const raw = loadFixture('synthetic-paris-rain-soon.json');
  raw.hourly.temperature_2m[5] = null;
  raw.daily.temperature_2m_max[7] = null;
  const forecast = parseForecast(raw);
  assert.equal(forecast.hourly.length, 47);
  assert.equal(forecast.daily.length, 7);
});

test('a response without current conditions is refused', () => {
  assert.throws(() => parseForecast(null), /not an object/);
  assert.throws(() => parseForecast([]), /not an object/);
  const raw = loadFixture('synthetic-paris-rain-soon.json');
  // What a regional model answers outside its region.
  raw.current.temperature_2m = null;
  assert.throws(() => parseForecast(raw), /no current conditions/);
  delete raw.current;
  assert.throws(() => parseForecast(raw), /no current conditions/);
});
