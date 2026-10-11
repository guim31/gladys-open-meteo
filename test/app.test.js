// -----------------------------------------------------------------------------
// The integration end to end, on a fake Gladys client and a fake fetch.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { connectionStatus, createApp } from '../src/app.js';
import { ERROR_KINDS, OpenMeteoError } from '../src/api.js';
import { SCENE_ACTIONS } from '../src/scene-actions.js';
import { SCENE_TRIGGERS } from '../src/scene-triggers.js';
import { WIDGETS } from '../src/widget.js';
import { createFakeGladys } from './helpers/fake-gladys.js';
import {
  HOUSES,
  SYNTHETIC_NOW,
  fakeFetch,
  fixtureForUrl,
  silentLogger,
} from './helpers/fixtures.js';

/**
 * @description A running app on fakes.
 * @param {object} [options] - Options.
 * @param {object} [options.config] - The configuration.
 * @param {Array<object>} [options.houses] - The houses.
 * @param {Function} [options.route] - The fetch router.
 * @returns {object} The parts.
 */
function setup({
  config = {},
  houses = [HOUSES.paris],
  route = (url) => ({ body: fixtureForUrl(url) }),
} = {}) {
  const gladys = createFakeGladys({ config, houses });
  const fetchImpl = fakeFetch(route);
  const clock = { now: SYNTHETIC_NOW };
  const timers = [];
  const app = createApp(gladys, {
    fetchImpl,
    now: () => clock.now,
    logger: silentLogger(),
    setTimer: (fn, delay) => {
      const timer = { fn, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {},
  });
  return { gladys, fake: gladys.fake, app, fetchImpl, clock, timers };
}

test('on connection: one refresh per house, the status, a widget nudge', async () => {
  const { fake, app, fetchImpl, timers } = setup({ houses: [HOUSES.paris, HOUSES.okc] });
  await fake.connect();
  await app.scheduler.settled();
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(fake.lastStatus(), { connected: true });
  assert.deepEqual(fake.widgetRefreshes, [WIDGETS.PRECIPITATION_NEXT_HOURS]);
  assert.equal(timers.at(-1).delay, 15 * 60000);
  // No alerts, so never the core's alert nudge.
  assert.equal(fake.weatherRefreshes, 0);
});

test('a weather request is served from memory, in the units asked', async () => {
  const { fake, app, fetchImpl } = setup();
  await fake.connect();
  await app.scheduler.settled();
  const metric = await fake.weatherGet({ ...HOUSES.paris, language: 'fr', units: 'metric' });
  const us = await fake.weatherGet({ ...HOUSES.paris, language: 'fr', units: 'us' });
  assert.equal(fetchImpl.calls.length, 1, 'no call for the requests');
  assert.equal(metric.temperature, 18.9);
  assert.equal(us.temperature, 66);
  assert.equal(metric.hours.length, 24);
  assert.equal(metric.days.length, 8);
  assert.equal(metric.alerts, undefined);
});

test('a weather request for an unknown location makes one call; none without coordinates', async () => {
  const { fake, fetchImpl } = setup({ houses: [] });
  const weather = await fake.weatherGet({ ...HOUSES.okc, units: 'us' });
  assert.equal(weather.weather, 'thunderstorm');
  assert.equal(fetchImpl.calls.length, 1);
  await assert.rejects(fake.weatherGet({ latitude: null, longitude: 2, units: 'metric' }), {
    message: 'The house has no location',
  });
});

test('a failing provider rejects, so the core falls through to the next one', async () => {
  const { fake } = setup({ route: () => ({ status: 500, body: 'oops' }) });
  await assert.rejects(fake.weatherGet({ ...HOUSES.paris, units: 'metric' }), {
    kind: ERROR_KINDS.UPSTREAM,
  });
});

test('the trigger fires when a refresh brings rain the previous one did not show', async () => {
  let rain = false;
  const { fake, app, timers, clock } = setup({
    route: (url) => {
      const body = fixtureForUrl(url);
      if (!rain) {
        body.minutely_15.precipitation = body.minutely_15.precipitation.map(() => 0);
      }
      return { body };
    },
  });
  await fake.connect();
  await app.scheduler.settled();
  assert.equal(fake.sceneEvents.length, 0, 'baseline');
  rain = true;
  await timers.at(-1).fn();
  assert.equal(fake.sceneEvents.length, 1);
  assert.equal(fake.sceneEvents[0].key, SCENE_TRIGGERS.PRECIPITATION_EXPECTED);
  // Language 'auto': the language of the last request of the core.
  assert.match(fake.sceneEvents[0].data.summary, /^Moderate rain/);
  await fake.weatherGet({ ...HOUSES.paris, language: 'fr', units: 'metric' });
  rain = false;
  clock.now += 60 * 60000;
  await timers.at(-1).fn();
  assert.equal(fake.sceneEvents.length, 1);
});

test('the scene action reads the house named, or the first one', async () => {
  const { fake, app } = setup({ houses: [HOUSES.paris, HOUSES.queenstown] });
  await fake.connect();
  await app.scheduler.settled();
  const paris = await fake.sceneAction(SCENE_ACTIONS.GET_PRECIPITATION_NEXT_HOUR, {});
  assert.equal(paris.minutes_until, 23);
  const chalet = await fake.sceneAction(SCENE_ACTIONS.GET_PRECIPITATION_NEXT_HOUR, {
    house: ' chalet ',
  });
  assert.equal(chalet.precipitation_type, 'snow');
  await assert.rejects(
    fake.sceneAction(SCENE_ACTIONS.GET_PRECIPITATION_NEXT_HOUR, { house: 'Moon base' }),
    /No located house named "Moon base"/,
  );
});

test('the widget: content for the house, or a message when unavailable', async () => {
  const { fake, app } = setup();
  await fake.connect();
  await app.scheduler.settled();
  const content = await fake.widgetGet(WIDGETS.PRECIPITATION_NEXT_HOURS, {
    settings: {},
    language: 'en',
    units: 'us',
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[1].unit, 'in/h');
  const missing = await fake.widgetGet(WIDGETS.PRECIPITATION_NEXT_HOURS, {
    settings: { house: 'Nope' },
    language: 'fr',
  });
  assert.deepEqual(validateWidgetContent(missing), []);
  assert.match(missing.components[0].text, /^Prévision indisponible/);
});

test('the test action fetches now and answers in every language', async () => {
  const { fake } = setup({ config: { model: 'meteofrance_seamless' } });
  const answer = await fake.action('test_connection');
  assert.equal(
    answer.en,
    'It works: 66 °F (18.9 °C) now at Maison (43 m), model meteofrance_seamless. Refreshing every 15 min.',
  );
  assert.equal(
    answer.fr,
    'Ça fonctionne : 18.9 °C en ce moment à Maison (43 m), modèle meteofrance_seamless. Mise à jour toutes les 15 min.',
  );
  const empty = setup({ houses: [] });
  await assert.rejects(empty.fake.action('test_connection'), /No house of Gladys has a location/);
});

test('changing the model forgets the forecasts and refreshes at once', async () => {
  const { fake, app, fetchImpl } = setup();
  await fake.connect();
  await app.scheduler.settled();
  await fake.configUpdated({ model: 'icon_seamless' });
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(new URL(fetchImpl.calls[1]).searchParams.get('models'), 'icon_seamless');
  // Another interval only re-plans the timer, without a call.
  await fake.configUpdated({ model: 'icon_seamless', refresh_interval: '60' });
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(app.config.refresh_interval, '60');
});

test('a reconnection re-reads the config and publishes the status again', async () => {
  const { fake, app, fetchImpl } = setup();
  await fake.connect();
  await app.scheduler.settled();
  await fake.connect();
  assert.equal(fetchImpl.calls.length, 1, 'no extra call');
  assert.equal(fake.connectionStatuses.length, 2);
  fake.config = { model: 'gfs_seamless' };
  await fake.connect();
  assert.equal(fetchImpl.calls.length, 2, 'the model changed while disconnected');
});

test('statuses: no house, a limit, a model without data, unreachable', async () => {
  const noHouse = setup({ houses: [] });
  await noHouse.fake.connect();
  await noHouse.app.scheduler.settled();
  assert.equal(noHouse.fake.lastStatus().connected, false);
  assert.match(noHouse.fake.lastStatus().message.fr, /Paramètres → Maisons/);

  const outside = setup({
    route: (url) => {
      const body = fixtureForUrl(url);
      body.current.temperature_2m = null;
      return { body };
    },
  });
  await outside.fake.connect();
  await outside.app.scheduler.settled();
  assert.match(outside.fake.lastStatus().message.en, /choose “Automatic”/);

  const limited = connectionStatus({
    houses: 1,
    refreshed: 0,
    error: new OpenMeteoError(ERROR_KINDS.LIMIT, 'x'),
  });
  assert.match(limited.message.en, /request limit reached/);
  const down = connectionStatus({
    houses: 1,
    refreshed: 0,
    error: new OpenMeteoError(ERROR_KINDS.NETWORK, 'x'),
  });
  assert.match(down.message.fr, /injoignable/);
  // One house refreshed out of two: still connected.
  assert.deepEqual(
    connectionStatus({ houses: 2, refreshed: 1, error: new OpenMeteoError('network', 'x') }),
    { connected: true },
  );
});

test('the status is only published when it changes', async () => {
  const { fake, app, timers } = setup();
  await fake.connect();
  await app.scheduler.settled();
  await timers.at(-1).fn();
  await timers.at(-1).fn();
  assert.equal(fake.connectionStatuses.length, 1);
});

test('the memory stays bounded: a few slim forecasts', async () => {
  const { fake, app } = setup({ houses: [HOUSES.paris, HOUSES.okc, HOUSES.queenstown] });
  await fake.connect();
  await app.scheduler.settled();
  // About 16 KB per location (48 hours, 8 days, 12 quarters): a thousand
  // houses would still fit in 20 MB of the 256 MB sandbox.
  const size = JSON.stringify(app.store.peek(HOUSES.paris.latitude, HOUSES.paris.longitude)).length;
  assert.ok(size < 20 * 1024, `${size} bytes`);
  assert.equal(app.store.size, 3);
});
