// -----------------------------------------------------------------------------
// Fixture loading and a fake fetch answering like the Open-Meteo API.
// See test/fixtures/README.md for where each fixture comes from.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

// The instant the synthetic fixtures were generated for:
// 2026-10-10T14:07:00Z — 4:07 PM in Paris, 9:07 AM in Oklahoma City, 3:07 AM
// in Queenstown.
const SYNTHETIC_NOW = Date.UTC(2026, 9, 10, 14, 7);
// The real Enschede response: its current conditions are of 12:30 local
// (UTC+2) on 2026-10-03.
const ENSCHEDE_NOW = Date.UTC(2026, 9, 3, 10, 35);
// The real Berlin response: its current conditions are of 23:00 local (UTC+1)
// on 2021-11-24.
const BERLIN_NOW = Date.UTC(2021, 10, 24, 22, 5);

const HOUSES = Object.freeze({
  paris: {
    id: 'h-paris',
    name: 'Maison',
    selector: 'maison',
    latitude: 48.8566,
    longitude: 2.3522,
  },
  okc: { id: 'h-okc', name: 'Home', selector: 'home', latitude: 35.4676, longitude: -97.5164 },
  queenstown: {
    id: 'h-qt',
    name: 'Chalet',
    selector: 'chalet',
    latitude: -45.0312,
    longitude: 168.6626,
  },
});

/**
 * @description Load a fixture (a fresh copy on every call).
 * @param {string} name - The file name in test/fixtures.
 * @returns {object} The parsed JSON.
 * @example
 * loadFixture('synthetic-paris-rain-soon.json');
 */
function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

/**
 * @description A fake fetch. `route(url)` returns `{ status, body }` (or
 * throws to simulate a network error); every call is recorded.
 * @param {Function} route - The router.
 * @returns {Function} The fetch, with `.calls` (the requested URLs).
 * @example
 * const fetchImpl = fakeFetch(() => ({ body: loadFixture('...') }));
 */
function fakeFetch(route) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const { status = 200, body = {} } = await route(String(url));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/**
 * @description The fixture of a request URL, by its coordinates.
 * @param {string} url - The request URL.
 * @returns {object} The fixture body.
 * @example
 * fixtureForUrl('https://api.open-meteo.com/v1/forecast?latitude=48.8566&longitude=2.3522');
 */
function fixtureForUrl(url) {
  const params = new URL(url).searchParams;
  const location = `${params.get('latitude')},${params.get('longitude')}`;
  switch (location) {
    case '48.8566,2.3522':
      return loadFixture('synthetic-paris-rain-soon.json');
    case '35.4676,-97.5164':
      return loadFixture('synthetic-oklahoma-city-thunderstorm.json');
    case '-45.0312,168.6626':
      return loadFixture('synthetic-queenstown-snow.json');
    default:
      throw new Error(`No fixture for ${location}`);
  }
}

/**
 * @description A logger that records nothing.
 * @returns {object} The logger.
 * @example
 * createApp(gladys, { logger: silentLogger() });
 */
function silentLogger() {
  return { info() {}, warn() {}, debug() {}, error() {} };
}

export {
  BERLIN_NOW,
  ENSCHEDE_NOW,
  HOUSES,
  SYNTHETIC_NOW,
  fakeFetch,
  fixtureForUrl,
  loadFixture,
  silentLogger,
};
