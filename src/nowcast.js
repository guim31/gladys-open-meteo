// -----------------------------------------------------------------------------
// The next hour, from the 15-minute block (`minutely_15`).
//
// Open-Meteo gives, every 15 minutes, the precipitation of the PRECEDING 15
// minutes (mm of water), the snowfall (cm) and a weather code. The step
// stamped 14:15 covers 14:00-14:15. It is model data, not a radar nowcast:
// native 15-minute runs over Central Europe (DWD ICON-D2) and North America
// (NOAA HRRR), interpolated from hourly models elsewhere. Good enough to say
// "rain within the hour", not to time a shower to the minute.
//
// A step counts as wet from 0.1 mm in 15 minutes (0.4 mm/h), the resolution
// of the API: below, nothing falls. The intensity classes are the usual
// rainfall rates, in liquid water equivalent: light under 2.5 mm/h
// (0.1 in/h), moderate up to 7.6 mm/h (0.3 in/h), heavy above.
//
// The precipitation probability is not a 15-minute variable: the one shown
// is the hourly probability (from the ensemble models) of the hour the
// precipitation starts in, when the model has one.
//
// A forecast without 15-minute data covering the next hour is "not
// available": the trigger stays silent and the scene action says so, instead
// of reading "dry" into missing data.
// -----------------------------------------------------------------------------

import { FREEZING_CODES } from './conditions.js';

const STEP_SECONDS = 15 * 60;
const WET_MM_PER_STEP = 0.1;
const MODERATE_MM_H = 2.5;
const HEAVY_MM_H = 7.6;
// Open-Meteo derives snowfall as 0.7 cm of snow per mm of water.
const SNOW_CM_PER_MM = 0.7;

// The steps of the next hour, and twice that for the widget chart.
const HOUR_STEPS = 4;
const CHART_STEPS = 8;

const INTENSITIES = Object.freeze({ LIGHT: 'light', MODERATE: 'moderate', HEAVY: 'heavy' });

const PRECIPITATION_TYPES = Object.freeze({
  RAIN: 'rain',
  SNOW: 'snow',
  FREEZING_RAIN: 'freezing_rain',
});

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

/**
 * @description Whether a 15-minute step is wet.
 * @param {object} step - A slim minutely_15 point.
 * @returns {boolean} True when precipitation falls during the step.
 * @example
 * isWet({ precipitation: 0.3 }); // -> true
 */
function isWet(step) {
  return step.precipitation !== null && step.precipitation >= WET_MM_PER_STEP;
}

/**
 * @description The intensity class of a liquid intensity.
 * @param {number} intensity - mm/h.
 * @returns {string} One of INTENSITIES.
 * @example
 * intensityClass(3); // -> 'moderate'
 */
function intensityClass(intensity) {
  if (intensity >= HEAVY_MM_H) {
    return INTENSITIES.HEAVY;
  }
  if (intensity >= MODERATE_MM_H) {
    return INTENSITIES.MODERATE;
  }
  return INTENSITIES.LIGHT;
}

/**
 * @description The precipitation type of a wet step: freezing when the
 * weather code says so, snow when snow is most of the water that falls (or
 * the code says snow), rain otherwise.
 * @param {object} step - A wet slim minutely_15 point.
 * @returns {string} One of PRECIPITATION_TYPES.
 * @example
 * precipitationType({ precipitation: 1, snowfall: 0.7, weatherCode: 73 }); // -> 'snow'
 */
function precipitationType(step) {
  if (FREEZING_CODES.has(step.weatherCode)) {
    return PRECIPITATION_TYPES.FREEZING_RAIN;
  }
  const snowWater = (step.snowfall ?? 0) / SNOW_CM_PER_MM;
  if (SNOW_CODES.has(step.weatherCode) || (snowWater > 0 && snowWater >= step.precipitation / 2)) {
    return PRECIPITATION_TYPES.SNOW;
  }
  return PRECIPITATION_TYPES.RAIN;
}

/**
 * @description The hourly probability of precipitation of the hour holding
 * an instant (the hour stamped T covers T-1h to T).
 * @param {Array<object>} hourly - The slim hourly points.
 * @param {number} time - UNIX seconds.
 * @returns {number|null} 0-100, or null.
 * @example
 * probabilityAt(forecast.hourly, start);
 */
function probabilityAt(hourly, time) {
  const hour = (hourly || []).find((candidate) => candidate.time > time);
  const value = hour?.precipitationProbability ?? null;
  return value === null ? null : Math.round(value);
}

/**
 * @description Read the next hour of a forecast.
 * @param {object} forecast - The slim metric forecast.
 * @param {number} nowSeconds - The current UNIX time.
 * @returns {object} `{ available: false }`, or `{ available: true, wetNow,
 * minutesUntil (null when dry), durationMinutes, type, intensity,
 * peakIntensity (mm/h), probability (0-100 or null), points }` — `points`
 * being the next two hours `{ time, intensity }` for the widget chart, each
 * stamped at the start of its step.
 * @example
 * readNowcast(forecast, Math.floor(Date.now() / 1000));
 */
function readNowcast(forecast, nowSeconds) {
  // Steps still running or to come, in order, with a value.
  const upcoming = (forecast.minutely15 || [])
    .filter((step) => step.time > nowSeconds && step.precipitation !== null)
    .sort((a, b) => a.time - b.time);
  const hour = upcoming.slice(0, HOUR_STEPS);
  const covered =
    hour.length === HOUR_STEPS &&
    hour[0].time - STEP_SECONDS <= nowSeconds &&
    hour.every((step, index) => index === 0 || step.time - hour[index - 1].time === STEP_SECONDS);
  if (!covered) {
    return { available: false };
  }
  const points = upcoming.slice(0, CHART_STEPS).map((step) => ({
    time: step.time - STEP_SECONDS,
    intensity: (step.precipitation * 3600) / STEP_SECONDS,
  }));

  const firstWet = hour.findIndex(isWet);
  if (firstWet === -1) {
    return {
      available: true,
      wetNow: false,
      minutesUntil: null,
      durationMinutes: 0,
      type: null,
      intensity: null,
      peakIntensity: 0,
      probability: null,
      points,
    };
  }

  // The first wet spell: from its first step to the next dry one (it may run
  // past the hour, the 3 hours of steps say how long).
  let end = firstWet;
  while (end < upcoming.length && isWet(upcoming[end])) {
    end += 1;
  }
  const spell = upcoming.slice(firstWet, end);
  const peakIntensity = Math.max(
    ...spell.map((step) => (step.precipitation * 3600) / STEP_SECONDS),
  );
  const first = upcoming[firstWet];
  const start = first.time - STEP_SECONDS;
  return {
    available: true,
    wetNow: start <= nowSeconds,
    minutesUntil: Math.max(0, Math.round((start - nowSeconds) / 60)),
    durationMinutes: (spell.length * STEP_SECONDS) / 60,
    type: precipitationType(first),
    intensity: intensityClass(peakIntensity),
    peakIntensity,
    probability: probabilityAt(forecast.hourly, start),
    points,
  };
}

/**
 * @description Whether a new nowcast announces precipitation the previous one
 * did not: the transition the trigger fires on. The first nowcast of a
 * location is a baseline (null previous): it never fires — a restart during a
 * shower must not announce it again.
 * @param {object|null} previous - The previous nowcast of the location.
 * @param {object} current - The new nowcast.
 * @returns {boolean} True when the trigger should fire.
 * @example
 * isPrecipitationAnnounced(previousNowcast, nowcast);
 */
function isPrecipitationAnnounced(previous, current) {
  if (!current.available || current.minutesUntil === null) {
    return false;
  }
  if (previous === null || !previous.available) {
    return false;
  }
  return previous.minutesUntil === null;
}

export {
  HEAVY_MM_H,
  INTENSITIES,
  MODERATE_MM_H,
  PRECIPITATION_TYPES,
  STEP_SECONDS,
  WET_MM_PER_STEP,
  intensityClass,
  isPrecipitationAnnounced,
  isWet,
  precipitationType,
  readNowcast,
};
