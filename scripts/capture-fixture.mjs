// -----------------------------------------------------------------------------
// Record a real Open-Meteo response as a test fixture: exactly the request the
// integration makes (src/api.js), one call, no key needed.
//
//   node scripts/capture-fixture.mjs <latitude> <longitude> <name> [model]
//   node scripts/capture-fixture.mjs 48.8566 2.3522 paris
//   node scripts/capture-fixture.mjs -33.8688 151.2093 sydney meteofrance_seamless
//
// Writes test/fixtures/real-<name>.json and prints the instant it was taken
// (the `now` a test should use with it). Use the coordinates of a public
// place, never those of a home: the repository is public.
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { fetchForecast } from '../src/api.js';

const [latitude, longitude, name, model = 'best_match'] = process.argv.slice(2);
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('Usage: node scripts/capture-fixture.mjs <latitude> <longitude> <name> [model]');
  process.exit(1);
}

const takenAt = new Date();
const data = await fetchForecast({
  latitude: Number(latitude),
  longitude: Number(longitude),
  model,
});
const file = new URL(`../test/fixtures/real-${name}.json`, import.meta.url);
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Saved ${file.pathname}, taken at ${takenAt.toISOString()} (${takenAt.getTime()} ms)`);
