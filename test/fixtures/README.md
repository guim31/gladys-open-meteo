# Test fixtures

The tests never touch the network: every Open-Meteo answer comes from a file
here. What is real and what is not:

- `real-enschede-iso8601-kmh.json` — **real** Open-Meteo answers for Enschede
  (Netherlands), 2026-10-03, recorded by
  [python-open-meteo](https://github.com/frenck/python-open-meteo) (MIT, ©
  Franck Nijhof): its `forecast.json` (current conditions, 3 hours, 3 days)
  and `forecast_minutely_15.json` (4 quarters of an hour), merged and trimmed
  to the variables this integration requests. ISO local times and km/h, the
  API defaults, so they test the parser on the other formats. It contains
  every variable the integration requests, which checks the request against
  the names of the live API (`test/api.test.js`).
- `real-berlin-home-assistant.json` — **real** Open-Meteo answer for Berlin,
  November 2021, from the tests of the Home Assistant `open_meteo`
  integration (Apache-2.0): 168 hours, 7 days, no `is_day`, no probability,
  no 15-minute block. Home Assistant renamed its variables to the current
  names but not their `*_units` entries, so its wind speeds (km/h) read as m/s
  here: the tests use its times, temperatures and codes only.
- `synthetic-paris-rain-soon.json` — **synthetic**, shaped exactly like the
  integration's own request (UNIX times, m/s, 48 hours, 8 days, 12 quarters),
  for 2026-10-10T14:07Z: dry now, moderate rain from 14:30 UTC, fog later.
- `synthetic-oklahoma-city-thunderstorm.json` — **synthetic**, same shape and
  instant: a thunderstorm now, heavy rain, hot (the °F conversions),
  thunderstorms with hail later in the week.
- `synthetic-queenstown-snow.json` — **synthetic**, same shape and instant:
  southern hemisphere (New Zealand, UTC+13), 3 AM, snow showers, freezing fog,
  rime fog and freezing rain later in the week.
- `gladys-feature-table.json` — the category/type couples, poll frequencies
  and units of the Gladys core, for `test/gladys-rules.test.js`.

The coding session that wrote this integration could not reach
`api.open-meteo.com` (its network policy refused the host), hence the
synthetic files. To record a real answer, with exactly the request of the
integration (no key needed):

```bash
node scripts/capture-fixture.mjs 48.8566 2.3522 paris
```

Use the coordinates of a public place, never those of a home: the repository
is public.
