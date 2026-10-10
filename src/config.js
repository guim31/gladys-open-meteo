// -----------------------------------------------------------------------------
// Configuration of the integration.
//
// DEFAULT_CONFIG mirrors the `default` values of the manifest `config_schema`
// (test/manifest.test.js keeps both sides in sync). The supervisor sends the
// values as the form stored them: normalizeConfig() validates them and falls
// back to the defaults, so the rest of the code never sees a malformed value.
// -----------------------------------------------------------------------------

// Refresh interval choices of the manifest `refresh_interval` select, in
// minutes. Open-Meteo updates its models hourly at best, its 15-minute data
// included: refreshing faster would spend calls for the same numbers.
const REFRESH_INTERVAL_CHOICES = ['15', '30', '60'];

// Weather models of the manifest `model` select, by their Open-Meteo name.
// `best_match` lets Open-Meteo combine the best models for the location (the
// national high-resolution model where there is one, global ones elsewhere).
// The `_seamless` names blend a model's regional and global runs, so they
// cover the whole world; `meteoswiss_icon_seamless` and `metno_seamless` fall
// back to a global model outside their region.
const MODEL_CHOICES = [
  'best_match',
  'meteofrance_seamless',
  'icon_seamless',
  'gfs_seamless',
  'ecmwf_ifs025',
  'ukmo_seamless',
  'gem_seamless',
  'metno_seamless',
  'meteoswiss_icon_seamless',
];

// Language of the texts the integration writes itself (scene variables, the
// widget when the core sends no language). 'auto' follows the language of
// the last weather request of the core.
const LANGUAGE_CHOICES = ['auto', 'en', 'fr'];

const DEFAULT_CONFIG = Object.freeze({
  refresh_interval: '15',
  model: 'best_match',
  language: 'auto',
});

/**
 * @description Normalize the raw configuration sent by Gladys.
 * @param {object} [raw] - The configuration values, as stored by the form.
 * @returns {{refresh_interval: string, model: string, language: string}} The
 * normalized configuration.
 * @example
 * normalizeConfig({ refresh_interval: 30, model: 'icon_seamless' });
 */
function normalizeConfig(raw = {}) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const pick = (key, choices) => {
    const value = String(source[key] ?? DEFAULT_CONFIG[key]).trim();
    return choices.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  return {
    refresh_interval: pick('refresh_interval', REFRESH_INTERVAL_CHOICES),
    model: pick('model', MODEL_CHOICES),
    language: pick('language', LANGUAGE_CHOICES),
  };
}

/**
 * @description The refresh interval chosen by the user, in minutes.
 * @param {object} config - The normalized configuration.
 * @returns {number} The interval.
 * @example
 * refreshMinutes({ refresh_interval: '30' }); // -> 30
 */
function refreshMinutes(config) {
  return Number(config.refresh_interval);
}

export {
  DEFAULT_CONFIG,
  LANGUAGE_CHOICES,
  MODEL_CHOICES,
  REFRESH_INTERVAL_CHOICES,
  normalizeConfig,
  refreshMinutes,
};
