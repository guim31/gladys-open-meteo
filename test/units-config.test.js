import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, refreshMinutes } from '../src/config.js';
import { fromMetric, intensityUnit, round, toMetric } from '../src/units.js';
import { LANGUAGES, nowcastSentence, precipitationLabel, resolveLanguage } from '../src/texts.js';

test('metric to us units', () => {
  const us = fromMetric('us');
  assert.equal(us.temperature(100), 212);
  assert.equal(us.temperature(-40), -40);
  assert.equal(us.speed(10), 22.4);
  assert.equal(us.precipitation(25.4), 1);
  assert.equal(us.intensity(2.54), 0.1);
  assert.equal(us.visibility(16.09344), 10);
  assert.equal(us.pressure(1013.25), 1013);
  assert.equal(us.temperature(null), null);
  assert.equal(us.speed(Number.NaN), null);
  const metric = fromMetric('metric');
  assert.equal(metric.temperature(12.345), 12.3);
  assert.equal(metric.precipitation(0.04), 0);
  assert.equal(intensityUnit('us'), 'in/h');
  assert.equal(intensityUnit('metric'), 'mm/h');
});

test('the units of a response to metric', () => {
  assert.equal(toMetric('°F')(212), 100);
  assert.equal(toMetric('km/h')(36), 10);
  assert.ok(Math.abs(toMetric('mp/h')(10) - 4.4704) < 1e-9);
  assert.ok(Math.abs(toMetric('kn')(1) - 0.5144444) < 1e-6);
  assert.equal(toMetric('inch')(1), 25.4);
  assert.equal(toMetric('m/s')(3), 3);
  assert.equal(toMetric(undefined)(3), 3);
  assert.equal(round(-0.01, 1), 0);
});

test('the configuration falls back to the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ refresh_interval: 30, model: ' icon_seamless ' }), {
    refresh_interval: '30',
    model: 'icon_seamless',
    language: 'auto',
  });
  assert.deepEqual(normalizeConfig({ refresh_interval: '5', model: 'arome', language: 'de' }), {
    ...DEFAULT_CONFIG,
  });
  assert.equal(refreshMinutes(normalizeConfig({ refresh_interval: '60' })), 60);
});

test('texts: language, labels and sentences', () => {
  assert.equal(resolveLanguage('auto', 'fr-FR'), LANGUAGES.FR);
  assert.equal(resolveLanguage('auto', null), LANGUAGES.EN);
  assert.equal(resolveLanguage('en', 'fr'), LANGUAGES.EN);
  assert.equal(precipitationLabel('snow', 'heavy', 'fr'), 'Neige forte');
  assert.equal(precipitationLabel('freezing_rain', 'light', 'en'), 'Light freezing rain');
  const nowcast = {
    available: true,
    minutesUntil: 23,
    type: 'rain',
    intensity: 'moderate',
    probability: 85,
  };
  assert.equal(
    nowcastSentence(nowcast, 'en'),
    'Moderate rain expected in 23 minutes (85% chance).',
  );
  assert.equal(
    nowcastSentence(nowcast, 'fr'),
    'Pluie modérée attendue dans 23 minutes (probabilité 85 %).',
  );
  assert.equal(
    nowcastSentence({ ...nowcast, minutesUntil: 0, probability: null }, 'en'),
    'Moderate rain now.',
  );
  assert.equal(
    nowcastSentence({ ...nowcast, minutesUntil: 1, probability: null }, 'fr'),
    'Pluie modérée attendue dans 1 minute.',
  );
  assert.equal(
    nowcastSentence({ available: true, minutesUntil: null }, 'fr'),
    'Pas de précipitations prévues dans l’heure.',
  );
  assert.equal(
    nowcastSentence({ available: false }, 'en'),
    'No 15-minute forecast for this location.',
  );
});
