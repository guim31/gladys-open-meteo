# Open-Meteo for Gladys Assistant

Weather provider for [Gladys Assistant](https://gladysassistant.com) backed by
[Open-Meteo](https://open-meteo.com/), the free and open weather API built on
the forecasts of the national weather services (Météo-France, DWD, NOAA,
ECMWF, Met Office, Environment Canada, MET Norway, MeteoSwiss…). **No account,
no API key.**

**Weather data by [Open-Meteo.com](https://open-meteo.com/)**, under the
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) licence. This
integration is a community project and is **not affiliated with Open-Meteo**.

## What it does

- **Feeds the Gladys weather widget and chat assistant** (manifest
  `type: "weather"`): current conditions, the next 24 hours, the next 8 days,
  feels-like temperature, wind and gusts, UV index, sunrise and sunset,
  precipitation and its probability, in °F/mph/in or °C/m/s/mm after each
  user's unit system. WMO weather codes are mapped to the Gladys conditions
  (freezing rain, freezing fog and thundersnow included), with the day/night
  flag of the API.
- **Scene trigger "Rain or snow expected within the hour"**, from the
  15-minute forecast.
- **Scene action "Get the precipitation of the next hour"**.
- **Dashboard widget "Precipitation, next 2 hours"**: the quarter-hour chart.
- **Optional weather model**: automatic (Open-Meteo's `best_match`), or one
  of Météo-France, DWD ICON, NOAA GFS/HRRR, ECMWF IFS, UK Met Office,
  Environment Canada GEM, MET Norway, MeteoSwiss.

**No weather alerts**: Open-Meteo publishes none, and the integration invents
none. Install the Météo France or Pirate Weather integration next to it for
official warnings.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Install

1. In Gladys (5.1 or later), give your house a location: **Settings →
   Houses**.
2. Install **Open-Meteo** from the integration catalog and allow access to
   the house location.
3. In the **Configuration** tab, click **Test Open-Meteo**.

## Calls and refresh cadence

A timer in the container refreshes every house with a location, every 15
minutes by default (30 or 60 in the configuration). One refresh is **one call
per house** — houses closer than ~110 m share it — and that response serves
everything (dashboard, chat, trigger, action, widget): weather requests from
Gladys are answered from memory, so opening a dashboard costs nothing.

```
GET https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..
    &current=<14 variables>&minutely_15=<3>&hourly=<14>&daily=<13>
    &timezone=auto&timeformat=unixtime&wind_speed_unit=ms
    &forecast_days=8&forecast_hours=48&forecast_minutely_15=12&models=best_match
```

The free API allows 10,000 calls a day (5,000 an hour, 600 a minute) per IP
address, and counts a request with many variables as several calls — about
four here, so ~420 a day for one house at the default cadence. A `429` stops
the calls for a minute (minutely limit) or an hour (other limits); when a
refresh fails, a forecast up to 3 hours old keeps being served. The slim
cache holds about 16 KB per location, far below the 256 MB of the sandbox.

## Limits

- **No official alerts** (see above).
- The 15-minute block is **model data**, native over parts of Europe and
  North America, interpolated from hourly models elsewhere; it is not radar.
- The probability of precipitation comes from ensemble models, hourly and
  daily only; some models and places have none, and it is then left out.
- Scene and widget fields name a house by its name: Gladys 5.1 has no house
  picker for them yet.
- **Not verified against the live API in development**: the coding session
  could not reach `api.open-meteo.com`. The parser is tested on real responses
  recorded by other projects and on synthetic ones shaped like the
  integration's request; see [the fixtures](test/fixtures/README.md).
- Non-commercial use only, as the free Open-Meteo API requires.

## Development

Node.js 22+, ESM, no build step; the only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm ci
npm run format:check   # Prettier (Markdown included)
npm run lint           # ESLint
npm test               # node --test, never touches the network
npx github:GladysAssistant/integration-store .   # store admission checks
```

```
index.js                 SDK wiring only
src/app.js               the integration on an injected client (handlers, status)
src/api.js               the one Open-Meteo call, error kinds
src/forecast.js          raw response → slim metric forecast (columns → rows)
src/forecast-store.js    cache per location, shared calls, stale fallback, 429 block
src/scheduler.js         the refresh timer
src/pivot.js             metric forecast → Gladys pivot weather, in the requested units
src/conditions.js        WMO codes → Gladys conditions, day/night
src/nowcast.js           the next hour from the 15-minute block
src/scene-triggers.js    "precipitation expected within the hour"
src/scene-actions.js     "precipitation of the next hour"
src/widget.js            the 15-minute chart widget
src/houses.js            the houses of Gladys
src/units.js, texts.js   conversions, English and French sentences
scripts/capture-fixture.mjs   record a real response as a test fixture
```

To record a real response as a fixture (one call, no key):

```bash
node scripts/capture-fixture.mjs 48.8566 2.3522 paris
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="open-meteo" \
LOG_LEVEL=debug \
npm start
```

## Releasing

Versions belong to the **Release** workflow (Actions → Release → patch, minor
or major): it bumps `package.json` and the manifest `version`/`docker_image`,
moves the `## [Unreleased]` section of [`CHANGELOG.md`](CHANGELOG.md), tags,
builds the multi-arch image to `ghcr.io/guim31/gladys-open-meteo` and
publishes the GitHub Release.

> A hand-pushed tag (`git tag v1.0.0 && git push --tags`) triggers the same
> build and Release but touches no file: bump `version` in `package.json` and
> in `gladys-assistant-integration.json` (with the `docker_image` tag) and
> commit **before** tagging.

## Credits

- Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0),
  created by Patrick Zippenfenig, from the models of the national weather
  services.
- The WMO code mapping and the request follow the Home Assistant
  [`open_meteo`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/open_meteo)
  integration (Apache-2.0) and Franck Nijhof's
  [`python-open-meteo`](https://github.com/frenck/python-open-meteo) library
  (MIT), whose recorded API responses serve as test fixtures.
- Architecture shared with the sister integration
  [Pirate Weather for Gladys](https://github.com/guim31/gladys-pirate-weather).
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## License

Apache-2.0
