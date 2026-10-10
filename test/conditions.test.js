import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_CONDITIONS as C } from '@gladysassistant/integration-sdk';
import { WMO_CONDITIONS, isDay, skyCondition, toCondition } from '../src/conditions.js';

// The 28 codes Open-Meteo documents.
const OPEN_METEO_CODES = [
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86,
  95, 96, 99,
];

test('every documented WMO code maps to a condition of the Gladys enum', () => {
  const allowed = new Set(Object.values(C));
  assert.deepEqual(
    Object.keys(WMO_CONDITIONS)
      .map(Number)
      .sort((a, b) => a - b),
    OPEN_METEO_CODES,
  );
  for (const code of OPEN_METEO_CODES) {
    const condition = toCondition({ weatherCode: code, temperature: 10 });
    assert.ok(allowed.has(condition), `${code} -> ${condition}`);
    assert.notEqual(condition, C.UNKNOWN, `${code}`);
    assert.notEqual(condition, C.NIGHT, 'night is deprecated for providers');
  }
});

test('the mapping, code by code', () => {
  const expected = {
    0: C.CLEAR,
    1: C.CLEAR,
    2: C.PARTLY_CLOUDY,
    3: C.CLOUD,
    45: C.FOG,
    48: C.FREEZING_FOG,
    53: C.DRIZZLE,
    56: C.FREEZING_RAIN,
    61: C.RAIN,
    65: C.POURING,
    67: C.FREEZING_RAIN,
    75: C.SNOW,
    77: C.SNOW,
    81: C.RAIN,
    82: C.POURING,
    86: C.SNOW,
    95: C.THUNDERSTORM,
    99: C.THUNDERSTORM,
  };
  for (const [code, condition] of Object.entries(expected)) {
    assert.equal(toCondition({ weatherCode: Number(code), temperature: 10 }), condition, code);
  }
});

test('fog at or below 0 °C is freezing fog, for a point and for a day', () => {
  assert.equal(toCondition({ weatherCode: 45, temperature: 0 }), C.FREEZING_FOG);
  assert.equal(toCondition({ weatherCode: 45, temperature: 0.5 }), C.FOG);
  assert.equal(toCondition({ weatherCode: 45, temperatureMax: -2 }), C.FREEZING_FOG);
  assert.equal(toCondition({ weatherCode: 45, temperatureMax: 4 }), C.FOG);
  assert.equal(toCondition({ weatherCode: 45 }), C.FOG);
});

test('a thunderstorm with snowfall in the cold is a snow thunderstorm', () => {
  assert.equal(
    toCondition({ weatherCode: 95, snowfall: 0.4, temperature: -1 }),
    C.SNOW_THUNDERSTORM,
  );
  assert.equal(toCondition({ weatherCode: 95, snowfall: 0, temperature: -1 }), C.THUNDERSTORM);
  assert.equal(toCondition({ weatherCode: 95, snowfall: 0.4, temperature: 6 }), C.THUNDERSTORM);
  assert.equal(
    toCondition({ weatherCode: 96, snowfall: 1, temperatureMax: 0.5 }),
    C.SNOW_THUNDERSTORM,
  );
});

test('an unknown or missing code falls back to the cloud cover', () => {
  assert.equal(toCondition({ weatherCode: 42, cloudCover: 95 }), C.CLOUD);
  assert.equal(toCondition({ weatherCode: null, cloudCover: 50 }), C.PARTLY_CLOUDY);
  assert.equal(toCondition({ weatherCode: null, cloudCover: 10 }), C.CLEAR);
  assert.equal(toCondition({ weatherCode: null, cloudCover: null }), C.UNKNOWN);
  assert.equal(skyCondition(undefined), C.UNKNOWN);
});

test('day or night: the API flag first, then the sun times', () => {
  const days = [{ time: 1000, sunrise: 1000 + 7 * 3600, sunset: 1000 + 19 * 3600 }];
  assert.equal(isDay(1000 + 3600, true, days), true, 'the flag wins');
  assert.equal(isDay(1000 + 12 * 3600, false, days), false, 'the flag wins');
  assert.equal(isDay(1000 + 12 * 3600, null, days), true);
  assert.equal(isDay(1000 + 3600, null, days), false);
  assert.equal(isDay(1000 + 20 * 3600, null, days), false);
  assert.equal(isDay(1000 + 30 * 3600, null, days), null, 'no day: unknown');
  assert.equal(isDay(1000 + 12 * 3600, null, [{ time: 1000, sunrise: null, sunset: null }]), null);
});
