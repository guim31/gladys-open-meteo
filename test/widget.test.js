import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { parseForecast } from '../src/forecast.js';
import { buildUnavailableContent, buildWidgetContent, formatTime } from '../src/widget.js';
import { HOUSES, SYNTHETIC_NOW, loadFixture } from './helpers/fixtures.js';

const entry = () => ({
  forecast: parseForecast(loadFixture('synthetic-paris-rain-soon.json')),
  fetchedAt: SYNTHETIC_NOW,
});

test('the content: a sentence, the 2-hour chart, the house and the time', () => {
  const content = buildWidgetContent({
    house: HOUSES.paris,
    entry: entry(),
    units: 'metric',
    language: 'fr',
    now: SYNTHETIC_NOW,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const [text, chart, status] = content.components;
  assert.equal(text.text, 'Pluie modérée attendue dans 23 minutes (probabilité 85 %).');
  assert.equal(chart.type, 'chart');
  assert.equal(chart.unit, 'mm/h');
  assert.equal(chart.series[0].points.length, 8);
  assert.deepEqual(chart.series[0].points[2], { t: '2026-10-10T14:30:00.000Z', v: 2.4 });
  assert.deepEqual(
    status.items.map((item) => item.value),
    ['Maison', '16:07'],
  );
});

test('us units draw in/h; an unavailable hour draws no chart', () => {
  const us = buildWidgetContent({
    house: HOUSES.paris,
    entry: entry(),
    units: 'us',
    language: 'en',
    now: SYNTHETIC_NOW,
  });
  assert.equal(us.components[1].unit, 'in/h');
  assert.equal(us.components[1].series[0].points[3].v, 0.142);
  const late = buildWidgetContent({
    house: { ...HOUSES.paris, name: 'A'.repeat(60) },
    entry: entry(),
    units: 'metric',
    language: 'en',
    now: SYNTHETIC_NOW + 4 * 3600000,
  });
  assert.deepEqual(validateWidgetContent(late), []);
  assert.deepEqual(
    late.components.map((component) => component.type),
    ['text', 'status'],
  );
  assert.equal(late.components[1].items[0].value.length, 40);
});

test('the unavailable content is valid', () => {
  assert.deepEqual(validateWidgetContent(buildUnavailableContent('x'.repeat(400))), []);
});

test('times follow the time zone of the location', () => {
  assert.equal(formatTime(SYNTHETIC_NOW, 'Europe/Paris', 'fr'), '16:07');
  assert.equal(formatTime(SYNTHETIC_NOW, 'America/Chicago', 'en'), '9:07 AM');
  assert.equal(typeof formatTime(SYNTHETIC_NOW, 'Not/AZone', 'en'), 'string');
});
