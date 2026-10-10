// -----------------------------------------------------------------------------
// Open-Meteo API client: ONE call returns everything the integration uses
// (current conditions, the next 3 hours in 15-minute steps, 48 hours, 8 days),
// so a refresh cycle costs exactly one call per location.
//
//   GET https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..
//       &current=..&minutely_15=..&hourly=..&daily=..
//       &timezone=auto&timeformat=unixtime&wind_speed_unit=ms&models=..
//
//   - metric units (°C, m/s, mm, m): one unit system for everything cached;
//     the conversion to the unit system of each Gladys request happens
//     locally (units.js), so a °F user and a °C user share one call;
//   - timeformat=unixtime: every time is an instant, immune to the daylight
//     saving switches a local time would hide; timezone=auto still cuts the
//     days at the local midnight of the location;
//   - forecast_hours / forecast_minutely_15 count from the current step, so a
//     response never carries hours already past.
//
// No key, no account: Open-Meteo is free for non-commercial use (10,000 calls
// a day, 5,000 an hour, 600 a minute, per IP). Errors come as JSON
// `{ "error": true, "reason": "..." }`, with HTTP 400 for a bad request and
// 429 once a limit is reached.
// -----------------------------------------------------------------------------

const API_URL = 'https://api.open-meteo.com/v1/forecast';

// Under the 15 s the core waits for a weather answer, with room to build it.
const REQUEST_TIMEOUT_MS = 10000;

// Every variable has a use in pivot.js, nowcast.js or conditions.js: the API
// counts a request with many variables as several calls.
const CURRENT_VARIABLES = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'dew_point_2m',
  'is_day',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'visibility',
  'uv_index',
  'snowfall',
];
const MINUTELY_15_VARIABLES = ['precipitation', 'snowfall', 'weather_code'];
const HOURLY_VARIABLES = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'uv_index',
  'is_day',
];
const DAILY_VARIABLES = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'sunrise',
  'sunset',
  'uv_index_max',
  'precipitation_sum',
  'snowfall_sum',
  'precipitation_probability_max',
  'relative_humidity_2m_mean',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
];

// Today and the next 7 days: Gladys keeps 8.
const FORECAST_DAYS = 8;
// Gladys keeps 24 hours; twice that lets a forecast served from the cache
// after a failed refresh still fill them.
const FORECAST_HOURS = 48;
// Three hours of 15-minute steps: the next hour stays covered even when the
// forecast is served an hour or two late.
const FORECAST_MINUTELY_15 = 12;

// What went wrong, as the rest of the integration needs to react to it.
const ERROR_KINDS = Object.freeze({
  LIMIT: 'limit', // 429: a daily, hourly or minutely limit is reached — wait
  REQUEST: 'request', // 400: bad coordinates or parameters — skip this location
  UPSTREAM: 'upstream', // 5xx: retry on the next cycle
  NETWORK: 'network', // DNS, timeout, reset: retry on the next cycle
  INVALID: 'invalid', // 200 with an unusable body
});

class OpenMeteoError extends Error {
  /**
   * @param {string} kind - One of ERROR_KINDS.
   * @param {string} message - A message safe to log.
   * @param {object} [details] - { status, reason }.
   */
  constructor(kind, message, { status = null, reason = null } = {}) {
    super(message);
    this.name = 'OpenMeteoError';
    this.kind = kind;
    this.status = status;
    this.reason = reason;
  }
}

/**
 * @description Build the request URL. Coordinates are rounded to 4 decimals
 * (about 10 m): the finest model grid is over a kilometre wide.
 * @param {number} latitude - The latitude.
 * @param {number} longitude - The longitude.
 * @param {string} [model] - The Open-Meteo model name.
 * @returns {string} The URL.
 * @example
 * buildUrl(48.8566, 2.3522, 'meteofrance_seamless');
 */
function buildUrl(latitude, longitude, model = 'best_match') {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: CURRENT_VARIABLES.join(','),
    minutely_15: MINUTELY_15_VARIABLES.join(','),
    hourly: HOURLY_VARIABLES.join(','),
    daily: DAILY_VARIABLES.join(','),
    timezone: 'auto',
    timeformat: 'unixtime',
    wind_speed_unit: 'ms',
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
    forecast_days: String(FORECAST_DAYS),
    forecast_hours: String(FORECAST_HOURS),
    forecast_minutely_15: String(FORECAST_MINUTELY_15),
    models: model,
  });
  // The API reads the lists comma-separated: keep the commas readable.
  return `${API_URL}?${params.toString().replaceAll('%2C', ',')}`;
}

/**
 * @description Classify a non-200 status.
 * @param {number} status - The HTTP status.
 * @returns {string} One of ERROR_KINDS.
 * @example
 * kindOfStatus(429); // -> 'limit'
 */
function kindOfStatus(status) {
  if (status === 429) {
    return ERROR_KINDS.LIMIT;
  }
  if (status >= 400 && status < 500) {
    return ERROR_KINDS.REQUEST;
  }
  return ERROR_KINDS.UPSTREAM;
}

/**
 * @description The `reason` of an Open-Meteo error body, bounded.
 * @param {string} text - The response body.
 * @returns {string|null} The reason, or null.
 * @example
 * readReason('{"error":true,"reason":"Latitude must be in range of -90 to 90°."}');
 */
function readReason(text) {
  try {
    const body = JSON.parse(text);
    if (typeof body?.reason === 'string' && body.reason.trim() !== '') {
      return body.reason.trim().slice(0, 200);
    }
  } catch {
    // Not JSON (a proxy page, an HTML 502): no reason to show.
  }
  return null;
}

/**
 * @description Fetch the forecast of a location.
 * @param {object} options - Options.
 * @param {number} options.latitude - The latitude.
 * @param {number} options.longitude - The longitude.
 * @param {string} [options.model] - The Open-Meteo model name.
 * @param {Function} [options.fetchImpl] - fetch, injectable for the tests.
 * @param {number} [options.timeoutMs] - The request timeout.
 * @returns {Promise<object>} The raw JSON body.
 * @throws {OpenMeteoError} On any failure, classified by `kind`.
 * @example
 * const data = await fetchForecast({ latitude: 48.86, longitude: 2.35 });
 */
async function fetchForecast({
  latitude,
  longitude,
  model = 'best_match',
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new OpenMeteoError(ERROR_KINDS.REQUEST, 'Invalid coordinates');
  }

  let response;
  try {
    response = await fetchImpl(buildUrl(latitude, longitude, model), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? 'timeout' : err?.cause?.code || err?.name;
    throw new OpenMeteoError(ERROR_KINDS.NETWORK, `Open-Meteo unreachable (${reason})`);
  }

  if (response.status !== 200) {
    const reason = readReason(await response.text().catch(() => ''));
    throw new OpenMeteoError(
      kindOfStatus(response.status),
      `Open-Meteo answered HTTP ${response.status}${reason ? `: ${reason}` : ''}`,
      { status: response.status, reason },
    );
  }

  try {
    return await response.json();
  } catch {
    throw new OpenMeteoError(ERROR_KINDS.INVALID, 'Open-Meteo sent an unreadable body', {
      status: 200,
    });
  }
}

export {
  API_URL,
  CURRENT_VARIABLES,
  DAILY_VARIABLES,
  ERROR_KINDS,
  FORECAST_DAYS,
  FORECAST_HOURS,
  FORECAST_MINUTELY_15,
  HOURLY_VARIABLES,
  MINUTELY_15_VARIABLES,
  OpenMeteoError,
  REQUEST_TIMEOUT_MS,
  buildUrl,
  fetchForecast,
  readReason,
};
