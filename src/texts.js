// -----------------------------------------------------------------------------
// Texts the integration writes itself, in English and French.
//
// The core gives the language of the user in a weather request and in a
// widget request, but a scene trigger or a scene action receives none: those
// texts follow the `language` setting, whose default ('auto') is the language
// of the last request of the core.
// -----------------------------------------------------------------------------

const LANGUAGES = Object.freeze({ EN: 'en', FR: 'fr' });

// French adjectives agree with the noun.
const TYPE_NOUNS = Object.freeze({
  rain: { en: 'rain', fr: 'pluie', feminine: true },
  snow: { en: 'snow', fr: 'neige', feminine: true },
  freezing_rain: { en: 'freezing rain', fr: 'pluie verglaçante', feminine: true },
});

const INTENSITY_WORDS = Object.freeze({
  light: { en: 'Light', fr: ['faible', 'faible'] },
  moderate: { en: 'Moderate', fr: ['modéré', 'modérée'] },
  heavy: { en: 'Heavy', fr: ['fort', 'forte'] },
});

/**
 * @description Pick the language of a text: the setting, or with 'auto' the
 * language of the last request of the core. Anything but French is English.
 * @param {string} setting - The `language` setting ('auto', 'en', 'fr').
 * @param {string|null} [lastSeen] - The language of the last core request.
 * @returns {string} 'en' or 'fr'.
 * @example
 * resolveLanguage('auto', 'fr-FR'); // -> 'fr'
 */
function resolveLanguage(setting, lastSeen = null) {
  const wanted = setting === 'auto' ? lastSeen : setting;
  return typeof wanted === 'string' && wanted.toLowerCase().startsWith('fr')
    ? LANGUAGES.FR
    : LANGUAGES.EN;
}

/**
 * @description Name a precipitation: "Light rain", "Neige forte".
 * @param {string} type - A PRECIPITATION_TYPES value.
 * @param {string} intensity - An INTENSITIES value.
 * @param {string} language - 'en' or 'fr'.
 * @returns {string} The capitalized name.
 * @example
 * precipitationLabel('snow', 'heavy', 'fr'); // -> 'Neige forte'
 */
function precipitationLabel(type, intensity, language) {
  const noun = TYPE_NOUNS[type] ?? TYPE_NOUNS.rain;
  const words = INTENSITY_WORDS[intensity] ?? INTENSITY_WORDS.light;
  if (language === LANGUAGES.FR) {
    const label = `${noun.fr} ${words.fr[noun.feminine ? 1 : 0]}`;
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return `${words.en} ${noun.en}`;
}

/**
 * @description The sentence of a nowcast, ready to put in a message.
 * @param {object} nowcast - A readNowcast() result.
 * @param {string} language - 'en' or 'fr'.
 * @returns {string} The sentence.
 * @example
 * nowcastSentence(nowcast, 'en'); // -> 'Light rain expected in 15 minutes (60% chance).'
 */
function nowcastSentence(nowcast, language) {
  const fr = language === LANGUAGES.FR;
  if (!nowcast.available) {
    return fr
      ? 'Pas de prévision au quart d’heure pour ce lieu.'
      : 'No 15-minute forecast for this location.';
  }
  if (nowcast.minutesUntil === null) {
    return fr
      ? 'Pas de précipitations prévues dans l’heure.'
      : 'No precipitation expected within the hour.';
  }
  const label = precipitationLabel(nowcast.type, nowcast.intensity, language);
  const chance =
    nowcast.probability === null
      ? ''
      : fr
        ? ` (probabilité ${nowcast.probability} %)`
        : ` (${nowcast.probability}% chance)`;
  if (nowcast.minutesUntil === 0) {
    return fr ? `${label} en ce moment${chance}.` : `${label} now${chance}.`;
  }
  const minutes = nowcast.minutesUntil;
  if (fr) {
    const expected = (TYPE_NOUNS[nowcast.type] ?? TYPE_NOUNS.rain).feminine
      ? 'attendue'
      : 'attendu';
    return `${label} ${expected} dans ${minutes} minute${minutes > 1 ? 's' : ''}${chance}.`;
  }
  return `${label} expected in ${minutes} minute${minutes > 1 ? 's' : ''}${chance}.`;
}

export { LANGUAGES, nowcastSentence, precipitationLabel, resolveLanguage };
