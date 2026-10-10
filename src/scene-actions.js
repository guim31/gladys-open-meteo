// -----------------------------------------------------------------------------
// Scene action "Get the precipitation of the next hour".
//
// A read-only action: a scene asks "will it rain (or snow) within the hour?"
// and gates on the answer — close the awning, skip the sprinkler, warn before
// leaving. It reads the forecast the scheduler keeps in memory, so it costs no
// call (a call is made only when the house has no recent forecast).
//
// Outputs are scalars the following actions of the scene can read. A value
// that does not apply (no precipitation: no `minutes_until`) is left out
// rather than sent as a fake number.
// -----------------------------------------------------------------------------

import { readNowcast } from './nowcast.js';
import { nowcastSentence } from './texts.js';

const SCENE_ACTIONS = Object.freeze({
  GET_PRECIPITATION_NEXT_HOUR: 'get_precipitation_next_hour',
});

/**
 * @description Build the outputs of the action.
 * @param {object} nowcast - A readNowcast() result.
 * @param {string} language - 'en' or 'fr', for the summary.
 * @returns {object} `{ available, precipitation_expected, minutes_until?,
 * precipitation_type?, intensity?, probability?, summary }`.
 * @example
 * buildPrecipitationOutputs(nowcast, 'en');
 */
function buildPrecipitationOutputs(nowcast, language) {
  const outputs = {
    available: nowcast.available,
    precipitation_expected: nowcast.available && nowcast.minutesUntil !== null,
    summary: nowcastSentence(nowcast, language),
  };
  if (outputs.precipitation_expected) {
    outputs.minutes_until = nowcast.minutesUntil;
    outputs.precipitation_type = nowcast.type;
    outputs.intensity = nowcast.intensity;
    if (nowcast.probability !== null) {
      outputs.probability = nowcast.probability;
    }
  }
  return outputs;
}

/**
 * @description Run the action on a forecast.
 * @param {object} forecast - The slim forecast of the house.
 * @param {string} language - 'en' or 'fr'.
 * @param {number} [now] - The current time in ms.
 * @returns {object} The outputs.
 * @example
 * precipitationNextHour(entry.forecast, 'fr');
 */
function precipitationNextHour(forecast, language, now = Date.now()) {
  return buildPrecipitationOutputs(readNowcast(forecast, Math.floor(now / 1000)), language);
}

export { SCENE_ACTIONS, buildPrecipitationOutputs, precipitationNextHour };
