// -----------------------------------------------------------------------------
// Parse an Open-Meteo response into the slim, metric forecast the integration
// caches.
//
// Open-Meteo answers in columns (`hourly: { time: [...], temperature_2m:
// [...] }`); the rest of the integration reads rows (`hourly: [{ time,
// temperature }]`). Only the fields the integration reads are kept, in one
// unit system (°C, m/s, hPa, mm of water, cm of snow, km), so the cache of a
// few locations stays far below the 256 MB of the sandbox.
//
// Times become UNIX seconds. The request asks for `timeformat=unixtime`; an
// ISO local time ("2026-10-03T12:30", the API default) is also read, with the
// `utc_offset_seconds` of the response — the recorded fixtures of other
// projects use it.
//
// A model can lack a variable at a location (no UV index, no visibility, no
// 15-minute data, no probability outside the ensemble models): Open-Meteo
// then sends null, or leaves the variable out. Both become null here, and the
// pivot leaves the field out rather than inventing a value.
// -----------------------------------------------------------------------------

import { toMetric } from './units.js';

/**
 * @description Read a finite number, null otherwise.
 * @param {any} value - The raw value.
 * @returns {number|null} The number.
 * @example
 * num(null); // -> null
 */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @description Read a non-empty string.
 * @param {any} value - The raw value.
 * @returns {string|null} The trimmed string, or null.
 * @example
 * str(' Europe/Paris '); // -> 'Europe/Paris'
 */
function str(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * @description Read a time of the response as UNIX seconds.
 * @param {any} value - UNIX seconds, or an ISO local date or date-time.
 * @param {number} utcOffsetSeconds - The offset of the location.
 * @returns {number|null} UNIX seconds.
 * @example
 * readTime('2026-10-03T12:30', 7200); // -> 1759487400
 */
function readTime(value, utcOffsetSeconds) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour = '0', minute = '0'] = match;
  const local = Date.UTC(+year, +month - 1, +day, +hour, +minute) / 1000;
  return local - utcOffsetSeconds;
}

/**
 * @description The converters of a block, from its `*_units` companion.
 * @param {object} units - The `current_units`, `hourly_units`... block.
 * @returns {Function} `(variable) => converter to metric`.
 * @example
 * convertersOf({ wind_speed_10m: 'km/h' })('wind_speed_10m')(36); // -> 10
 */
function convertersOf(units) {
  const source = units !== null && typeof units === 'object' ? units : {};
  return (variable) => {
    const unit = source[variable];
    if (variable.startsWith('visibility')) {
      // m (or ft) → km.
      const toMetres = toMetric(unit);
      return (value) => toMetres(value) / 1000;
    }
    if (variable.startsWith('snowfall') && unit === 'inch') {
      // Snow depth: inches → cm.
      return (value) => value * 2.54;
    }
    return toMetric(unit);
  };
}

/**
 * @description Turn a column block into rows.
 * @param {object} block - The block (`{ time: [...], <variable>: [...] }`).
 * @param {object} units - Its `*_units` block.
 * @param {object} spec - `{ field: variable }`: the row fields to read.
 * @param {number} utcOffsetSeconds - The offset of the location.
 * @returns {Array<object>|null} The rows with a valid time, or null when the
 * block is absent.
 * @example
 * rowsOf(raw.hourly, raw.hourly_units, { temperature: 'temperature_2m' }, 0);
 */
function rowsOf(block, units, spec, utcOffsetSeconds) {
  if (block === null || typeof block !== 'object' || !Array.isArray(block.time)) {
    return null;
  }
  const convert = convertersOf(units);
  const columns = Object.entries(spec).map(([field, variable]) => {
    const column = Array.isArray(block[variable]) ? block[variable] : [];
    return [field, column, convert(variable)];
  });
  const rows = [];
  block.time.forEach((rawTime, index) => {
    const time = readTime(rawTime, utcOffsetSeconds);
    if (time === null) {
      return;
    }
    const row = { time };
    for (const [field, column, converter] of columns) {
      const value = num(column[index]);
      row[field] = value === null ? null : converter(value);
    }
    rows.push(row);
  });
  return rows;
}

/**
 * @description Read a single-value block (`current`).
 * @param {object} block - The block.
 * @param {object} units - Its `*_units` block.
 * @param {object} spec - `{ field: variable }`.
 * @param {number} utcOffsetSeconds - The offset of the location.
 * @returns {object|null} The row, or null without a valid time.
 * @example
 * pointOf(raw.current, raw.current_units, { temperature: 'temperature_2m' }, 0);
 */
function pointOf(block, units, spec, utcOffsetSeconds) {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    return null;
  }
  const columns = Object.fromEntries(Object.keys(block).map((key) => [key, [block[key]]]));
  return rowsOf(columns, units, spec, utcOffsetSeconds)?.[0] ?? null;
}

/**
 * @description A 0/1 flag as a boolean.
 * @param {number|null} value - The flag.
 * @returns {boolean|null} The boolean, or null when unknown.
 * @example
 * flag(1); // -> true
 */
function flag(value) {
  if (value === 1) {
    return true;
  }
  return value === 0 ? false : null;
}

/**
 * @description An integer code (weather code), null otherwise.
 * @param {number|null} value - The value.
 * @returns {number|null} The code.
 * @example
 * code(61); // -> 61
 */
function code(value) {
  return Number.isInteger(value) ? value : null;
}

const CURRENT_SPEC = {
  temperature: 'temperature_2m',
  humidity: 'relative_humidity_2m',
  apparentTemperature: 'apparent_temperature',
  dewPoint: 'dew_point_2m',
  isDay: 'is_day',
  weatherCode: 'weather_code',
  cloudCover: 'cloud_cover',
  pressure: 'pressure_msl',
  windSpeed: 'wind_speed_10m',
  windDirection: 'wind_direction_10m',
  windGust: 'wind_gusts_10m',
  visibility: 'visibility',
  uvIndex: 'uv_index',
  snowfall: 'snowfall',
};

const MINUTELY_15_SPEC = {
  precipitation: 'precipitation',
  snowfall: 'snowfall',
  weatherCode: 'weather_code',
};

const HOURLY_SPEC = {
  temperature: 'temperature_2m',
  humidity: 'relative_humidity_2m',
  apparentTemperature: 'apparent_temperature',
  precipitationProbability: 'precipitation_probability',
  precipitation: 'precipitation',
  snowfall: 'snowfall',
  weatherCode: 'weather_code',
  cloudCover: 'cloud_cover',
  pressure: 'pressure_msl',
  windSpeed: 'wind_speed_10m',
  windDirection: 'wind_direction_10m',
  windGust: 'wind_gusts_10m',
  uvIndex: 'uv_index',
  isDay: 'is_day',
};

const DAILY_SPEC = {
  weatherCode: 'weather_code',
  temperatureMax: 'temperature_2m_max',
  temperatureMin: 'temperature_2m_min',
  uvIndex: 'uv_index_max',
  precipitation: 'precipitation_sum',
  snowfall: 'snowfall_sum',
  precipitationProbability: 'precipitation_probability_max',
  humidity: 'relative_humidity_2m_mean',
  windSpeed: 'wind_speed_10m_max',
  windGust: 'wind_gusts_10m_max',
  windDirection: 'wind_direction_10m_dominant',
};

/**
 * @description The sunrise and sunset of a daily block, as UNIX seconds. They
 * are times, not numbers: read apart from the numeric columns. A polar day or
 * night has no sunrise or no sunset: anything outside the day, or a sunrise
 * not before the sunset, is null.
 * @param {object} block - The raw daily block.
 * @param {number} index - The day index.
 * @param {number} dayStart - The day start, UNIX seconds.
 * @param {number} utcOffsetSeconds - The offset of the location.
 * @returns {{sunrise: number|null, sunset: number|null}} The sun times.
 * @example
 * sunTimes(raw.daily, 0, day.time, 7200);
 */
function sunTimes(block, index, dayStart, utcOffsetSeconds) {
  const read = (key) => {
    const column = Array.isArray(block[key]) ? block[key] : [];
    const time = readTime(column[index], utcOffsetSeconds);
    // A day lasts 23 to 25 hours around a daylight saving switch.
    return time !== null && time >= dayStart && time <= dayStart + 25 * 3600 ? time : null;
  };
  const sunrise = read('sunrise');
  const sunset = read('sunset');
  if (sunrise === null || sunset === null || sunrise >= sunset) {
    return { sunrise: null, sunset: null };
  }
  return { sunrise, sunset };
}

/**
 * @description Parse a raw Open-Meteo forecast response.
 * @param {object} raw - The JSON body.
 * @param {object} [options] - Options.
 * @param {number} [options.fetchedAt] - When it was fetched, in ms.
 * @param {string} [options.model] - The model requested.
 * @returns {object} The slim forecast: `{ latitude, longitude, elevation,
 * timezone, utcOffsetSeconds, model, fetchedAt, current, minutely15 (array or
 * null), hourly, daily }`.
 * @throws {Error} When the body has no usable current conditions.
 * @example
 * const forecast = parseForecast(await response.json(), { fetchedAt: Date.now() });
 */
function parseForecast(raw, { fetchedAt = Date.now(), model = 'best_match' } = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('The Open-Meteo response is not an object');
  }
  const offset = num(raw.utc_offset_seconds) ?? 0;

  const current = pointOf(raw.current, raw.current_units, CURRENT_SPEC, offset);
  if (current === null || current.temperature === null) {
    // Without a temperature and a time the core rejects the payload anyway:
    // failing here keeps an unusable answer out of the cache. A regional
    // model asked for a location outside its region answers this way.
    throw new Error('The Open-Meteo response has no current conditions for this location');
  }
  current.isDay = flag(current.isDay);
  current.weatherCode = code(current.weatherCode);

  const minutely15 = rowsOf(raw.minutely_15, raw.minutely_15_units, MINUTELY_15_SPEC, offset);
  for (const step of minutely15 ?? []) {
    step.weatherCode = code(step.weatherCode);
  }

  const hourly = (rowsOf(raw.hourly, raw.hourly_units, HOURLY_SPEC, offset) ?? []).filter(
    (hour) => hour.temperature !== null,
  );
  for (const hour of hourly) {
    hour.isDay = flag(hour.isDay);
    hour.weatherCode = code(hour.weatherCode);
  }

  const daily = [];
  const dailyRows = rowsOf(raw.daily, raw.daily_units, DAILY_SPEC, offset) ?? [];
  dailyRows.forEach((day, index) => {
    if (day.temperatureMax === null || day.temperatureMin === null) {
      return;
    }
    daily.push({
      ...day,
      weatherCode: code(day.weatherCode),
      ...sunTimes(raw.daily, index, day.time, offset),
    });
  });

  return {
    latitude: num(raw.latitude),
    longitude: num(raw.longitude),
    elevation: num(raw.elevation),
    timezone: str(raw.timezone),
    utcOffsetSeconds: offset,
    model,
    fetchedAt,
    current,
    // A model without 15-minute data at a location sends a block of nulls:
    // keep it as is, nowcast.js reads the nulls as "not available".
    minutely15,
    hourly,
    daily,
  };
}

export { num, parseForecast, readTime };
