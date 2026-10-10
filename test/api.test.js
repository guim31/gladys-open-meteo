import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_VARIABLES,
  DAILY_VARIABLES,
  ERROR_KINDS,
  HOURLY_VARIABLES,
  MINUTELY_15_VARIABLES,
  buildUrl,
  fetchForecast,
  readReason,
} from '../src/api.js';
import { fakeFetch, loadFixture } from './helpers/fixtures.js';

test('the request asks for metric units, UNIX times and the local days', () => {
  const url = new URL(buildUrl(48.85661, 2.35222, 'meteofrance_seamless'));
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  const params = url.searchParams;
  assert.equal(params.get('latitude'), '48.8566');
  assert.equal(params.get('longitude'), '2.3522');
  assert.equal(params.get('timezone'), 'auto');
  assert.equal(params.get('timeformat'), 'unixtime');
  assert.equal(params.get('wind_speed_unit'), 'ms');
  assert.equal(params.get('temperature_unit'), 'celsius');
  assert.equal(params.get('precipitation_unit'), 'mm');
  assert.equal(params.get('forecast_days'), '8');
  assert.equal(params.get('forecast_hours'), '48');
  assert.equal(params.get('forecast_minutely_15'), '12');
  assert.equal(params.get('models'), 'meteofrance_seamless');
  assert.equal(params.get('current'), CURRENT_VARIABLES.join(','));
  assert.equal(params.get('minutely_15'), MINUTELY_15_VARIABLES.join(','));
  assert.equal(params.get('hourly'), HOURLY_VARIABLES.join(','));
  assert.equal(params.get('daily'), DAILY_VARIABLES.join(','));
  // No API key, no secret of any kind.
  assert.equal(params.get('apikey'), null);
  assert.ok(!url.href.includes('%2C'), 'commas stay readable');
});

test('every requested variable exists in a real Open-Meteo response', () => {
  // The real response recorded by python-open-meteo carries all of them: a
  // misspelt variable would make Open-Meteo refuse the whole request.
  const real = loadFixture('real-enschede-iso8601-kmh.json');
  for (const variable of CURRENT_VARIABLES) {
    assert.ok(variable in real.current, `current ${variable}`);
  }
  for (const variable of HOURLY_VARIABLES) {
    assert.ok(variable in real.hourly, `hourly ${variable}`);
  }
  for (const variable of DAILY_VARIABLES) {
    assert.ok(variable in real.daily, `daily ${variable}`);
  }
  for (const variable of MINUTELY_15_VARIABLES) {
    // The 15-minute block accepts every hourly variable.
    assert.ok(variable in real.hourly, `minutely_15 ${variable}`);
  }
});

test('a 200 answer resolves the JSON body', async () => {
  const body = loadFixture('synthetic-paris-rain-soon.json');
  const fetchImpl = fakeFetch(() => ({ body }));
  const data = await fetchForecast({ latitude: 48.8566, longitude: 2.3522, fetchImpl });
  assert.equal(data.timezone, 'Europe/Paris');
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(new URL(fetchImpl.calls[0]).searchParams.get('models'), 'best_match');
});

test('errors are classified, with the reason Open-Meteo gives', async () => {
  const cases = [
    [400, { error: true, reason: 'Latitude must be in range of -90 to 90°.' }, ERROR_KINDS.REQUEST],
    [
      429,
      { error: true, reason: 'Daily API request limit exceeded. Please try again tomorrow.' },
      ERROR_KINDS.LIMIT,
    ],
    [502, '<html>Bad gateway</html>', ERROR_KINDS.UPSTREAM],
  ];
  for (const [status, body, kind] of cases) {
    await assert.rejects(
      fetchForecast({ latitude: 1, longitude: 2, fetchImpl: fakeFetch(() => ({ status, body })) }),
      (err) => {
        assert.equal(err.kind, kind);
        assert.equal(err.status, status);
        if (typeof body === 'object') {
          assert.equal(err.reason, body.reason);
          assert.ok(err.message.includes(body.reason));
        } else {
          assert.equal(err.reason, null);
        }
        return true;
      },
    );
  }
});

test('a network failure or an unreadable body is classified', async () => {
  await assert.rejects(
    fetchForecast({
      latitude: 1,
      longitude: 2,
      fetchImpl: async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      },
    }),
    { kind: ERROR_KINDS.NETWORK, message: 'Open-Meteo unreachable (ENOTFOUND)' },
  );
  await assert.rejects(
    fetchForecast({ latitude: 1, longitude: 2, fetchImpl: fakeFetch(() => ({ body: '{nope' })) }),
    { kind: ERROR_KINDS.INVALID },
  );
  await assert.rejects(fetchForecast({ latitude: NaN, longitude: 2 }), {
    kind: ERROR_KINDS.REQUEST,
  });
});

test('readReason bounds the reason and tolerates anything', () => {
  assert.equal(readReason('not json'), null);
  assert.equal(readReason('{"error":true}'), null);
  assert.equal(readReason(JSON.stringify({ reason: 'x'.repeat(500) })).length, 200);
});
