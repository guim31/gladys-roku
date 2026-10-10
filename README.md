# Roku for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for **Roku
streaming players** and **Roku TVs**, 100% local, over the
[External Control Protocol (ECP)](https://developer.roku.com/docs/developer-program/dev-tools/external-control-api.md)
Roku documents for its devices (HTTP on port 8060). No Roku account, no cloud.

> **Developed without the hardware: feedback welcome.** The integration was
> written from Roku's documentation and from real device answers recorded by
> other open-source projects (see [Credits](#credits)), not against a Roku.
> Issues and logs from real devices are the most useful contribution.

## What it does

- **Discovery**: Rokus answer an SSDP search (`ST: roku:ecp`) run by the Gladys
  core on the integration's behalf (the container's bridge network sees no
  multicast); addresses can also be typed by hand.
- **One Gladys device per Roku**, keyed by its serial number:
  - power: on/off on a Roku TV (`PowerOn` / `PowerOff` keys), state only on a
    player, read from `power-mode`; a TV that does not answer is woken with
    Wake-on-LAN (sent by the core) before `PowerOn`;
  - the app on screen, as a select listing the installed apps (launch one, or
    Home);
  - on a Roku TV, the input as a select (HDMI 1-4, antenna, AV, Roku
    streaming), with the names the user gave the inputs;
  - the playback state (playing or not);
  - remote keys as push buttons: Home, Back, arrows, OK, Options (\*),
    Play/Pause, Rewind, Fast forward, Instant replay; Volume up/down and Mute
    on a Roku TV; Channel up/down on a Roku TV with a tuner.
- **Dashboard widgets** (Gladys 5.1+): a remote (power or play/pause, Home,
  Back, OK), the navigation arrows, a "now playing" card with the app icon and
  position, and app shortcuts with their icons. Gladys allows four buttons per
  widget: the remote and the arrows are two widgets, one under the other.
- **Scenes** (Gladys 5.1+): an "app changed" trigger, "open an app", "press a
  key" and "type a text" actions. Typing a text (a search, a login) goes
  through a scene started from a Scene box: the dashboard of the released
  Gladys has no text field for integrations.
- **Diagnostics**: a Roku set to "Control by mobile apps: Limited" (the default
  of recent Roku OS versions) answers HTTP 403; the integration says so, and
  what to change, in the Configuration screen, the widgets and the
  "Test the connection" action. Optional debug logs trace every ECP request.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Requirements

- Gladys Assistant **5.1.0** or later (external integrations with widgets,
  scene declarations and mediated network discovery).
- A Roku player or Roku TV on the same network as Gladys, with **Settings >
  System > Advanced system settings > Control by mobile apps > Network access**
  set to **Enabled**. On a Roku TV, **Fast TV start** on, to turn it on from
  Gladys.

## Installation

From the Gladys integration store: install **Roku**, open the **Discovery**
tab, scan, add your Rokus. Details in the [user documentation](docs/en.md).

## Limits

- ECP has **no absolute volume**, no volume level and no mute state: Volume
  up, Volume down and Mute are keys, nothing more.
- Roku **players have no power command**: their power feature is read-only.
- States are polled every **10 seconds** (ECP pushes nothing).
- Turning on a Roku TV in deep standby needs Fast TV start, or a Wake-on-LAN
  the TV accepts.
- Text entry, search, channel tuning by number and "play on Roku" URLs are not
  implemented.

## Development

Node.js 22 or later, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js):
ECP is plain HTTP (Node's `fetch`) and its small XML answers are read by a
minimal parser (`src/ecp/xml.js`), to stay well within the 256 MB sandbox.

```bash
npm ci
npm run format:check   # Prettier (code and Markdown)
npm run lint           # ESLint
npm test               # node --test, no network
```

```
index.js               creates the SDK client, connects
src/app.js             every SDK handler, wired to the manager
src/manager.js         the Rokus: discovery, polling, state publication, commands
src/ecp/               ECP client, XML reader, answer parsers (+ SSDP replies)
src/devices/roku.js    the Gladys device of a Roku: features, keys, states
src/widgets.js         dashboard widgets (remote, navigation, media, apps), app icons
src/scenes.js          scene trigger data and scene actions
src/actions.js         the "Test the connection" action
test/fixtures/ecp/     real ECP answers (anonymized), see Credits
test/gladys-rules.test.js  conformance of every device to the core rules
```

Releases go through the **Release** workflow (Actions → Release), which bumps
the version in `package.json` and the manifest, rolls `CHANGELOG.md` and builds
the multi-arch image `ghcr.io/guim31/gladys-roku`. Never edit the version by
hand. See [CLAUDE.md](CLAUDE.md) for the contributor rules.

## Credits

- [python-rokuecp](https://github.com/ctalkington/python-rokuecp) by Chris
  Talkington (MIT): the XML answers of `test/fixtures/ecp/` are adapted from
  its test fixtures (serial numbers, ids and MAC addresses replaced), and its
  reading of `power-mode`, app names and media states guided the parsers.
- The [Home Assistant Roku integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/roku)
  (Apache 2.0): polling cadence, key mapping and the TV input handling.
- [Android TV Remote for Gladys](https://github.com/guim31/gladys-integration-android-tv-remote):
  the model for the features and widgets.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## License

Apache-2.0. Not affiliated with Roku, Inc. Roku is a trademark of
Roku, Inc.
