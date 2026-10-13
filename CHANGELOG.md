# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- Quieter logs: a normal refresh writes nothing at the info level any more
  (the cycle summary moves to debug), and an Open-Meteo or Gladys failure that
  repeats on every refresh is logged once when it starts and once when it
  ends, instead of on every attempt and every dashboard view.
- Integration SDK 0.15.

## [1.1.0] - 2026-10-11

### Added

- German and Spanish: the configuration, the scene trigger and action, the
  widget, the status and test messages and the scene sentences now exist in
  the four languages of Gladys. The language of the scene texts can be set to
  German or Spanish.

## [1.0.1] - 2026-10-10

### Added

- Open-Meteo weather provider for Gladys 5.1 or later (`type: "weather"`): no
  account, no API key. Current conditions, the next 24 hours and the next 8
  days in the Gladys weather widget and chat assistant, in °C/m/s/mm or
  °F/mph/in after each user's unit system, with feels-like temperature, wind
  and gusts, UV index, sunrise and sunset, precipitation and its probability.
- WMO weather codes mapped to the Gladys conditions, freezing rain, freezing
  fog and thundersnow included, with the day/night flag of the API.
- Scene trigger "Rain or snow expected within the hour" and scene action "Get
  the precipitation of the next hour", from the 15-minute forecast.
- Dashboard widget "Precipitation, next 2 hours": the quarter-hour chart.
- Choice of the weather model: automatic, Météo-France, DWD ICON, NOAA
  GFS/HRRR, ECMWF IFS, UK Met Office, Environment Canada GEM, MET Norway or
  MeteoSwiss.
- One call per house every 15 minutes (or 30, or 60), served from memory to
  every reader; a forecast up to 3 hours old is kept when Open-Meteo fails.
- "Test Open-Meteo" button in the Configuration screen.
- Documentation in English and French, with the Open-Meteo attribution (CC BY
  4.0).

[Unreleased]: https://github.com/guim31/gladys-open-meteo/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/guim31/gladys-open-meteo/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/guim31/gladys-open-meteo/releases/tag/v1.0.1
