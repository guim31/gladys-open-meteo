import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseForecast } from '../src/forecast.js';
import {
  INTENSITIES,
  PRECIPITATION_TYPES,
  intensityClass,
  isPrecipitationAnnounced,
  precipitationType,
  readNowcast,
} from '../src/nowcast.js';
import { ENSCHEDE_NOW, SYNTHETIC_NOW, loadFixture } from './helpers/fixtures.js';

const NOW_S = SYNTHETIC_NOW / 1000;

/**
 * @description A forecast from a fixture, with its 15-minute precipitation
 * replaced.
 * @param {Array<number|null>} precipitation - mm per step (12 steps).
 * @returns {object} The slim forecast.
 */
function withSteps(precipitation) {
  const raw = loadFixture('synthetic-paris-rain-soon.json');
  raw.minutely_15.precipitation = precipitation;
  raw.minutely_15.weather_code = precipitation.map((mm) => (mm > 0 ? 61 : 3));
  return parseForecast(raw);
}

test('Paris: moderate rain starting in 23 minutes, with the hourly probability', () => {
  const forecast = parseForecast(loadFixture('synthetic-paris-rain-soon.json'));
  const nowcast = readNowcast(forecast, NOW_S);
  assert.equal(nowcast.available, true);
  assert.equal(nowcast.wetNow, false);
  // The step stamped 14:45 covers 14:30-14:45; it is 14:07.
  assert.equal(nowcast.minutesUntil, 23);
  assert.equal(nowcast.durationMinutes, 60);
  assert.equal(nowcast.type, PRECIPITATION_TYPES.RAIN);
  // 0.9 mm in 15 minutes is 3.6 mm/h.
  assert.equal(nowcast.peakIntensity, 3.6);
  assert.equal(nowcast.intensity, INTENSITIES.MODERATE);
  assert.equal(nowcast.probability, 85);
  assert.equal(nowcast.points.length, 8);
  assert.equal(nowcast.points[0].time, Date.UTC(2026, 9, 10, 14, 0) / 1000);
});

test('Oklahoma City: heavy rain now; Queenstown: light snow now', () => {
  const okc = readNowcast(
    parseForecast(loadFixture('synthetic-oklahoma-city-thunderstorm.json')),
    NOW_S,
  );
  assert.equal(okc.wetNow, true);
  assert.equal(okc.minutesUntil, 0);
  assert.equal(okc.intensity, INTENSITIES.HEAVY);
  const queenstown = readNowcast(
    parseForecast(loadFixture('synthetic-queenstown-snow.json')),
    NOW_S,
  );
  assert.equal(queenstown.type, PRECIPITATION_TYPES.SNOW);
  assert.equal(queenstown.intensity, INTENSITIES.LIGHT);
  assert.equal(queenstown.minutesUntil, 0);
});

test('a dry hour is available and dry', () => {
  const nowcast = readNowcast(withSteps(Array(12).fill(0)), NOW_S);
  assert.equal(nowcast.available, true);
  assert.equal(nowcast.minutesUntil, null);
  assert.equal(nowcast.type, null);
  assert.equal(nowcast.probability, null);
});

test('rain after the hour is not "within the hour"', () => {
  const nowcast = readNowcast(withSteps([0, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 0, 0]), NOW_S);
  assert.equal(nowcast.minutesUntil, null);
});

test('a trace under 0.1 mm per quarter is dry', () => {
  const nowcast = readNowcast(withSteps([0, 0.05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), NOW_S);
  assert.equal(nowcast.minutesUntil, null);
});

test('missing 15-minute data is "not available", never "dry"', () => {
  assert.deepEqual(readNowcast(withSteps(Array(12).fill(null)), NOW_S), { available: false });
  const raw = loadFixture('synthetic-paris-rain-soon.json');
  delete raw.minutely_15;
  assert.deepEqual(readNowcast(parseForecast(raw), NOW_S), { available: false });
  // Served too late: fewer than 4 steps left.
  const forecast = parseForecast(loadFixture('synthetic-paris-rain-soon.json'));
  assert.deepEqual(readNowcast(forecast, NOW_S + 3 * 3600), { available: false });
});

test('the real Enschede response: 4 steps from the current one do not cover the hour', () => {
  const forecast = parseForecast(loadFixture('real-enschede-iso8601-kmh.json'));
  assert.deepEqual(readNowcast(forecast, ENSCHEDE_NOW / 1000), { available: false });
  // Just before the current step, all 4 steps are ahead: dry.
  const nowcast = readNowcast(forecast, forecast.current.time - 60);
  assert.equal(nowcast.available, true);
  assert.equal(nowcast.minutesUntil, null);
});

test('the precipitation type: freezing, snow, rain', () => {
  assert.equal(
    precipitationType({ precipitation: 0.3, snowfall: 0, weatherCode: 66 }),
    PRECIPITATION_TYPES.FREEZING_RAIN,
  );
  assert.equal(
    precipitationType({ precipitation: 0.3, snowfall: 0.21, weatherCode: null }),
    PRECIPITATION_TYPES.SNOW,
  );
  assert.equal(
    precipitationType({ precipitation: 0.3, snowfall: 0, weatherCode: 85 }),
    PRECIPITATION_TYPES.SNOW,
  );
  assert.equal(
    precipitationType({ precipitation: 1, snowfall: 0.1, weatherCode: null }),
    PRECIPITATION_TYPES.RAIN,
    'mostly rain',
  );
  assert.equal(
    precipitationType({ precipitation: 0.3, snowfall: null, weatherCode: null }),
    PRECIPITATION_TYPES.RAIN,
  );
});

test('intensity classes', () => {
  assert.equal(intensityClass(0.4), INTENSITIES.LIGHT);
  assert.equal(intensityClass(2.5), INTENSITIES.MODERATE);
  assert.equal(intensityClass(7.6), INTENSITIES.HEAVY);
});

test('only a dry → wet transition is announced, never the baseline', () => {
  const dry = { available: true, minutesUntil: null };
  const wet = { available: true, minutesUntil: 10 };
  assert.equal(isPrecipitationAnnounced(null, wet), false);
  assert.equal(isPrecipitationAnnounced(dry, wet), true);
  assert.equal(isPrecipitationAnnounced(wet, wet), false);
  assert.equal(isPrecipitationAnnounced({ available: false }, wet), false);
  assert.equal(isPrecipitationAnnounced(dry, dry), false);
  assert.equal(isPrecipitationAnnounced(dry, { available: false }), false);
});
