import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseForecast } from '../src/forecast.js';
import { buildPrecipitationOutputs, precipitationNextHour } from '../src/scene-actions.js';
import { COOLDOWN_MS, SCENE_TRIGGERS, createPrecipitationWatcher } from '../src/scene-triggers.js';
import { HOUSES, SYNTHETIC_NOW, loadFixture, silentLogger } from './helpers/fixtures.js';

const wet = () => parseForecast(loadFixture('synthetic-paris-rain-soon.json'));
const dry = () => {
  const raw = loadFixture('synthetic-paris-rain-soon.json');
  raw.minutely_15.precipitation = raw.minutely_15.precipitation.map(() => 0);
  return parseForecast(raw);
};

/**
 * @description A watcher recording what it publishes.
 * @param {object} [options] - { language, publish }.
 * @returns {object} `{ watcher, published, clock }`.
 */
function setup({ language = 'en', publish } = {}) {
  const published = [];
  const clock = { now: SYNTHETIC_NOW };
  const watcher = createPrecipitationWatcher({
    publish:
      publish ??
      (async (key, data) => {
        published.push({ key, data });
      }),
    getLanguage: () => language,
    logger: silentLogger(),
    now: () => clock.now,
  });
  return { watcher, published, clock };
}

test('fires on the dry → wet transition, with flat filter and variable keys', async () => {
  const { watcher, published } = setup();
  assert.equal(await watcher.observe(HOUSES.paris, dry()), null, 'baseline');
  const data = await watcher.observe(HOUSES.paris, wet());
  assert.deepEqual(published, [
    {
      key: SCENE_TRIGGERS.PRECIPITATION_EXPECTED,
      data: {
        house: 'Maison',
        precipitation_type: 'rain',
        intensity: 'moderate',
        minutes_until: 23,
        probability: 85,
        summary: 'Moderate rain expected in 23 minutes (85% chance).',
      },
    },
  ]);
  assert.deepEqual(data, published[0].data);
  for (const value of Object.values(data)) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof value));
  }
});

test('never fires on the first forecast after a start, nor twice for one shower', async () => {
  const { watcher, published } = setup();
  await watcher.observe(HOUSES.paris, wet());
  await watcher.observe(HOUSES.paris, wet());
  assert.equal(published.length, 0);
});

test('a house fires at most once every 45 minutes', async () => {
  const { watcher, published, clock } = setup();
  await watcher.observe(HOUSES.paris, dry());
  await watcher.observe(HOUSES.paris, wet());
  await watcher.observe(HOUSES.paris, dry());
  await watcher.observe(HOUSES.paris, wet());
  assert.equal(published.length, 1);
  clock.now += COOLDOWN_MS;
  await watcher.observe(HOUSES.paris, dry());
  // The fixture is of SYNTHETIC_NOW: replay the same transition later.
  const later = loadFixture('synthetic-paris-rain-soon.json');
  const shift = COOLDOWN_MS / 1000;
  later.minutely_15.time = later.minutely_15.time.map((t) => t + shift);
  later.hourly.time = later.hourly.time.map((t) => t + shift);
  await watcher.observe(HOUSES.paris, parseForecast(later));
  assert.equal(published.length, 2);
});

test('houses are watched apart; reset and forget start new baselines', async () => {
  const { watcher, published } = setup({ language: 'fr' });
  await watcher.observe(HOUSES.paris, dry());
  watcher.reset();
  await watcher.observe(HOUSES.paris, wet());
  assert.equal(published.length, 0, 'after reset: baseline');
  await watcher.observe(HOUSES.okc, dry());
  watcher.forget(new Set(['h-paris']));
  await watcher.observe(HOUSES.okc, wet());
  assert.equal(published.length, 0, 'forgotten: baseline');
  await watcher.observe(HOUSES.okc, dry());
  await watcher.observe(HOUSES.okc, wet());
  assert.equal(published[0].data.house, 'Home');
  assert.equal(
    published[0].data.summary,
    'Pluie modérée attendue dans 23 minutes (probabilité 85 %).',
  );
});

test('a refused event is logged, never thrown', async () => {
  const { watcher } = setup({
    publish: async () => {
      throw new Error('429');
    },
  });
  await watcher.observe(HOUSES.paris, dry());
  assert.notEqual(await watcher.observe(HOUSES.paris, wet()), null);
});

test('without a probability, the variable is left out', async () => {
  const raw = loadFixture('synthetic-paris-rain-soon.json');
  raw.hourly.precipitation_probability = raw.hourly.precipitation_probability.map(() => null);
  const { watcher, published } = setup();
  await watcher.observe(HOUSES.paris, dry());
  await watcher.observe(HOUSES.paris, parseForecast(raw));
  assert.equal('probability' in published[0].data, false);
  assert.equal(published[0].data.summary, 'Moderate rain expected in 23 minutes.');
});

test('the scene action outputs', () => {
  assert.deepEqual(precipitationNextHour(wet(), 'en', SYNTHETIC_NOW), {
    available: true,
    precipitation_expected: true,
    minutes_until: 23,
    precipitation_type: 'rain',
    intensity: 'moderate',
    probability: 85,
    summary: 'Moderate rain expected in 23 minutes (85% chance).',
  });
  assert.deepEqual(precipitationNextHour(dry(), 'fr', SYNTHETIC_NOW), {
    available: true,
    precipitation_expected: false,
    summary: 'Pas de précipitations prévues dans l’heure.',
  });
  assert.deepEqual(buildPrecipitationOutputs({ available: false }, 'en'), {
    available: false,
    precipitation_expected: false,
    summary: 'No 15-minute forecast for this location.',
  });
});
