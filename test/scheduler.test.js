import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS } from '../src/api.js';
import { createForecastStore } from '../src/forecast-store.js';
import { createHouseRegistry } from '../src/houses.js';
import { RETRY_AFTER_FAILURE_MS, createScheduler } from '../src/scheduler.js';
import {
  HOUSES,
  SYNTHETIC_NOW,
  fakeFetch,
  fixtureForUrl,
  silentLogger,
} from './helpers/fixtures.js';

/**
 * @description A scheduler on fakes: houses, fetch, clock and timers.
 * @param {object} options - Options.
 * @param {Array<object>} options.houses - The houses of Gladys.
 * @param {Function} [options.route] - The fetch router.
 * @param {number} [options.interval] - Minutes.
 * @returns {object} The parts.
 */
function setup({ houses, route = (url) => ({ body: fixtureForUrl(url) }), interval = 15 }) {
  const clock = { now: SYNTHETIC_NOW };
  const timers = [];
  const fetchImpl = fakeFetch(route);
  const logger = silentLogger();
  const store = createForecastStore({ fetchImpl, now: () => clock.now, logger });
  const registry = createHouseRegistry({ fetchHouses: async () => houses, logger });
  const refreshed = [];
  const cycles = [];
  const settings = { interval };
  const scheduler = createScheduler({
    houses: registry,
    store,
    getIntervalMinutes: () => settings.interval,
    onRefreshed: (house) => refreshed.push(house.id),
    onCycle: (summary) => cycles.push(summary),
    logger,
    now: () => clock.now,
    setTimer: (fn, delay) => {
      const timer = { fn, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timer.cleared = true;
    },
  });
  return { scheduler, fetchImpl, refreshed, cycles, timers, clock, settings, store };
}

test('one call per distinct location, every house notified, then the interval', async () => {
  const twin = { ...HOUSES.paris, id: 'h-paris-2', name: 'Annexe', latitude: 48.85662 };
  const { scheduler, fetchImpl, refreshed, cycles, timers } = setup({
    houses: [HOUSES.paris, twin, HOUSES.okc, { id: 'x', name: 'Nowhere', latitude: null }],
  });
  await scheduler.start();
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(refreshed.sort(), ['h-okc', 'h-paris', 'h-paris-2']);
  assert.equal(cycles[0].houses, 3, 'the unlocated house is not counted');
  assert.equal(cycles[0].locations, 2);
  assert.equal(cycles[0].refreshed, 2);
  assert.equal(timers.at(-1).delay, 15 * 60000);
});

test('the timer runs the next cycle; stop ends the refreshes', async () => {
  const { scheduler, fetchImpl, timers } = setup({ houses: [HOUSES.paris], interval: 30 });
  await scheduler.start();
  assert.equal(timers.at(-1).delay, 30 * 60000);
  await timers.at(-1).fn();
  assert.equal(fetchImpl.calls.length, 2);
  scheduler.stop();
  assert.equal(timers.at(-1).cleared, true);
  assert.equal(scheduler.started, false);
});

test('a cycle that failed for a passing reason is retried after 5 minutes', async () => {
  const { scheduler, cycles, timers } = setup({
    houses: [HOUSES.paris],
    route: () => {
      throw new Error('offline');
    },
  });
  await scheduler.start();
  assert.equal(cycles[0].error.kind, ERROR_KINDS.NETWORK);
  assert.equal(timers.at(-1).delay, RETRY_AFTER_FAILURE_MS);
});

test('a request limit stops the cycle at once and keeps the interval', async () => {
  const { scheduler, fetchImpl, cycles, timers } = setup({
    houses: [HOUSES.paris, HOUSES.okc],
    route: () => ({
      status: 429,
      body: { error: true, reason: 'Daily API request limit exceeded.' },
    }),
  });
  await scheduler.start();
  assert.equal(fetchImpl.calls.length, 1, 'the second house is not tried');
  assert.equal(cycles[0].error.kind, ERROR_KINDS.LIMIT);
  assert.equal(timers.at(-1).delay, 15 * 60000);
  // The next cycle makes no call while the block lasts.
  await timers.at(-1).fn();
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(cycles[1].error.kind, ERROR_KINDS.LIMIT);
});

test('cycles never overlap: one asked during a cycle runs after it', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { scheduler, fetchImpl } = setup({
    houses: [HOUSES.paris],
    route: async (url) => {
      await gate;
      return { body: fixtureForUrl(url) };
    },
  });
  const first = scheduler.start();
  const second = scheduler.requestCycle();
  assert.equal(first, second, 'the caller waits for the cycle under way');
  release();
  await scheduler.settled();
  assert.equal(fetchImpl.calls.length, 2, 'the queued cycle ran after');
});

test('reschedule counts from the last cycle', async () => {
  const { scheduler, timers, clock, settings } = setup({ houses: [HOUSES.paris] });
  await scheduler.start();
  clock.now += 10 * 60000;
  settings.interval = 30;
  scheduler.reschedule();
  assert.equal(timers.at(-1).delay, 20 * 60000);
  settings.interval = 15;
  clock.now += 10 * 60000;
  scheduler.reschedule();
  assert.equal(timers.at(-1).delay, 0, 'overdue: now');
});

test('no located house: no call, and the cycle says so', async () => {
  const { scheduler, fetchImpl, cycles } = setup({ houses: [] });
  await scheduler.start();
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(cycles[0].houses, 0);
  assert.equal(cycles[0].error, null);
});
