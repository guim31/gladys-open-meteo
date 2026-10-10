// -----------------------------------------------------------------------------
// Conformity with the device rules of the Gladys core.
//
// Open-Meteo is a `weather` integration: Gladys shows no Devices or Discovery
// screen for it, and it publishes NO device. The test proves it end to end (a
// full start, a refresh cycle, weather, scene and widget requests: nothing is
// published), and keeps a validator of the device rules — checked against the
// table extracted from the core (fixtures/gladys-feature-table.json) — ready
// for the day a device would be added: category/type couple known to the
// front, `should_poll` with a `poll_frequency` in milliseconds from the fixed
// list, numeric `min`/`max`, boolean `read_only`/`has_feedback`, valid unit.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { SCENE_ACTIONS } from '../src/scene-actions.js';
import { WIDGETS } from '../src/widget.js';
import { createFakeGladys } from './helpers/fake-gladys.js';
import {
  HOUSES,
  SYNTHETIC_NOW,
  fakeFetch,
  fixtureForUrl,
  silentLogger,
} from './helpers/fixtures.js';

const table = JSON.parse(
  readFileSync(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);
const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

/**
 * @description List what breaks the core rules in a discovered device.
 * @param {object} device - A discovered device.
 * @returns {Array<string>} The violations (empty when compliant).
 */
function deviceViolations(device) {
  const problems = [];
  if (device.should_poll === true) {
    if (!table.poll_frequencies_ms.includes(device.poll_frequency)) {
      problems.push(`poll_frequency ${device.poll_frequency} is not in the fixed list (ms)`);
    }
  } else if (device.poll_frequency !== undefined && device.poll_frequency !== null) {
    problems.push('poll_frequency without should_poll: true');
  }
  for (const feature of device.features ?? []) {
    const where = `${device.name}/${feature.name}`;
    if (!table.pairs[`${feature.category}/${feature.type}`]) {
      problems.push(`${where}: ${feature.category}/${feature.type} is not a known couple`);
    }
    for (const bound of ['min', 'max']) {
      if (typeof feature[bound] !== 'number' || !Number.isFinite(feature[bound])) {
        problems.push(`${where}: ${bound} must be a number (NOT NULL in t_device_feature)`);
      }
    }
    for (const flag of ['read_only', 'has_feedback']) {
      if (typeof feature[flag] !== 'boolean') {
        problems.push(`${where}: ${flag} must be a boolean`);
      }
    }
    if (
      feature.unit !== undefined &&
      feature.unit !== null &&
      !table.units.includes(feature.unit)
    ) {
      problems.push(`${where}: unit "${feature.unit}" is unknown`);
    }
  }
  return problems;
}

test('the feature table extracted from the core is usable', () => {
  assert.ok(table.poll_frequencies_ms.includes(60000));
  assert.ok(table.pairs['temperature-sensor/decimal']);
  assert.ok(table.units.includes('celsius'));
});

test('the validator catches what the core refuses', () => {
  const good = {
    name: 'Station',
    should_poll: true,
    poll_frequency: 60000,
    features: [
      {
        name: 'Temperature',
        category: 'temperature-sensor',
        type: 'decimal',
        unit: 'celsius',
        min: -50,
        max: 60,
        read_only: true,
        has_feedback: false,
      },
    ],
  };
  assert.deepEqual(deviceViolations(good), []);
  const bad = {
    name: 'Station',
    poll_frequency: 300,
    features: [
      {
        name: 'Level',
        category: 'rain-gauge',
        type: 'decimal',
        unit: 'furlong',
        read_only: 'yes',
      },
    ],
  };
  const problems = deviceViolations(bad);
  assert.ok(problems.some((p) => p.includes('poll_frequency without should_poll')));
  assert.ok(problems.some((p) => p.includes('rain-gauge/decimal is not a known couple')));
  assert.ok(problems.some((p) => p.includes('min must be a number')));
  assert.ok(problems.some((p) => p.includes('read_only must be a boolean')));
  assert.ok(problems.some((p) => p.includes('unit "furlong"')));
  assert.deepEqual(deviceViolations({ name: 'x', should_poll: true, poll_frequency: 300 }), [
    'poll_frequency 300 is not in the fixed list (ms)',
  ]);
});

test('a weather integration publishes no device, ever', async () => {
  assert.equal(manifest.type, 'weather');
  const gladys = createFakeGladys({ houses: [HOUSES.paris, HOUSES.okc] });
  const app = createApp(gladys, {
    fetchImpl: fakeFetch((url) => ({ body: fixtureForUrl(url) })),
    now: () => SYNTHETIC_NOW,
    logger: silentLogger(),
    setTimer: () => ({}),
    clearTimer: () => {},
  });
  await gladys.fake.connect();
  await app.scheduler.settled();
  await gladys.fake.weatherGet({ ...HOUSES.paris, units: 'metric' });
  await gladys.fake.sceneAction(SCENE_ACTIONS.GET_PRECIPITATION_NEXT_HOUR, {});
  await gladys.fake.widgetGet(WIDGETS.PRECIPITATION_NEXT_HOURS, { settings: {} });
  assert.equal(gladys.fake.handlers.scanRequest, null, 'no discovery handler');
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  // Whatever would be published must pass the rules: none here.
  for (const device of gladys.fake.discoveredDevices) {
    assert.deepEqual(deviceViolations(device), []);
  }
});
