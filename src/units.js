// -----------------------------------------------------------------------------
// Unit conversions.
//
// The integration asks Open-Meteo for metric units and caches metric values
// (°C, m/s, mm, cm of snow, km). Each Gladys request names its unit system
// (`units`: 'metric' or 'us'), and the pivot format expects the values in it:
//
//   pivot       metric   us
//   ----------  -------  ------
//   temp        °C       °F
//   wind        m/s      mph
//   pressure    hPa      hPa
//   precip      mm       in
//   visibility  km       mi
//
// toMetricConverters() reads the `*_units` blocks of a response: the request
// says metric, but nothing is lost by trusting the response over the request
// (and the recorded fixtures of other projects use km/h).
// -----------------------------------------------------------------------------

const UNIT_SYSTEMS = Object.freeze({ METRIC: 'metric', US: 'us' });

const MPH_TO_MS = 0.44704;
const KMH_TO_MS = 1 / 3.6;
const KNOT_TO_MS = 1852 / 3600;
const MILE_TO_KM = 1.609344;
const INCH_TO_MM = 25.4;
const FOOT_TO_M = 0.3048;

/**
 * @description Fahrenheit to Celsius.
 * @param {number} value - °F.
 * @returns {number} °C.
 * @example
 * fahrenheitToCelsius(212); // -> 100
 */
function fahrenheitToCelsius(value) {
  return ((value - 32) * 5) / 9;
}

/**
 * @description The converter of one unit, as Open-Meteo names it, to metric.
 * @param {string|undefined} unit - The unit of a `*_units` block.
 * @returns {Function} value in that unit → metric value (identity when the
 * unit is already metric, unknown or absent).
 * @example
 * toMetric('mp/h')(10); // -> 4.4704
 */
function toMetric(unit) {
  switch (unit) {
    case '°F':
      return fahrenheitToCelsius;
    case 'km/h':
      return (value) => value * KMH_TO_MS;
    case 'mp/h':
    case 'mph':
      return (value) => value * MPH_TO_MS;
    case 'kn':
      return (value) => value * KNOT_TO_MS;
    case 'inch':
      // Precipitation in mm, snowfall in cm: the caller says which.
      return (value) => value * INCH_TO_MM;
    case 'ft':
      return (value) => value * FOOT_TO_M;
    default:
      return (value) => value;
  }
}

/**
 * @description Round to a number of decimals, keeping null as null.
 * @param {number|null} value - The value.
 * @param {number} decimals - The decimals.
 * @returns {number|null} The rounded value.
 * @example
 * round(1.2345, 1); // -> 1.2
 */
function round(value, decimals) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  // `+ 0` turns a -0 into 0: "-0 °C" reads as a bug.
  return Math.round(value * factor) / factor + 0;
}

/**
 * @description Build the converters from metric to the unit system of a
 * Gladys request, each one rounding to a sensible precision.
 * @param {string} units - 'metric' or 'us'.
 * @returns {object} `{ temperature, speed, pressure, precipitation,
 * intensity, visibility }`: metric value in, value of the requested system
 * out (null stays null).
 * @example
 * fromMetric('us').temperature(0); // -> 32
 */
function fromMetric(units) {
  const us = units === UNIT_SYSTEMS.US;
  const guard = (fn) => (value) =>
    value === null || value === undefined || !Number.isFinite(value) ? null : fn(value);
  return {
    // °C → °F
    temperature: guard((celsius) => round(us ? (celsius * 9) / 5 + 32 : celsius, 1)),
    // m/s → mph
    speed: guard((ms) => round(us ? ms / MPH_TO_MS : ms, 1)),
    // hPa in both systems (the pivot keeps hPa for `us` too)
    pressure: guard((hpa) => round(hpa, 0)),
    // mm → in (an amount of liquid water)
    precipitation: guard((mm) => (us ? round(mm / INCH_TO_MM, 2) : round(mm, 1))),
    // mm/h → in/h
    intensity: guard((mmh) => (us ? round(mmh / INCH_TO_MM, 3) : round(mmh, 1))),
    // km → mi
    visibility: guard((km) => round(us ? km / MILE_TO_KM : km, 1)),
  };
}

/**
 * @description The display unit of a precipitation intensity.
 * @param {string} units - 'metric' or 'us'.
 * @returns {string} 'mm/h' or 'in/h'.
 * @example
 * intensityUnit('us'); // -> 'in/h'
 */
function intensityUnit(units) {
  return units === UNIT_SYSTEMS.US ? 'in/h' : 'mm/h';
}

export {
  INCH_TO_MM,
  MILE_TO_KM,
  UNIT_SYSTEMS,
  fahrenheitToCelsius,
  fromMetric,
  intensityUnit,
  round,
  toMetric,
};
