// -----------------------------------------------------------------------------
// Texts the integration writes itself, in English, French, German and Spanish
// (the languages of the Gladys interface).
//
// The core gives the language of the user in a weather request and in a
// widget request, but a scene trigger or a scene action receives none: those
// texts follow the `language` setting, whose default ('auto') is the language
// of the last request of the core.
//
// Every table below holds exactly one entry per language: test/i18n.test.js
// walks them all. German says "du", Spanish says "usted".
// -----------------------------------------------------------------------------

const LANGUAGES = Object.freeze({ EN: 'en', FR: 'fr', DE: 'de', ES: 'es' });

// Every noun is feminine in French and Spanish and masculine in German, so the
// intensity words below are already agreed with all of them.
const TYPE_NOUNS = Object.freeze({
  rain: { en: 'rain', fr: 'pluie', de: 'Regen', es: 'lluvia' },
  snow: { en: 'snow', fr: 'neige', de: 'Schneefall', es: 'nieve' },
  freezing_rain: {
    en: 'freezing rain',
    fr: 'pluie verglaçante',
    de: 'gefrierender Regen',
    es: 'lluvia engelante',
  },
});

const INTENSITY_WORDS = Object.freeze({
  light: { en: 'Light', fr: 'faible', de: 'Leichter', es: 'débil' },
  moderate: { en: 'Moderate', fr: 'modérée', de: 'Mäßiger', es: 'moderada' },
  heavy: { en: 'Heavy', fr: 'forte', de: 'Starker', es: 'fuerte' },
});

// Fixed texts, sent as a whole to Gladys (statuses) or picked by language.
const MESSAGES = Object.freeze({
  noNowcast: {
    en: 'No 15-minute forecast for this location.',
    fr: 'Pas de prévision au quart d’heure pour ce lieu.',
    de: 'Keine 15-Minuten-Vorhersage für diesen Ort.',
    es: 'No hay previsión cada 15 minutos para esta ubicación.',
  },
  noPrecipitation: {
    en: 'No precipitation expected within the hour.',
    fr: 'Pas de précipitations prévues dans l’heure.',
    de: 'Kein Niederschlag in der nächsten Stunde erwartet.',
    es: 'No se esperan precipitaciones en la próxima hora.',
  },
  noLocation: {
    en: 'No house of Gladys has a location: set it in Settings → Houses.',
    fr: 'Aucune maison de Gladys n’a de position : renseignez-la dans Paramètres → Maisons.',
    de: 'Kein Zuhause in Gladys hat einen Standort: Lege ihn unter Einstellungen → Zuhause fest.',
    es: 'Ninguna vivienda de Gladys tiene ubicación: indíquela en Configuración → Viviendas.',
  },
  limitReached: {
    en: 'Open-Meteo request limit reached (it is shared by every application on your Internet connection): retrying later.',
    fr: 'Limite de requêtes Open-Meteo atteinte (partagée par toutes les applications de votre connexion Internet) : nouvel essai plus tard.',
    de: 'Anfragelimit von Open-Meteo erreicht (es gilt für alle Anwendungen deiner Internetverbindung): neuer Versuch später.',
    es: 'Límite de solicitudes de Open-Meteo alcanzado (lo comparten todas las aplicaciones de su conexión a Internet): se reintentará más tarde.',
  },
  noForecastForModel: {
    en: 'Open-Meteo has no forecast for your house with this weather model: choose “Automatic” in the configuration.',
    fr: 'Open-Meteo n’a pas de prévision pour votre maison avec ce modèle météo : choisissez « Automatique » dans la configuration.',
    de: 'Open-Meteo hat mit diesem Wettermodell keine Vorhersage für dein Zuhause: Wähle „Automatisch“ in der Konfiguration.',
    es: 'Open-Meteo no tiene previsión para su vivienda con este modelo meteorológico: elija «Automático» en la configuración.',
  },
  unreachable: {
    en: 'Open-Meteo is unreachable for now: retrying in a few minutes.',
    fr: 'Open-Meteo est injoignable pour le moment : nouvel essai dans quelques minutes.',
    de: 'Open-Meteo ist im Moment nicht erreichbar: neuer Versuch in ein paar Minuten.',
    es: 'Open-Meteo no está disponible por ahora: se reintentará en unos minutos.',
  },
  // Widget: short labels, the tile is narrow.
  chartTitle: {
    en: 'Precipitation, next 2 hours',
    fr: 'Précipitations, 2 prochaines heures',
    de: 'Niederschlag, nächste 2 Stunden',
    es: 'Precipitación, próximas 2 horas',
  },
  chartSeries: { en: 'Intensity', fr: 'Intensité', de: 'Intensität', es: 'Intensidad' },
  house: { en: 'House', fr: 'Maison', de: 'Zuhause', es: 'Vivienda' },
  forecastFrom: {
    en: 'Forecast from',
    fr: 'Prévision de',
    de: 'Vorhersage von',
    es: 'Previsión de',
  },
});

const plural = (count, one, many) => (count > 1 ? many : one);

// Texts built from values, one function per language.
const TEMPLATES = Object.freeze({
  label: {
    en: (noun, intensity) => `${intensity} ${noun}`,
    fr: (noun, intensity) => `${noun} ${intensity}`,
    de: (noun, intensity) => `${intensity} ${noun}`,
    es: (noun, intensity) => `${noun} ${intensity}`,
  },
  chance: {
    en: (probability) => ` (${probability}% chance)`,
    fr: (probability) => ` (probabilité ${probability} %)`,
    de: (probability) => ` (Wahrscheinlichkeit ${probability} %)`,
    es: (probability) => ` (probabilidad del ${probability} %)`,
  },
  now: {
    en: (label, chance) => `${label} now${chance}.`,
    fr: (label, chance) => `${label} en ce moment${chance}.`,
    de: (label, chance) => `${label} im Moment${chance}.`,
    es: (label, chance) => `${label} en este momento${chance}.`,
  },
  expected: {
    en: (label, minutes, chance) =>
      `${label} expected in ${minutes} ${plural(minutes, 'minute', 'minutes')}${chance}.`,
    fr: (label, minutes, chance) =>
      `${label} attendue dans ${minutes} ${plural(minutes, 'minute', 'minutes')}${chance}.`,
    de: (label, minutes, chance) =>
      `${label} in ${minutes} ${plural(minutes, 'Minute', 'Minuten')} erwartet${chance}.`,
    es: (label, minutes, chance) =>
      `${label} prevista dentro de ${minutes} ${plural(minutes, 'minuto', 'minutos')}${chance}.`,
  },
  forecastUnavailable: {
    en: (reason) => `Forecast unavailable: ${reason}`,
    fr: (reason) => `Prévision indisponible : ${reason}`,
    de: (reason) => `Vorhersage nicht verfügbar: ${reason}`,
    es: (reason) => `Previsión no disponible: ${reason}`,
  },
  // Fahrenheit for the English text only: the others are metric countries.
  testSucceeded: {
    en: ({ us, metric, house, where, model, minutes }) =>
      `It works: ${us} °F (${metric} °C) now at ${house}${where}${model ? `, model ${model}` : ''}. Refreshing every ${minutes} min.`,
    fr: ({ metric, house, where, model, minutes }) =>
      `Ça fonctionne : ${metric} °C en ce moment à ${house}${where}${model ? `, modèle ${model}` : ''}. Mise à jour toutes les ${minutes} min.`,
    de: ({ metric, house, where, model, minutes }) =>
      `Es funktioniert: gerade ${metric} °C in ${house}${where}${model ? `, Modell ${model}` : ''}. Aktualisierung alle ${minutes} Min.`,
    es: ({ metric, house, where, model, minutes }) =>
      `Funciona: ${metric} °C ahora en ${house}${where}${model ? `, modelo ${model}` : ''}. Actualización cada ${minutes} min.`,
  },
});

// Locales of the times shown in the widget.
const LOCALES = Object.freeze({ en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' });

/**
 * @description Pick the language of a text: the setting, or with 'auto' the
 * language of the last request of the core. An unknown language is English.
 * @param {string} setting - The `language` setting ('auto', 'en', 'fr', 'de', 'es').
 * @param {string|null} [lastSeen] - The language of the last core request.
 * @returns {string} 'en', 'fr', 'de' or 'es'.
 * @example
 * resolveLanguage('auto', 'fr-FR'); // -> 'fr'
 */
function resolveLanguage(setting, lastSeen = null) {
  const wanted = setting === 'auto' ? lastSeen : setting;
  if (typeof wanted !== 'string') {
    return LANGUAGES.EN;
  }
  const prefix = wanted.toLowerCase().slice(0, 2);
  return Object.values(LANGUAGES).includes(prefix) ? prefix : LANGUAGES.EN;
}

/**
 * @description A fixed text in a language, English when the language is unknown.
 * @param {string} key - A MESSAGES key.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The text.
 * @example
 * message('house', 'de'); // -> 'Zuhause'
 */
function message(key, language) {
  return MESSAGES[key][language] ?? MESSAGES[key].en;
}

/**
 * @description The function of a template in a language, English when unknown.
 * @param {string} key - A TEMPLATES key.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {Function} The template.
 * @example
 * template('forecastUnavailable', 'es')('timeout');
 */
function template(key, language) {
  return TEMPLATES[key][language] ?? TEMPLATES[key].en;
}

/**
 * @description A template filled in every language, for the texts Gladys
 * localizes itself (action results).
 * @param {string} key - A TEMPLATES key.
 * @param {...*} args - The values of the template.
 * @returns {object} `{ en, fr, de, es }`.
 * @example
 * localized('forecastUnavailable', 'timeout');
 */
function localized(key, ...args) {
  return Object.fromEntries(
    Object.values(LANGUAGES).map((language) => [language, TEMPLATES[key][language](...args)]),
  );
}

/**
 * @description Name a precipitation: "Light rain", "Neige forte".
 * @param {string} type - A PRECIPITATION_TYPES value.
 * @param {string} intensity - An INTENSITIES value.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The capitalized name.
 * @example
 * precipitationLabel('snow', 'heavy', 'fr'); // -> 'Neige forte'
 */
function precipitationLabel(type, intensity, language) {
  const lang = Object.values(LANGUAGES).includes(language) ? language : LANGUAGES.EN;
  const noun = (TYPE_NOUNS[type] ?? TYPE_NOUNS.rain)[lang];
  const words = (INTENSITY_WORDS[intensity] ?? INTENSITY_WORDS.light)[lang];
  const label = template('label', lang)(noun, words);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * @description The sentence of a nowcast, ready to put in a message.
 * @param {object} nowcast - A readNowcast() result.
 * @param {string} language - 'en', 'fr', 'de' or 'es'.
 * @returns {string} The sentence.
 * @example
 * nowcastSentence(nowcast, 'en'); // -> 'Light rain expected in 15 minutes (60% chance).'
 */
function nowcastSentence(nowcast, language) {
  if (!nowcast.available) {
    return message('noNowcast', language);
  }
  if (nowcast.minutesUntil === null) {
    return message('noPrecipitation', language);
  }
  const label = precipitationLabel(nowcast.type, nowcast.intensity, language);
  const chance =
    nowcast.probability === null ? '' : template('chance', language)(nowcast.probability);
  if (nowcast.minutesUntil === 0) {
    return template('now', language)(label, chance);
  }
  return template('expected', language)(label, nowcast.minutesUntil, chance);
}

export {
  INTENSITY_WORDS,
  LANGUAGES,
  LOCALES,
  MESSAGES,
  TEMPLATES,
  TYPE_NOUNS,
  localized,
  message,
  nowcastSentence,
  precipitationLabel,
  resolveLanguage,
  template,
};
