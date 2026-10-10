// -----------------------------------------------------------------------------
// WMO weather codes → Gladys weather conditions.
//
// Open-Meteo describes the sky with the WMO code table 4677, reduced to the
// 28 codes below (https://open-meteo.com/en/docs, "WMO Weather interpretation
// codes"). The code is the meteorology only: day or night is the separate
// `is_day` flag of the API, sent as the pivot `is_day` (the `night` condition
// is deprecated for providers).
//
//   code        WMO meaning                          Gladys
//   0, 1        clear sky, mainly clear              clear
//   2           partly cloudy                        partly-cloudy
//   3           overcast                             cloud
//   45          fog                                  fog (freezing-fog ≤ 0 °C)
//   48          depositing rime fog                  freezing-fog
//   51 53 55    drizzle                              drizzle
//   56 57       freezing drizzle                     freezing-rain
//   61 63       rain, slight and moderate            rain
//   65          rain, heavy                          pouring
//   66 67       freezing rain                        freezing-rain
//   71 73 75    snow fall                            snow
//   77          snow grains                          snow
//   80 81       rain showers, slight and moderate    rain
//   82          rain showers, violent                pouring
//   85 86       snow showers                         snow
//   95          thunderstorm                         thunderstorm
//   96 99       thunderstorm with hail               thunderstorm
//
// Thunderstorm with hail stays `thunderstorm`: the thunder is the hazard that
// defines it, and Open-Meteo only forecasts the hail in Central Europe. A
// thunderstorm whose precipitation is snow (snowfall at or below 1 °C) is
// `snow-thunderstorm`. Rime only forms below 0 °C, so code 48 is freezing fog.
//
// A code outside the table (added to the API after this code, or a model
// with no code at a location) falls back to the cloud cover.
// -----------------------------------------------------------------------------

import { WEATHER_CONDITIONS as C } from '@gladysassistant/integration-sdk';

const WMO_CONDITIONS = Object.freeze({
  0: C.CLEAR,
  1: C.CLEAR,
  2: C.PARTLY_CLOUDY,
  3: C.CLOUD,
  45: C.FOG,
  48: C.FREEZING_FOG,
  51: C.DRIZZLE,
  53: C.DRIZZLE,
  55: C.DRIZZLE,
  56: C.FREEZING_RAIN,
  57: C.FREEZING_RAIN,
  61: C.RAIN,
  63: C.RAIN,
  65: C.POURING,
  66: C.FREEZING_RAIN,
  67: C.FREEZING_RAIN,
  71: C.SNOW,
  73: C.SNOW,
  75: C.SNOW,
  77: C.SNOW,
  80: C.RAIN,
  81: C.RAIN,
  82: C.POURING,
  85: C.SNOW,
  86: C.SNOW,
  95: C.THUNDERSTORM,
  96: C.THUNDERSTORM,
  99: C.THUNDERSTORM,
});

// The WMO codes of freezing precipitation (drizzle and rain).
const FREEZING_CODES = new Set([56, 57, 66, 67]);

/**
 * @description The condition of a sky from its cloud cover, with the oktas
 * boundaries of the WMO codes 1-3.
 * @param {number|null} cloudCover - Cloud cover, 0-100.
 * @returns {string} A condition (unknown without a cover).
 * @example
 * skyCondition(50); // -> 'partly-cloudy'
 */
function skyCondition(cloudCover) {
  if (cloudCover === null || cloudCover === undefined) {
    return C.UNKNOWN;
  }
  if (cloudCover > 87.5) {
    return C.CLOUD;
  }
  if (cloudCover > 37.5) {
    return C.PARTLY_CLOUDY;
  }
  return C.CLEAR;
}

/**
 * @description Map a data point (current, hour or day) to a Gladys condition.
 * @param {object} point - A slim data point: `weatherCode`, `cloudCover`,
 * `snowfall`, and `temperature` — or `temperatureMax` for a day: fog is
 * freezing when even the warmest hour freezes.
 * @returns {string} A condition of the Gladys enum.
 * @example
 * toCondition({ weatherCode: 45, temperature: -3 }); // -> 'freezing-fog'
 */
function toCondition(point) {
  const condition = Object.hasOwn(WMO_CONDITIONS, point.weatherCode ?? '')
    ? WMO_CONDITIONS[point.weatherCode]
    : skyCondition(point.cloudCover);
  const temperature = point.temperature ?? point.temperatureMax ?? null;
  if (condition === C.FOG && temperature !== null && temperature <= 0) {
    return C.FREEZING_FOG;
  }
  if (
    condition === C.THUNDERSTORM &&
    (point.snowfall ?? 0) > 0 &&
    temperature !== null &&
    temperature <= 1
  ) {
    return C.SNOW_THUNDERSTORM;
  }
  return condition;
}

/**
 * @description Whether the sun is up at a time: the `is_day` flag of the API
 * when it is known, else the sunrise and sunset of the day holding the time.
 * @param {number} time - UNIX seconds.
 * @param {boolean|null} isDayFlag - The `is_day` of the point.
 * @param {Array<object>} days - The slim daily points.
 * @returns {boolean|null} true by day, false by night, null when unknown.
 * @example
 * isDay(hour.time, hour.isDay, forecast.daily);
 */
function isDay(time, isDayFlag, days) {
  if (typeof isDayFlag === 'boolean') {
    return isDayFlag;
  }
  const day = (days || []).find(
    (candidate) => candidate.time <= time && time < candidate.time + 24 * 3600,
  );
  if (day && day.sunrise !== null && day.sunset !== null) {
    return time >= day.sunrise && time < day.sunset;
  }
  return null;
}

export { FREEZING_CODES, WMO_CONDITIONS, isDay, skyCondition, toCondition };
