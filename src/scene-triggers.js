// -----------------------------------------------------------------------------
// Scene trigger "Precipitation expected within the hour".
//
// After each refresh of a house, its 15-minute forecast (nowcast.js) is
// compared with the previous one: when the previous hour was dry and the new
// one holds precipitation, the trigger fires once, with what is coming and
// when. The event carries the filters of the scene card (house, type,
// intensity) and the variables a scene can put in a message.
//
// What it is not: a radar. The 15-minute data is model data, read on the
// refresh cadence: a shower that starts between two refreshes is announced
// by the next one, as "now" (`minutes_until` 0).
//
// Two guards against noise:
//   - the first forecast of a house after a start is a baseline, it never
//     fires (a restart during a shower must not announce it again);
//   - a house fires at most once every 45 minutes: model runs can drop a
//     shower and bring it back on the next refresh.
// -----------------------------------------------------------------------------

import { isPrecipitationAnnounced, readNowcast } from './nowcast.js';
import { nowcastSentence } from './texts.js';

const SCENE_TRIGGERS = Object.freeze({ PRECIPITATION_EXPECTED: 'precipitation_expected' });

const COOLDOWN_MS = 45 * 60 * 1000;

/**
 * @description Build the event data of the trigger. Flat, as the core wants
 * it: the filter keys and the variable keys of the manifest declaration. A
 * probability the model does not give is left out, not sent as 0.
 * @param {object} house - The house.
 * @param {object} nowcast - The nowcast announcing precipitation.
 * @param {string} language - 'en', 'fr', 'de' or 'es', for the summary.
 * @returns {object} The event data.
 * @example
 * buildEventData(house, nowcast, 'en');
 */
function buildEventData(house, nowcast, language) {
  const data = {
    house: house.name,
    precipitation_type: nowcast.type,
    intensity: nowcast.intensity,
    minutes_until: nowcast.minutesUntil,
    summary: nowcastSentence(nowcast, language),
  };
  if (nowcast.probability !== null) {
    data.probability = nowcast.probability;
  }
  return data;
}

/**
 * @description Create the watcher of the precipitation trigger.
 * @param {object} options - Options.
 * @param {Function} options.publish - `(key, data) => Promise`, the SDK
 * publishSceneEvent.
 * @param {Function} options.getLanguage - `() => 'en'|'fr'|'de'|'es'`.
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @param {Function} [options.now] - `() => ms`, for the tests.
 * @returns {object} The watcher ({ observe, forget, reset }).
 * @example
 * const watcher = createPrecipitationWatcher({ publish, getLanguage: () => 'en' });
 */
function createPrecipitationWatcher({ publish, getLanguage, logger = console, now = Date.now }) {
  // house id -> { nowcast, lastFiredAt }
  const states = new Map();

  /**
   * @description Compare the new forecast of a house with the previous one,
   * and fire the trigger on the dry → wet transition.
   * @param {object} house - The house.
   * @param {object} forecast - Its new slim forecast.
   * @returns {Promise<object|null>} The published event data, or null.
   * @example
   * await watcher.observe(house, entry.forecast);
   */
  async function observe(house, forecast) {
    const nowcast = readNowcast(forecast, Math.floor(now() / 1000));
    const state = states.get(house.id) ?? { nowcast: null, lastFiredAt: null };
    const announced = isPrecipitationAnnounced(state.nowcast, nowcast);
    states.set(house.id, { ...state, nowcast });
    if (!announced) {
      return null;
    }
    if (state.lastFiredAt !== null && now() - state.lastFiredAt < COOLDOWN_MS) {
      logger.debug(`Precipitation trigger for "${house.name}" skipped (cooldown)`);
      return null;
    }
    states.set(house.id, { nowcast, lastFiredAt: now() });
    const data = buildEventData(house, nowcast, getLanguage());
    try {
      logger.info(`Scene event ${SCENE_TRIGGERS.PRECIPITATION_EXPECTED} for "${house.name}"`);
      await publish(SCENE_TRIGGERS.PRECIPITATION_EXPECTED, data);
    } catch (err) {
      // Refused (core too old, disconnected, rate limited): logged, never
      // thrown — the refresh cycle carries on.
      logger.warn(`Scene event refused: ${err.message}`);
    }
    return data;
  }

  /**
   * @description Forget the houses that disappeared (deleted, unlocated).
   * @param {Set<any>} ids - The ids of the current houses.
   * @example
   * watcher.forget(new Set([1, 2]));
   */
  function forget(ids) {
    for (const id of states.keys()) {
      if (!ids.has(id)) {
        states.delete(id);
      }
    }
  }

  /**
   * @description Forget everything: the next forecast of each house is a new
   * baseline (another model, for instance).
   * @example
   * watcher.reset();
   */
  function reset() {
    states.clear();
  }

  return { observe, forget, reset };
}

export { COOLDOWN_MS, SCENE_TRIGGERS, buildEventData, createPrecipitationWatcher };
