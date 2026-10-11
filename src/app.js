// -----------------------------------------------------------------------------
// The integration, wired to a Gladys client.
//
// Open-Meteo is a WEATHER integration (manifest `type: "weather"`, contract
// B.18): no devices, no discovery — a provider API. Gladys asks for the
// weather of a house, the integration answers in the pivot format, and the
// core feeds its weather widget and the chat assistant with it.
//
//   onWeatherGet       the pivot payload, from the forecast in memory;
//   onSceneAction      "precipitation of the next hour" (scene-actions.js);
//   publishSceneEvent  "precipitation expected within the hour"
//                      (scene-triggers.js);
//   onWidgetGet        the 15-minute precipitation chart (widget.js);
//   onAction           "Test Open-Meteo".
//
// One timer refreshes every located house on the configured cadence
// (scheduler.js); everything else reads the forecast store
// (forecast-store.js). Open-Meteo has no official alerts, so the integration
// never nudges the core's weather-alert check (requestWeatherRefresh).
// The SDK client is injected, so the tests drive this module with a fake one.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './api.js';
import { normalizeConfig, refreshMinutes } from './config.js';
import { createForecastStore } from './forecast-store.js';
import { createHouseRegistry } from './houses.js';
import { buildWeather } from './pivot.js';
import { SCENE_ACTIONS, precipitationNextHour } from './scene-actions.js';
import { createPrecipitationWatcher } from './scene-triggers.js';
import { createScheduler } from './scheduler.js';
import { MESSAGES, localized, resolveLanguage, template } from './texts.js';
import { fromMetric } from './units.js';
import { WIDGETS, buildUnavailableContent, buildWidgetContent } from './widget.js';

// A forecast younger than the refresh interval plus this margin is served as
// is; older, a reader triggers a call (the timer may be late, a house new).
const FRESHNESS_GRACE_MS = 5 * 60 * 1000;

/**
 * @description The connection status matching the last refresh cycle.
 * @param {object|null} summary - The last cycle summary.
 * @returns {{connected: boolean, message?: object}} The status.
 * @example
 * connectionStatus({ houses: 1, refreshed: 1, error: null });
 */
function connectionStatus(summary) {
  if (summary !== null && summary.houses === 0) {
    return {
      connected: false,
      message: MESSAGES.noLocation,
    };
  }
  const error = summary?.error ?? null;
  if (error === null || summary.refreshed > 0) {
    return { connected: true };
  }
  if (error.kind === ERROR_KINDS.LIMIT) {
    return {
      connected: false,
      message: MESSAGES.limitReached,
    };
  }
  if (error.kind === ERROR_KINDS.INVALID || error.kind === ERROR_KINDS.REQUEST) {
    return {
      connected: false,
      message: MESSAGES.noForecastForModel,
    };
  }
  return {
    connected: false,
    message: MESSAGES.unreachable,
  };
}

/**
 * @description Create the integration on a Gladys client.
 * @param {object} gladys - The SDK client (GladysIntegration, or a fake).
 * @param {object} [options] - Options, for the tests.
 * @param {Function} [options.fetchImpl] - fetch.
 * @param {Function} [options.now] - `() => ms`.
 * @param {object} [options.logger] - Logger with info/warn/debug/error.
 * @param {Function} [options.setTimer] - setTimeout.
 * @param {Function} [options.clearTimer] - clearTimeout.
 * @returns {object} The running parts ({ store, scheduler, houses, watcher, config }).
 * @example
 * createApp(new GladysIntegration());
 */
function createApp(
  gladys,
  { fetchImpl = globalThis.fetch, now = Date.now, logger = console, setTimer, clearTimer } = {},
) {
  let config = normalizeConfig(gladys.config ?? {});
  // Language of the last request of the core, for the texts of the scenes.
  let lastLanguage = null;
  let lastSummary = null;
  let lastStatus = null;

  const language = () => resolveLanguage(config.language, lastLanguage);

  const houses = createHouseRegistry({ fetchHouses: () => gladys.getHouses(), logger });
  const store = createForecastStore({ getModel: () => config.model, fetchImpl, now, logger });
  const watcher = createPrecipitationWatcher({
    publish: (key, data) => gladys.publishSceneEvent(key, data),
    getLanguage: language,
    logger,
    now,
  });

  /**
   * @description Publish the connection status, only when it changed.
   * @returns {Promise<void>} Resolves once published (or refused).
   * @example
   * await publishStatus();
   */
  async function publishStatus() {
    const status = connectionStatus(lastSummary);
    const serialized = JSON.stringify(status);
    if (serialized === lastStatus) {
      return;
    }
    try {
      await gladys.setConnectionStatus(status.connected, status.message);
      lastStatus = serialized;
    } catch (err) {
      logger.warn(`Unable to publish the connection status: ${err.message}`);
    }
  }

  const scheduler = createScheduler({
    houses,
    store,
    getIntervalMinutes: () => refreshMinutes(config),
    logger,
    now,
    ...(setTimer ? { setTimer } : {}),
    ...(clearTimer ? { clearTimer } : {}),
    onRefreshed: (house, entry) => watcher.observe(house, entry.forecast),
    onCycle: async (summary) => {
      lastSummary = summary;
      watcher.forget(new Set(houses.list().map((house) => house.id)));
      logger.info(
        `Refreshed ${summary.refreshed} location(s) of ${summary.houses} house(s); next refresh in ${Math.round(summary.delayMs / 60000)} min`,
      );
      if (summary.refreshed > 0) {
        try {
          gladys.requestWidgetRefresh(WIDGETS.PRECIPITATION_NEXT_HOURS);
        } catch (err) {
          logger.debug(`Widget refresh not requested: ${err.message}`);
        }
      }
      await publishStatus();
    },
  });

  /**
   * @description How old a forecast may be and still be served without a
   * call: the refresh interval, plus a margin for a late timer.
   * @returns {{maxAgeMs: number}} The load options.
   * @example
   * store.load(latitude, longitude, loadOptions());
   */
  function loadOptions() {
    return { maxAgeMs: refreshMinutes(config) * 60 * 1000 + FRESHNESS_GRACE_MS };
  }

  /**
   * @description The house a scene action or a widget targets, reading the
   * houses once more when none is known yet.
   * @param {any} name - The "House" field.
   * @returns {Promise<object>} The house.
   * @example
   * await resolveHouse('');
   */
  async function resolveHouse(name) {
    if (houses.list().length === 0) {
      await houses.refresh();
    }
    return houses.resolve(name);
  }

  /**
   * @description Forget the forecasts: another model starts clean, and its
   * first forecast of each house is a new baseline for the trigger.
   * @example
   * forgetForecasts();
   */
  function forgetForecasts() {
    store.reset();
    watcher.reset();
  }

  // --- Weather request: the dashboard, the chat, the alert scenes -------------
  gladys.onWeatherGet(async ({ latitude, longitude, language: requested, units } = {}) => {
    if (typeof requested === 'string' && requested !== '') {
      lastLanguage = requested;
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('The house has no location');
    }
    const { forecast } = await store.load(latitude, longitude, loadOptions());
    return buildWeather(forecast, { units: units === 'us' ? 'us' : 'metric', now: now() });
  });

  // --- Scene action: precipitation of the next hour -------------------------
  gladys.onSceneAction(SCENE_ACTIONS.GET_PRECIPITATION_NEXT_HOUR, async (fields = {}) => {
    const house = await resolveHouse(fields?.house);
    const { forecast } = await store.load(house.latitude, house.longitude, loadOptions());
    return precipitationNextHour(forecast, language(), now());
  });

  // --- Dashboard widget: the 15-minute chart ---------------------------------
  gladys.onWidgetGet(
    WIDGETS.PRECIPITATION_NEXT_HOURS,
    async ({ settings = {}, language: requested, units } = {}) => {
      const lang = resolveLanguage(
        'auto',
        typeof requested === 'string' && requested !== '' ? requested : language(),
      );
      try {
        const house = await resolveHouse(settings?.house);
        const entry = await store.load(house.latitude, house.longitude, loadOptions());
        return buildWidgetContent({
          house,
          entry,
          units: units === 'us' ? 'us' : 'metric',
          language: lang,
          now: now(),
        });
      } catch (err) {
        logger.warn(`Widget content unavailable: ${err.message}`);
        return buildUnavailableContent(template('forecastUnavailable', lang)(err.message));
      }
    },
  );

  // --- Configuration action: test Open-Meteo ---------------------------------
  gladys.onAction('test_connection', async () => {
    const house = await resolveHouse('');
    const entry = await store.refresh(house.latitude, house.longitude);
    const { current, elevation } = entry.forecast;
    const metric = fromMetric('metric').temperature(current.temperature);
    const us = fromMetric('us').temperature(current.temperature);
    const model = config.model === 'best_match' ? null : config.model;
    const where = elevation === null ? '' : ` (${Math.round(elevation)} m)`;
    const minutes = refreshMinutes(config);
    // A refresh that failed before may now work: refresh the others too.
    if (lastSummary?.error) {
      scheduler.requestCycle();
    }
    return localized('testSucceeded', {
      us,
      metric,
      house: house.name,
      where,
      model,
      minutes,
    });
  });

  // --- Configuration ---------------------------------------------------------
  gladys.onConfigUpdated(async (raw) => {
    const previousModel = config.model;
    config = normalizeConfig(raw);
    if (config.model !== previousModel) {
      logger.info(`Weather model changed to ${config.model}: refreshing now`);
      forgetForecasts();
      if (scheduler.started) {
        await scheduler.requestCycle();
      }
      return;
    }
    scheduler.reschedule();
  });

  // --- Connection lifecycle --------------------------------------------------
  gladys.on('connected', async () => {
    try {
      const previousModel = config.model;
      config = normalizeConfig(await gladys.getConfig());
      // Gladys may have restarted: publish the status again.
      lastStatus = null;
      if (!scheduler.started) {
        // The first cycle runs in the background: the connection must not
        // wait for Open-Meteo.
        scheduler.start();
      } else if (config.model !== previousModel) {
        // The model changed while we were disconnected.
        forgetForecasts();
        await scheduler.requestCycle();
      } else {
        await houses.refresh();
        await publishStatus();
      }
    } catch (err) {
      logger.error(`Post-connection initialization failed: ${err.message}`);
    }
  });

  return {
    store,
    scheduler,
    houses,
    watcher,
    get config() {
      return config;
    },
  };
}

export { FRESHNESS_GRACE_MS, connectionStatus, createApp };
