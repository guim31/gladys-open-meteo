// -----------------------------------------------------------------------------
// The forecast store: the last Open-Meteo forecast of each location, the only
// thing that ever calls the API.
//
// Every reader goes through it — the core's weather requests (dashboard,
// chat, the core's 30-minute alert check), the scene action, the widget — and
// is served from memory: the scheduler (scheduler.js) refreshes the houses on
// the configured cadence, so a weather request costs no call at all. A call
// is only made for a location nobody refreshed recently (a house added since
// the last cycle), and concurrent requests for one location share one call.
//
// When Open-Meteo fails, a forecast up to 3 hours old is still served rather
// than nothing: an hour-old forecast beats the core falling back to another
// provider, or an empty dashboard. Older than that, the request fails and the
// core moves on to the next provider.
//
// A 429 (a limit of the free API reached, shared by every application behind
// the same public IP) blocks every call for a while: retrying at once would
// only be refused again.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, OpenMeteoError, fetchForecast } from './api.js';
import { parseForecast } from './forecast.js';
import { createIssueLog } from './issue-log.js';

// Two requests closer than this (~110 m) are the same location.
const COORDINATE_DECIMALS = 3;

// Beyond this, a cached forecast is no longer served when a refresh fails.
const STALE_MAX_MS = 3 * 60 * 60 * 1000;

// How long a 429 blocks the calls: Open-Meteo says which limit was hit in its
// `reason` ("Minutely API request limit exceeded...", "Hourly...", "Daily...").
const LIMIT_RETRY_MS = Object.freeze({
  minutely: 60 * 1000,
  default: 60 * 60 * 1000,
});

/**
 * @description The cache key of a location.
 * @param {number} latitude - The latitude.
 * @param {number} longitude - The longitude.
 * @returns {string} The key.
 * @example
 * locationKey(48.85661, 2.35222); // -> '48.857,2.352'
 */
function locationKey(latitude, longitude) {
  return `${latitude.toFixed(COORDINATE_DECIMALS)},${longitude.toFixed(COORDINATE_DECIMALS)}`;
}

/**
 * @description How long a 429 blocks the calls.
 * @param {string|null} reason - The reason sent by Open-Meteo.
 * @returns {number} Milliseconds.
 * @example
 * limitRetryMs('Minutely API request limit exceeded. Please try again in one minute.'); // -> 60000
 */
function limitRetryMs(reason) {
  return /minutely/i.test(reason ?? '') ? LIMIT_RETRY_MS.minutely : LIMIT_RETRY_MS.default;
}

/**
 * @description Create the forecast store.
 * @param {object} options - Options.
 * @param {Function} [options.getModel] - `() => string`, the configured model.
 * @param {Function} [options.fetchImpl] - fetch, injectable for the tests.
 * @param {Function} [options.now] - `() => ms`, injectable for the tests.
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @returns {object} The store.
 * @example
 * const store = createForecastStore({ getModel: () => config.model });
 */
function createForecastStore({
  getModel = () => 'best_match',
  fetchImpl = globalThis.fetch,
  now = Date.now,
  logger = console,
}) {
  // key -> { forecast, fetchedAt }
  const entries = new Map();
  // key -> Promise of the call under way
  const inflight = new Map();
  // A failing location is logged once when it fails, once when it recovers.
  const issues = createIssueLog(logger);
  // { kind, message, at } of the last failed call, null after a success.
  let lastError = null;
  let blockedUntil = 0;
  let calls = 0;

  /**
   * @description Why calls are refused right now, if they are.
   * @returns {OpenMeteoError|null} The error to throw, or null.
   * @example
   * blockedError();
   */
  function blockedError() {
    if (blockedUntil > now()) {
      return new OpenMeteoError(
        ERROR_KINDS.LIMIT,
        `Open-Meteo request limit reached, retrying after ${new Date(blockedUntil).toISOString()}`,
      );
    }
    return null;
  }

  /**
   * @description Call the API for a location, sharing a call under way.
   * @param {number} latitude - The latitude.
   * @param {number} longitude - The longitude.
   * @returns {Promise<object>} The new entry `{ forecast, fetchedAt }`.
   * @throws {OpenMeteoError} When the call fails or is blocked.
   * @example
   * await store.refresh(48.86, 2.35);
   */
  function refresh(latitude, longitude) {
    const key = locationKey(latitude, longitude);
    const pending = inflight.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const blocked = blockedError();
    if (blocked !== null) {
      return Promise.reject(blocked);
    }
    const model = getModel();
    const call = (async () => {
      calls += 1;
      try {
        const data = await fetchForecast({ latitude, longitude, model, fetchImpl });
        const fetchedAt = now();
        let forecast;
        try {
          forecast = parseForecast(data, { fetchedAt, model });
        } catch (err) {
          throw new OpenMeteoError(ERROR_KINDS.INVALID, err.message);
        }
        const entry = { forecast, fetchedAt };
        // A model changed while the call ran: its answer is not cached.
        if (model === getModel()) {
          entries.set(key, entry);
        }
        lastError = null;
        issues.recover(key, 'Open-Meteo answers again');
        return entry;
      } catch (err) {
        const kind = err.kind ?? ERROR_KINDS.NETWORK;
        lastError = { kind, message: err.message, at: now() };
        issues.fail(key, kind, `Open-Meteo request failed: ${err.message}`);
        if (kind === ERROR_KINDS.LIMIT && err.status === 429) {
          blockedUntil = now() + limitRetryMs(err.reason);
        }
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, call);
    return call;
  }

  /**
   * @description The cached entry of a location, whatever its age.
   * @param {number} latitude - The latitude.
   * @param {number} longitude - The longitude.
   * @returns {object|null} `{ forecast, fetchedAt }`, or null.
   * @example
   * store.peek(48.86, 2.35);
   */
  function peek(latitude, longitude) {
    return entries.get(locationKey(latitude, longitude)) ?? null;
  }

  /**
   * @description The age of an entry, in whole minutes.
   * @param {object} entry - A cache entry.
   * @returns {number} Minutes.
   * @example
   * ageMinutes(entry);
   */
  function ageMinutes(entry) {
    return Math.round((now() - entry.fetchedAt) / 60000);
  }

  /**
   * @description The forecast of a location for a reader: the cached one when
   * younger than `maxAgeMs`, else a fresh call — falling back to a cached one
   * up to 3 hours old when the call fails.
   * @param {number} latitude - The latitude.
   * @param {number} longitude - The longitude.
   * @param {object} options - Options.
   * @param {number} options.maxAgeMs - The age under which the cache is used.
   * @returns {Promise<object>} `{ forecast, fetchedAt, stale }`.
   * @throws {OpenMeteoError} When there is nothing to serve.
   * @example
   * const { forecast } = await store.load(48.86, 2.35, { maxAgeMs: 20 * 60000 });
   */
  async function load(latitude, longitude, { maxAgeMs }) {
    const cached = peek(latitude, longitude);
    if (cached !== null && now() - cached.fetchedAt <= maxAgeMs) {
      return { ...cached, stale: false };
    }
    try {
      return { ...(await refresh(latitude, longitude)), stale: false };
    } catch (err) {
      if (cached !== null && now() - cached.fetchedAt <= STALE_MAX_MS) {
        // The failure itself is logged once by refresh(): one line per request
        // here would repeat it for every dashboard view.
        logger.debug(`Serving a forecast cached ${ageMinutes(cached)} min ago: ${err.message}`);
        return { ...cached, stale: true };
      }
      throw err;
    }
  }

  /**
   * @description Drop the entries of locations no longer refreshed, once they
   * are too old to be served: memory stays bounded by the houses.
   * @param {Set<string>} keep - The keys of the refreshed locations.
   * @example
   * store.prune(new Set(['48.857,2.352']));
   */
  function prune(keep) {
    for (const [key, entry] of entries) {
      if (!keep.has(key) && now() - entry.fetchedAt > STALE_MAX_MS) {
        entries.delete(key);
      }
    }
    issues.retain((key) => keep.has(key) || entries.has(key));
  }

  /**
   * @description Forget every forecast: a new model starts clean.
   * @example
   * store.reset();
   */
  function reset() {
    entries.clear();
    lastError = null;
    issues.retain(() => false);
  }

  return {
    refresh,
    peek,
    load,
    prune,
    reset,
    blockedError,
    get lastError() {
      return lastError;
    },
    get calls() {
      return calls;
    },
    get size() {
      return entries.size;
    },
  };
}

export {
  COORDINATE_DECIMALS,
  LIMIT_RETRY_MS,
  STALE_MAX_MS,
  createForecastStore,
  limitRetryMs,
  locationKey,
};
