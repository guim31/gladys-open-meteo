// -----------------------------------------------------------------------------
// Every text shown to the user exists in the four languages of the Gladys
// interface: English, French, German and Spanish. Gladys falls back to English
// on a missing language, so an omission would go unnoticed: these tests walk
// the whole manifest and every table of src/texts.js, without skipping any
// object, and render the built texts in every language.
//
// German says "du", never the polite "Sie" (decided by the maintainer for all
// his integrations); Spanish says "usted".
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ERROR_KINDS } from '../src/api.js';
import { connectionStatus, createApp } from '../src/app.js';
import { LANGUAGE_CHOICES } from '../src/config.js';
import { parseForecast } from '../src/forecast.js';
import { INTENSITIES, PRECIPITATION_TYPES } from '../src/nowcast.js';
import {
  INTENSITY_WORDS,
  LANGUAGES,
  LOCALES,
  MESSAGES,
  TEMPLATES,
  TYPE_NOUNS,
  localized,
  nowcastSentence,
} from '../src/texts.js';
import { buildWidgetContent } from '../src/widget.js';
import { createFakeGladys } from './helpers/fake-gladys.js';
import {
  HOUSES,
  SYNTHETIC_NOW,
  fakeFetch,
  fixtureForUrl,
  loadFixture,
  silentLogger,
} from './helpers/fixtures.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const EXPECTED_LANGUAGES = ['de', 'en', 'es', 'fr'];
const POLITE_GERMAN = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;
// A language key marks a multilingual object, whatever else it holds.
const LANGUAGE_KEY = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * @description The problems of one multilingual text object.
 * @param {object} texts - `{ en, fr, de, es }`.
 * @param {string} where - Its path, for the messages.
 * @param {number} maxLength - The longest text allowed.
 * @returns {Array<string>} The problems, empty when fine.
 */
function checkTexts(texts, where, maxLength) {
  const problems = [];
  const keys = Object.keys(texts).sort();
  if (keys.join() !== EXPECTED_LANGUAGES.join()) {
    problems.push(`${where}: languages [${keys}], expected [${EXPECTED_LANGUAGES}]`);
  }
  for (const [language, text] of Object.entries(texts)) {
    if (typeof text !== 'string' || text.trim() === '') {
      problems.push(`${where}.${language}: empty`);
    } else if (text.length > maxLength) {
      problems.push(`${where}.${language}: ${text.length} characters, ${maxLength} at most`);
    }
  }
  if (typeof texts.de === 'string' && POLITE_GERMAN.test(texts.de)) {
    problems.push(`${where}.de: polite "${texts.de.match(POLITE_GERMAN)[0]}", German says "du"`);
  }
  return problems;
}

// Length limits of the manifest texts, by key; the store and the core cut
// beyond them, and a long label breaks a form or a tile.
const MANIFEST_LIMITS = { label: 60, placeholder: 100, description: 400 };

/**
 * @description Walk a manifest and check every multilingual object it holds.
 * @param {object} root - The manifest.
 * @returns {{problems: Array<string>, count: number}} The problems and how
 * many objects were checked.
 */
function checkManifest(root) {
  const problems = [];
  let count = 0;
  const walk = (node, path, key) => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`, key));
      return;
    }
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (Object.keys(node).some((k) => LANGUAGE_KEY.test(k))) {
      count += 1;
      problems.push(...checkTexts(node, path, MANIFEST_LIMITS[key] ?? 400));
      return;
    }
    for (const [childKey, child] of Object.entries(node)) {
      const label = node.key ?? node.value;
      walk(child, `${path}${label ? `(${label})` : ''}.${childKey}`, childKey);
    }
  };
  walk(root, 'manifest', null);
  return { problems, count };
}

test('the guard catches a missing language, an empty text and a polite German', () => {
  const broken = structuredClone(manifest);
  delete broken.config_schema[1].label.de;
  broken.widgets[0].label.es = ' ';
  broken.scene_actions[0].description.de = 'Liest die Vorhersage Ihres Zuhauses.';
  broken.actions[0].label.it = 'Prova';
  const { problems } = checkManifest(broken);
  assert.equal(problems.length, 4, problems.join('\n'));
  assert.match(problems.join('\n'), /refresh_interval\)\.label: languages \[en,es,fr\]/);
  assert.match(problems.join('\n'), /\.es: empty/);
  assert.match(problems.join('\n'), /polite "Ihres"/);
  assert.match(problems.join('\n'), /languages \[de,en,es,fr,it\]/);
});

test('every multilingual object of the manifest has en, fr, de and es', () => {
  const { problems, count } = checkManifest(manifest);
  assert.deepEqual(problems, []);
  // Guards the walker itself: it must reach the whole manifest.
  assert.ok(count >= 66, `only ${count} multilingual objects found`);
});

test('the catalog description and the widget labels fit the store limits', () => {
  for (const text of Object.values(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, text);
  }
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, text);
    }
  }
});

test('the language setting offers the four languages', () => {
  const field = manifest.config_schema.find((entry) => entry.key === 'language');
  assert.deepEqual(
    field.options.map((option) => option.value),
    LANGUAGE_CHOICES,
  );
  assert.deepEqual(['auto', ...Object.values(LANGUAGES)], LANGUAGE_CHOICES);
});

test('every table of the code has en, fr, de and es', () => {
  const problems = [];
  for (const [name, table] of Object.entries({ MESSAGES, TYPE_NOUNS, INTENSITY_WORDS })) {
    for (const [key, texts] of Object.entries(table)) {
      problems.push(...checkTexts(texts, `${name}.${key}`, 200));
    }
  }
  assert.deepEqual(Object.keys(TYPE_NOUNS).sort(), Object.values(PRECIPITATION_TYPES).sort());
  assert.deepEqual(Object.keys(INTENSITY_WORDS).sort(), Object.values(INTENSITIES).sort());
  problems.push(...checkTexts(LOCALES, 'LOCALES', 10));
  for (const [key, templates] of Object.entries(TEMPLATES)) {
    const keys = Object.keys(templates).sort();
    if (keys.join() !== EXPECTED_LANGUAGES.join()) {
      problems.push(`TEMPLATES.${key}: languages [${keys}]`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the sentences read in every language, whatever the nowcast', () => {
  const problems = [];
  const cases = [{ available: false }, { available: true, minutesUntil: null }];
  for (const type of Object.values(PRECIPITATION_TYPES)) {
    for (const intensity of Object.values(INTENSITIES)) {
      for (const minutesUntil of [0, 1, 45]) {
        for (const probability of [null, 100]) {
          cases.push({ available: true, type, intensity, minutesUntil, probability });
        }
      }
    }
  }
  for (const [index, nowcast] of cases.entries()) {
    const texts = Object.fromEntries(
      Object.values(LANGUAGES).map((language) => [language, nowcastSentence(nowcast, language)]),
    );
    problems.push(...checkTexts(texts, `sentence ${index}`, 120));
  }
  assert.deepEqual(problems, []);
});

test('the texts built by the templates have the four languages', () => {
  const problems = [
    ...checkTexts(localized('forecastUnavailable', 'timeout'), 'forecastUnavailable', 300),
    ...checkTexts(
      localized('testSucceeded', {
        us: 66,
        metric: 18.9,
        house: 'Maison',
        where: ' (43 m)',
        model: 'icon_seamless',
        minutes: 15,
      }),
      'testSucceeded',
      200,
    ),
  ];
  const summaries = [
    { houses: 0, refreshed: 0, error: null },
    ...Object.values(ERROR_KINDS).map((kind) => ({ houses: 1, refreshed: 0, error: { kind } })),
  ];
  for (const summary of summaries) {
    const { message } = connectionStatus(summary);
    problems.push(...checkTexts(message, `status ${JSON.stringify(summary)}`, 200));
  }
  assert.deepEqual(problems, []);
});

test('the test action answers in the four languages', async () => {
  const gladys = createFakeGladys({ houses: [HOUSES.paris] });
  createApp(gladys, {
    fetchImpl: fakeFetch((url) => ({ body: fixtureForUrl(url) })),
    logger: silentLogger(),
    now: () => SYNTHETIC_NOW,
    // No real timer: the test must not keep the process alive.
    setTimer: () => ({}),
    clearTimer: () => {},
  });
  const answer = await gladys.fake.action('test_connection');
  assert.deepEqual(checkTexts(answer, 'test_connection', 200), []);
  assert.match(answer.de, /^Es funktioniert: gerade .* °C in Maison/);
  assert.match(answer.es, /^Funciona: .* °C ahora en Maison/);
});

test('the widget is valid and translated in every language', () => {
  const entry = {
    forecast: parseForecast(loadFixture('synthetic-paris-rain-soon.json')),
    fetchedAt: SYNTHETIC_NOW,
  };
  const labels = {};
  for (const language of Object.values(LANGUAGES)) {
    const content = buildWidgetContent({
      house: HOUSES.paris,
      entry,
      units: 'metric',
      language,
      now: SYNTHETIC_NOW,
    });
    assert.deepEqual(validateWidgetContent(content), [], language);
    const [, chart, status] = content.components;
    labels[language] = [chart.title, chart.series[0].name, ...status.items.map((i) => i.label)];
  }
  assert.deepEqual(labels.de, [
    'Niederschlag, nächste 2 Stunden',
    'Intensität',
    'Zuhause',
    'Vorhersage von',
  ]);
  assert.deepEqual(labels.es, [
    'Precipitación, próximas 2 horas',
    'Intensidad',
    'Vivienda',
    'Previsión de',
  ]);
});
