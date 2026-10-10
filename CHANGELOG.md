# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- Roku playback: no more Replay button (Instant replay depends on the app and
  confused a tester). The key stays on the device page and in the "Press a
  Roku remote key" scene action.
- The navigation keys of the widgets (arrows, OK, Back, Home) answer at once;
  only power, app and play/pause wait to show the new state.
- Documentation: OK selects in the menus of the apps, Play/Pause only acts
  during a video; place Roku remote and Roku navigation one under the other.

## [1.0.3] - 2026-10-10

### Added

- Roku navigation widget: the four arrows, to place next to the Roku remote.
- "Type a text on a Roku" scene action, for a search or a login: start it from
  a Scene box of the dashboard. The typed text never goes to the logs.

### Fixed

- The buttons of the dashboard widgets (Play/Pause, Replay… of Roku playback)
  could stop reaching the Roku after a minute of use: the widgets asked Gladys
  to reload them so often that Gladys refused the reloads, and with them the
  button taps. A widget is now reloaded only when what it shows changed, at
  most every 30 seconds, and shows the new state of the Roku right after a tap.
- The home screen of Roku OS 15 ("Roku Dynamic Menu") is shown as Home, and
  fires the "Roku app changed" trigger as Home.
- Roku playback no longer shows the last position of a closed video.

### Changed

- Roku remote: Power (Roku TV) or Play/Pause (player), Home, Back and OK. The
  "Keys…" button is removed: its form needs a Gladys version not released yet
  (5.1.4 shows the button but sends nothing). The arrows are in the new Roku
  navigation widget, every key on the device page and in the "Press a Roku
  remote key" scene action.
- Roku apps: the settings and the documentation say it plainly, four apps at
  most per widget, named in the settings (add a second widget for more); every
  app is in the Application feature of the device.

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

[Unreleased]: https://github.com/guim31/gladys-roku/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/guim31/gladys-roku/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/guim31/gladys-roku/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-roku/releases/tag/v1.0.1
