// -----------------------------------------------------------------------------
// What the integration writes in the logs of Gladys, and how it refreshes.
//
// The info level keeps the life cycle only: a normal refresh, a weather
// request or a widget view writes nothing at info. A failure that repeats on
// every cycle is logged once when it starts, once when it ends.
//
// Polling (GladysAssistant/Gladys#3198): the core only polls devices created
// with `should_poll`. A weather integration has no device: the refreshes run on
// the container's own timer, never on the core's onPoll.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createIssueLog } from '../src/issue-log.js';
import { SCENE_ACTIONS } from '../src/scene-actions.js';
import { WIDGETS } from '../src/widget.js';
import { createFakeGladys } from './helpers/fake-gladys.js';
import { HOUSES, SYNTHETIC_NOW, fakeFetch, fixtureForUrl } from './helpers/fixtures.js';

/**
 * @description A logger that records every line, by level.
 * @returns {object} The logger; `lines` holds `{ level, message }`.
 */
function recordingLogger() {
  const lines = [];
  const at = (level) => (message) => lines.push({ level, message: String(message) });
  return {
    lines,
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    debug: at('debug'),
    of: (...levels) => lines.filter((line) => levels.includes(line.level)),
    clear: () => lines.splice(0),
  };
}

/**
 * @description A running app on fakes, with a recording logger and a switch to
 * make Open-Meteo fail.
 * @param {object} [options] - Options.
 * @param {Array<object>} [options.houses] - The houses.
 * @returns {object} The parts.
 */
function setup({ houses = [HOUSES.paris] } = {}) {
  const gladys = createFakeGladys({ houses });
  const upstream = { failing: false };
  const fetchImpl = fakeFetch((url) =>
    upstream.failing ? { status: 502, body: 'Bad gateway' } : { body: fixtureForUrl(url) },
  );
  const clock = { now: SYNTHETIC_NOW };
  const timers = [];
  const logger = recordingLogger();
  const app = createApp(gladys, {
    fetchImpl,
    now: () => clock.now,
    logger,
    setTimer: (fn, delay) => {
      const timer = { fn, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {},
  });
  /**
   * @description Run the cycle the app's own timer armed.
   * @returns {Promise<void>} Resolves after the cycle.
   */
  async function tick() {
    clock.now += timers.at(-1).delay;
    await timers.at(-1).fn();
    await app.scheduler.settled();
  }
  return { gladys, fake: gladys.fake, app, fetchImpl, clock, logger, upstream, tick };
}

test('a normal cycle, weather request, widget and scene action write nothing at info', async () => {
  const { fake, app, logger, tick } = setup({ houses: [HOUSES.paris, HOUSES.okc] });
  await fake.connect();
  await app.scheduler.settled();
  await tick();
  await tick();
  await fake.weatherGet({ ...HOUSES.paris, language: 'en', units: 'metric' });
  await fake.widgetGet(WIDGETS.PRECIPITATION_NEXT_HOURS, { settings: {}, language: 'en' });
  await fake.sceneAction(SCENE_ACTIONS.GET_PRECIPITATION_NEXT_HOUR, {});
  assert.deepEqual(logger.of('info', 'warn', 'error'), []);
  assert.ok(logger.of('debug').length > 0, 'the cycle details stay available in debug');
});

test('an Open-Meteo outage is logged once when it starts and once when it ends', async () => {
  const { fake, app, logger, upstream, tick } = setup();
  await fake.connect();
  await app.scheduler.settled();
  logger.clear();

  upstream.failing = true;
  for (let i = 0; i < 4; i += 1) {
    await tick();
    // Every dashboard view during the outage: served from the stale cache.
    await fake.weatherGet({ ...HOUSES.paris, units: 'metric' });
  }
  const warnings = logger.of('warn');
  assert.equal(warnings.length, 1, warnings.map((line) => line.message).join('\n'));
  assert.match(warnings[0].message, /^Open-Meteo request failed: /);
  assert.deepEqual(logger.of('info', 'error'), []);

  upstream.failing = false;
  logger.clear();
  await tick();
  await tick();
  assert.deepEqual(
    logger.of('info', 'warn', 'error').map((line) => line.message),
    ['Open-Meteo answers again'],
  );
});

test('an unreadable house list is logged once, and its return once', async () => {
  const { gladys, fake, app, logger, tick } = setup();
  await fake.connect();
  await app.scheduler.settled();
  logger.clear();
  const getHouses = gladys.getHouses;
  gladys.getHouses = async () => {
    throw new Error('Gladys is restarting');
  };
  await tick();
  await tick();
  await tick();
  assert.equal(logger.of('warn').length, 1);
  gladys.getHouses = getHouses;
  await tick();
  await tick();
  assert.deepEqual(
    logger.of('info', 'warn', 'error').map((line) => line.message),
    [
      'Unable to read the houses of Gladys: Gladys is restarting',
      'The houses of Gladys are readable again',
    ],
  );
});

test('polling: no device, no onPoll; the container refreshes on its own timer', async () => {
  const { fake, app, fetchImpl, tick } = setup();
  await fake.connect();
  await app.scheduler.settled();
  assert.equal(fake.handlers.poll, null, 'nothing relies on the core polling');
  assert.deepEqual(fake.discoveredDevices, [], 'no device, so no should_poll to get wrong');
  assert.equal(fetchImpl.calls.length, 1);
  // Without any request from Gladys, the next refresh comes from the timer.
  await tick();
  await tick();
  assert.equal(fetchImpl.calls.length, 3);
});

test('the issue log: warn once per kind, debug while it repeats, info on the way back', () => {
  const logger = recordingLogger();
  const issues = createIssueLog(logger);
  issues.recover('a', 'back');
  issues.fail('a', 'network', 'down');
  issues.fail('a', 'network', 'down');
  issues.fail('a', 'limit', 'limited');
  issues.fail('b', 'network', 'b down');
  assert.equal(issues.active, 2);
  issues.retain((key) => key === 'a');
  issues.recover('b', 'b back');
  issues.recover('a', 'back');
  assert.deepEqual(
    logger.lines.map(({ level, message }) => `${level}:${message}`),
    ['warn:down', 'debug:down', 'warn:limited', 'warn:b down', 'info:back'],
  );
});
