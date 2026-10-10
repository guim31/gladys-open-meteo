import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS } from '../src/api.js';
import {
  STALE_MAX_MS,
  createForecastStore,
  limitRetryMs,
  locationKey,
} from '../src/forecast-store.js';
import {
  HOUSES,
  SYNTHETIC_NOW,
  fakeFetch,
  fixtureForUrl,
  silentLogger,
} from './helpers/fixtures.js';

const { latitude, longitude } = HOUSES.paris;

/**
 * @description A store on a fake fetch and a settable clock.
 * @param {Function} route - The fetch router.
 * @param {object} [options] - { model }.
 * @returns {object} `{ store, fetchImpl, clock }`.
 */
function setup(route = (url) => ({ body: fixtureForUrl(url) }), { model = 'best_match' } = {}) {
  const clock = { now: SYNTHETIC_NOW };
  const fetchImpl = fakeFetch(route);
  const settings = { model };
  const store = createForecastStore({
    getModel: () => settings.model,
    fetchImpl,
    now: () => clock.now,
    logger: silentLogger(),
  });
  return { store, fetchImpl, clock, settings };
}

test('locations closer than ~110 m share a key', () => {
  assert.equal(locationKey(48.85661, 2.35222), '48.857,2.352');
  assert.equal(locationKey(48.8566, 2.3522), locationKey(48.85655, 2.35218));
});

test('a fresh forecast is served from memory, an old one is refreshed', async () => {
  const { store, fetchImpl, clock } = setup();
  await store.load(latitude, longitude, { maxAgeMs: 20 * 60000 });
  await store.load(latitude, longitude, { maxAgeMs: 20 * 60000 });
  assert.equal(fetchImpl.calls.length, 1);
  clock.now += 21 * 60000;
  await store.load(latitude, longitude, { maxAgeMs: 20 * 60000 });
  assert.equal(fetchImpl.calls.length, 2);
});

test('concurrent readers share one call', async () => {
  const { store, fetchImpl } = setup();
  await Promise.all([
    store.load(latitude, longitude, { maxAgeMs: 0 }),
    store.load(latitude, longitude, { maxAgeMs: 0 }),
    store.refresh(latitude, longitude),
  ]);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(store.calls, 1);
});

test('the configured model is sent', async () => {
  const { store, fetchImpl } = setup(undefined, { model: 'meteofrance_seamless' });
  const entry = await store.refresh(latitude, longitude);
  assert.equal(new URL(fetchImpl.calls[0]).searchParams.get('models'), 'meteofrance_seamless');
  assert.equal(entry.forecast.model, 'meteofrance_seamless');
});

test('when Open-Meteo fails, a forecast up to 3 hours old is still served', async () => {
  let fail = false;
  const { store, clock } = setup((url) => {
    if (fail) {
      return { status: 503, body: 'down' };
    }
    return { body: fixtureForUrl(url) };
  });
  await store.load(latitude, longitude, { maxAgeMs: 0 });
  fail = true;
  clock.now += 60 * 60000;
  const served = await store.load(latitude, longitude, { maxAgeMs: 20 * 60000 });
  assert.equal(served.stale, true);
  assert.equal(store.lastError.kind, ERROR_KINDS.UPSTREAM);
  clock.now += STALE_MAX_MS;
  await assert.rejects(store.load(latitude, longitude, { maxAgeMs: 20 * 60000 }), {
    kind: ERROR_KINDS.UPSTREAM,
  });
});

test('a 429 blocks the calls: one minute for the minutely limit, an hour otherwise', async () => {
  assert.equal(
    limitRetryMs('Minutely API request limit exceeded. Please try again in one minute.'),
    60000,
  );
  assert.equal(
    limitRetryMs('Daily API request limit exceeded. Please try again tomorrow.'),
    3600000,
  );
  assert.equal(limitRetryMs(null), 3600000);

  let limited = true;
  const { store, fetchImpl, clock } = setup((url) =>
    limited
      ? { status: 429, body: { error: true, reason: 'Hourly API request limit exceeded.' } }
      : { body: fixtureForUrl(url) },
  );
  await assert.rejects(store.refresh(latitude, longitude), { kind: ERROR_KINDS.LIMIT });
  limited = false;
  await assert.rejects(store.refresh(latitude, longitude), { kind: ERROR_KINDS.LIMIT });
  assert.equal(fetchImpl.calls.length, 1, 'no call while blocked');
  assert.notEqual(store.blockedError(), null);
  clock.now += 3600000 + 1;
  assert.equal(store.blockedError(), null);
  await store.refresh(latitude, longitude);
  assert.equal(fetchImpl.calls.length, 2);
});

test('an unusable answer is an INVALID error and is not cached', async () => {
  const { store } = setup(() => ({ body: { latitude: 1, current: { temperature_2m: null } } }));
  await assert.rejects(store.refresh(latitude, longitude), {
    kind: ERROR_KINDS.INVALID,
    message: /no current conditions/,
  });
  assert.equal(store.size, 0);
});

test('an answer for a model changed during the call is not cached', async () => {
  const { store, settings } = setup((url) => {
    settings.model = 'icon_seamless';
    return { body: fixtureForUrl(url) };
  });
  await store.refresh(latitude, longitude);
  assert.equal(store.size, 0);
});

test('prune drops the old forecasts of locations no longer refreshed; reset drops all', async () => {
  const { store, clock } = setup();
  await store.refresh(latitude, longitude);
  await store.refresh(HOUSES.okc.latitude, HOUSES.okc.longitude);
  clock.now += STALE_MAX_MS + 1;
  store.prune(new Set([locationKey(latitude, longitude)]));
  assert.equal(store.size, 1);
  store.reset();
  assert.equal(store.size, 0);
  assert.equal(store.peek(latitude, longitude), null);
});
