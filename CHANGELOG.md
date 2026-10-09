# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.2] - 2026-10-09

## [1.0.1] - 2026-10-09

### Added

- Roku players and Roku TVs as Gladys devices, controlled locally over the Roku
  External Control Protocol (ECP): power (on/off on Roku TVs, state on
  players), the app on screen with a list to open another one, the input of a
  Roku TV, the playback state, and the remote keys (navigation, playback, and
  on Roku TVs volume, mute and channels).
- Discovery of the Rokus of the network through the Gladys core (SSDP), and
  addresses typed by hand for the ones it misses. A Roku that changed address
  is found again.
- Wake-on-LAN before turning on a Roku TV that does not answer.
- Dashboard widgets: Roku remote, Roku playback (with the app icon) and Roku
  apps (shortcuts with their icons).
- Scenes: the "Roku app changed" trigger, the "Open an app on a Roku" and
  "Press a Roku remote key" actions.
- A clear message, in the Configuration screen, the widgets and the "Test the
  connection to a Roku" action, when a Roku refuses control ("Control by
  mobile apps" set to Limited or Disabled), with the setting to change.
- Optional debug logs of every request sent to the Rokus.

[Unreleased]: https://github.com/guim31/gladys-roku/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/guim31/gladys-roku/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-roku/releases/tag/v1.0.1
