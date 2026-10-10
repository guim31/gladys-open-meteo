// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  LANGUAGE_CHOICES,
  MODEL_CHOICES,
  REFRESH_INTERVAL_CHOICES,
} from '../src/config.js';
import { createApp } from '../src/app.js';
import { INTENSITIES, PRECIPITATION_TYPES } from '../src/nowcast.js';
import { SCENE_ACTIONS } from '../src/scene-actions.js';
import { SCENE_TRIGGERS } from '../src/scene-triggers.js';
import { WIDGETS } from '../src/widget.js';
import { createFakeGladys } from './helpers/fake-gladys.js';
import { silentLogger } from './helpers/fixtures.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// The handlers the code registers, read from a fake client.
const gladys = createFakeGladys();
createApp(gladys, { logger: silentLogger() });
const { handlers } = gladys.fake;

/**
 * @returns {Array<number>} The minimum version of `gladys_version`, e.g. [5, 1, 0].
 */
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

/**
 * @param {Array<number>} version - A version.
 * @param {Array<number>} required - The minimum.
 * @returns {boolean} Whether version >= required.
 */
function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('a weather provider for the cloud, reading the houses', () => {
  assert.equal(manifest.type, 'weather');
  assert.equal(manifest.name, 'Open-Meteo');
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.equal(manifest.location, true, 'getHouses() needs location: true');
  assert.deepEqual(manifest.categories, ['environment']);
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-open-meteo:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-open-meteo/main/cover.png',
  );
  assert.equal(typeof handlers.weatherGet, 'function');
  assert.equal(handlers.scanRequest, null, 'no device surface');
});

test('the capability fields and the weather type require Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.ok(declared.length > 0);
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
});

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), [...handlers.actions.keys()].sort());
});

test('every scene action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.values(SCENE_ACTIONS).sort());
  assert.deepEqual([...handlers.sceneActions.keys()].sort(), Object.values(SCENE_ACTIONS).sort());
});

test('every widget has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.values(WIDGETS).sort());
  assert.deepEqual([...handlers.widgetGet.keys()].sort(), Object.values(WIDGETS).sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
});

test('the trigger filter options are the values the code sends', () => {
  const trigger = manifest.scene_triggers.find(
    (entry) => entry.key === SCENE_TRIGGERS.PRECIPITATION_EXPECTED,
  );
  const options = (key) =>
    trigger.fields
      .find((field) => field.key === key)
      .options.map((option) => option.value)
      .sort();
  assert.deepEqual(options('precipitation_type'), Object.values(PRECIPITATION_TYPES).sort());
  assert.deepEqual(options('intensity'), Object.values(INTENSITIES).sort());
});

test('the trigger variables and the action outputs are the keys the code sends', () => {
  const trigger = manifest.scene_triggers[0];
  assert.deepEqual(keysOf(trigger.variables).sort(), [
    'house',
    'intensity',
    'minutes_until',
    'precipitation_type',
    'probability',
    'summary',
  ]);
  assert.deepEqual(keysOf(manifest.scene_actions[0].outputs).sort(), [
    'available',
    'intensity',
    'minutes_until',
    'precipitation_expected',
    'precipitation_type',
    'probability',
    'summary',
  ]);
});

test('config_schema keys and defaults stay consistent with DEFAULT_CONFIG', () => {
  const stored = manifest.config_schema.filter((field) => field.type !== 'section');
  assert.deepEqual(stored.map((field) => field.key).sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const field of stored) {
    assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    assert.equal(field.required, false, `${field.key}: every setting has a default`);
  }
  const options = (key) =>
    manifest.config_schema.find((field) => field.key === key).options.map((o) => o.value);
  assert.deepEqual(options('refresh_interval'), REFRESH_INTERVAL_CHOICES);
  assert.deepEqual(options('model'), MODEL_CHOICES);
  assert.deepEqual(options('language'), LANGUAGE_CHOICES);
});

test('no secret, and no field Gladys cannot render', () => {
  assert.ok(
    allFields.every((field) => field.type !== 'secret'),
    'Open-Meteo needs no key',
  );
  // `source: "houses"` is accepted by the core's master branch only (October
  // 2026): a 5.1.x core would reject the whole manifest. The house is a name.
  assert.ok(allFields.every((field) => field.source === undefined));
  // Number fields are rendered without `step`: none here.
  assert.ok(allFields.every((field) => field.type !== 'number'));
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the configuration credits Open-Meteo as its licence asks', () => {
  const intro = manifest.config_schema.find((field) => field.key === 'intro');
  for (const text of Object.values(intro.description)) {
    assert.ok(text.includes('Weather data by Open-Meteo.com'));
    assert.ok(text.includes('CC BY 4.0'));
  }
});

test('every text is a multi-language object with English and French', () => {
  const texts = [manifest.description];
  const visit = (node) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (['label', 'description', 'placeholder'].includes(key)) {
          texts.push(value);
        } else {
          visit(value);
        }
      }
    }
  };
  visit(manifest);
  for (const text of texts) {
    assert.equal(typeof text, 'object', JSON.stringify(text));
    assert.ok(text.en && text.fr, JSON.stringify(text));
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `${lang}: ${text.length} characters`);
  }
});

test('widget labels hold 3 to 30 characters, descriptions at most 100', () => {
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, text);
    }
    for (const text of Object.values(widget.description ?? {})) {
      assert.ok(text.length <= 100, text);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});
