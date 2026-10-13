// -----------------------------------------------------------------------------
// In-memory stand-in for the Gladys SDK client, for the tests of src/app.js.
//
// It records the handlers the integration registers and everything it sends
// to Gladys (connection statuses, scene events, refresh nudges, discovered
// devices), and lets a test play Gladys' side: call a handler, emit
// 'connected', change the houses or the configuration. Kept rather than the
// SDK 0.15 `testing` export: it is small, it mirrors the argument checks that
// matter here (the scene event data rules of the core), and it records the
// device-side registrations (onPoll) a weather integration must never make.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

const SCENE_EVENT_MAX_KEYS = 30;

/**
 * @description Create a fake Gladys client.
 * @param {object} [options] - Options.
 * @param {object} [options.config] - The integration configuration.
 * @param {Array<object>} [options.houses] - The houses of Gladys.
 * @returns {object} The fake client; `fake` holds what Gladys received.
 * @example
 * const gladys = createFakeGladys({ houses: [house] });
 */
function createFakeGladys({ config = {}, houses = [] } = {}) {
  const emitter = new EventEmitter();
  const handlers = {
    weatherGet: null,
    actions: new Map(),
    sceneActions: new Map(),
    widgetGet: new Map(),
    configUpdated: null,
    scanRequest: null,
    poll: null,
  };
  const fake = {
    config: { ...config },
    houses: [...houses],
    connectionStatuses: [],
    sceneEvents: [],
    weatherRefreshes: 0,
    widgetRefreshes: [],
    discoveredDevices: [],
    getHousesCalls: 0,
    handlers,
  };

  const gladys = {
    fake,
    config: fake.config,
    on: (event, listener) => emitter.on(event, listener),
    onWeatherGet: (callback) => {
      handlers.weatherGet = callback;
    },
    onAction: (key, callback) => handlers.actions.set(key, callback),
    onSceneAction: (key, callback) => handlers.sceneActions.set(key, callback),
    onWidgetGet: (key, callback) => handlers.widgetGet.set(key, callback),
    onConfigUpdated: (callback) => {
      handlers.configUpdated = callback;
    },
    onScanRequest: (callback) => {
      handlers.scanRequest = callback;
    },
    onPoll: (callback) => {
      handlers.poll = callback;
    },
    async getConfig() {
      return { ...fake.config };
    },
    async getHouses() {
      fake.getHousesCalls += 1;
      return fake.houses.map((house) => ({ ...house }));
    },
    async setConnectionStatus(connected, message) {
      fake.connectionStatuses.push(message === undefined ? { connected } : { connected, message });
    },
    async publishSceneEvent(key, data = {}) {
      const entries = Object.entries(data);
      if (entries.length > SCENE_EVENT_MAX_KEYS) {
        throw new Error('scene event data holds more than 30 keys');
      }
      for (const [name, value] of entries) {
        const ok =
          value === null ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value)) ||
          (typeof value === 'string' && value.length <= 1000);
        if (!ok) {
          throw new Error(`scene event data "${name}" is not a primitive`);
        }
      }
      fake.sceneEvents.push({ key, data });
    },
    requestWeatherRefresh() {
      fake.weatherRefreshes += 1;
    },
    requestWidgetRefresh(key) {
      fake.widgetRefreshes.push(key);
    },
    async publishDiscoveredDevices(devices) {
      fake.discoveredDevices.push(...devices);
    },
  };

  // Gladys' side.
  fake.connect = async () => {
    for (const listener of emitter.listeners('connected')) {
      await listener();
    }
  };
  fake.weatherGet = (options) => handlers.weatherGet(options);
  fake.action = (key, fields = {}) => handlers.actions.get(key)(fields);
  fake.sceneAction = (key, fields = {}) => handlers.sceneActions.get(key)(fields);
  fake.widgetGet = (key, options) => handlers.widgetGet.get(key)(options);
  fake.configUpdated = async (next) => {
    fake.config = { ...next };
    gladys.config = fake.config;
    await handlers.configUpdated(fake.config);
  };
  fake.lastStatus = () => fake.connectionStatuses.at(-1);
  return gladys;
}

export { createFakeGladys };
