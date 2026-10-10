// Readers of the ECP answers and SSDP replies, fed with real device answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { child, decodeEntities, parseXml } from '../src/ecp/xml.js';
import {
  HOME_APP_ID,
  deviceName,
  isTvInput,
  parseActiveApp,
  parseApps,
  parseDeviceInfo,
  parseMediaPlayer,
  parseSsdpResult,
} from '../src/ecp/parse.js';
import { fixture } from './helpers/fakeRoku.js';

const ssdpResults = JSON.parse(
  readFileSync(new URL('./fixtures/ecp/ssdp-results.json', import.meta.url), 'utf8'),
);

test('xml: elements, attributes, self-closing tags, comments and entities', () => {
  const root = parseXml(
    '<?xml version="1.0"?>\n<!-- c --><a x="1 &amp; 2"><b>Tom &amp; Jerry&#39;s &#x2122;</b><c/><d y=\'z\'>t</d></a>',
  );
  assert.equal(root.name, 'a');
  assert.equal(root.attrs.x, '1 & 2');
  assert.equal(child(root, 'b').text, "Tom & Jerry's ™");
  assert.deepEqual(child(root, 'c').children, []);
  assert.equal(child(root, 'd').attrs.y, 'z');
  assert.equal(decodeEntities('&unknown; &#0;'), '&unknown; &#0;');
  assert.throws(() => parseXml('not xml'), /Not an XML document/);
});

test('device-info of a Roku 3 box', () => {
  const info = parseDeviceInfo(fixture('device-info-box.xml'));
  assert.equal(info.serial, 'BOX000000001');
  assert.equal(info.name, 'My Roku 3');
  assert.equal(info.deviceType, 'box');
  assert.equal(info.isTv, false);
  assert.equal(info.poweredOn, true);
  assert.equal(info.powerMode, 'PowerOn');
  // On ethernet: the ethernet MAC is the one Wake-on-LAN must target.
  assert.equal(info.mac, '02:00:00:00:0b:02');
  assert.equal(info.softwareVersion, '7.5.0');
});

test('device-info of a Roku Stick on wifi', () => {
  const info = parseDeviceInfo(fixture('device-info-stick.xml'));
  assert.equal(info.deviceType, 'stick');
  assert.equal(info.isStick, true);
  assert.equal(info.mac, '02:00:00:00:0c:01');
  assert.equal(info.model, 'Roku Stick');
});

test('device-info of a TCL Roku TV without a user name', () => {
  const info = parseDeviceInfo(fixture('device-info-tv.xml'));
  assert.equal(info.deviceType, 'tv');
  assert.equal(info.isTv, true);
  assert.equal(info.hasTuner, true);
  assert.equal(info.vendor, 'TCL');
  assert.equal(info.model, 'TCL•Roku TV');
  // No user-device-name: the friendly name the firmware builds.
  assert.equal(info.name, 'TCL•Roku TV - TVX000000003');
  assert.equal(info.supportsWakeOnWlan, true);
});

test('standby power modes read as off', () => {
  assert.equal(parseDeviceInfo(fixture('device-info-box-standby.xml')).poweredOn, false);
  const tv = parseDeviceInfo(fixture('device-info-tv-standby.xml'));
  assert.equal(tv.powerMode, 'DisplayOff');
  assert.equal(tv.poweredOn, false);
});

test('device-info without serial, or another document, is refused', () => {
  assert.throws(
    () => parseDeviceInfo('<device-info><power-mode>PowerOn</power-mode></device-info>'),
    /serial/,
  );
  assert.throws(() => parseDeviceInfo('<apps/>'), /Unexpected ECP answer/);
});

test('device name fallbacks', () => {
  assert.equal(
    deviceName({ 'user-device-name': '  ', 'default-device-name': 'Roku Ultra - X' }),
    'Roku Ultra - X',
  );
  assert.equal(deviceName({ 'vendor-name': 'Hisense', 'model-name': '50R6' }), 'Hisense 50R6');
  assert.equal(deviceName({}), 'Roku');
});

test('apps of a player and of a Roku TV', () => {
  const apps = parseApps(fixture('apps.xml'));
  assert.equal(apps.length, 8);
  assert.deepEqual(apps[1], { id: '12', name: 'Netflix', type: 'appl', version: '' });
  assert.equal(apps[3].name, 'MLB.TV®');
  assert.equal(apps[7].name, "Pluto TV - It's Free TV");
  assert.equal(apps[7].version, '5.2.0');

  const tvApps = parseApps(fixture('apps-tv.xml'));
  const inputs = tvApps.filter((app) => isTvInput(app.id));
  assert.deepEqual(
    inputs.map((app) => [app.id, app.name, app.type]),
    [
      ['tvinput.hdmi2', 'Satellite TV', 'tvin'],
      ['tvinput.hdmi1', 'Blu-ray player', 'tvin'],
      ['tvinput.dtv', 'Antenna TV', 'tvin'],
    ],
  );
});

test('active app: an app, the home screen, the screensaver, a TV input', () => {
  assert.deepEqual(parseActiveApp(fixture('active-app-netflix.xml')), {
    id: '12',
    name: 'Netflix',
    type: 'appl',
    version: '4.1.218',
    home: false,
    screensaver: false,
  });
  const home = parseActiveApp(fixture('active-app-roku.xml'));
  assert.equal(home.id, HOME_APP_ID);
  assert.equal(home.home, true);
  const screensaver = parseActiveApp(fixture('active-app-screensaver.xml'));
  assert.equal(screensaver.home, true);
  assert.equal(screensaver.screensaver, true);
  const tv = parseActiveApp(fixture('active-app-tv.xml'));
  assert.equal(tv.id, 'tvinput.dtv');
  assert.equal(tv.name, 'Antenna TV');
});

test('media player: play, pause, close, live, transient states', () => {
  const play = parseMediaPlayer(fixture('media-player-amazon-play.xml'));
  assert.equal(play.playing, true);
  assert.equal(play.positionMs, 31820);
  assert.equal(play.durationMs, null);
  assert.equal(play.appId, '13');
  const pause = parseMediaPlayer(fixture('media-player-amazon-pause.xml'));
  assert.equal(pause.playing, false);
  assert.equal(pause.state, 'pause');
  assert.equal(parseMediaPlayer(fixture('media-player-close.xml')).playing, false);
  const live = parseMediaPlayer(fixture('media-player-pluto-live.xml'));
  assert.equal(live.live, true);
  assert.equal(live.durationMs, 95000);
  assert.equal(parseMediaPlayer('<player state="buffer"/>').playing, null);
  assert.equal(parseMediaPlayer('<player/>').state, 'none');
});

test('ssdp: Roku replies are read, other devices ignored', () => {
  const parsed = ssdpResults.map(parseSsdpResult);
  assert.deepEqual(parsed[0], {
    ip: '192.0.2.10',
    port: 8060,
    serial: 'BOX000000001',
    mac: '02:00:00:00:0b:02',
  });
  assert.equal(parsed[1].serial, 'TVX000000003');
  assert.equal(parsed[1].mac, '');
  assert.equal(parsed[3], null);
  // No LOCATION: the sender is the Roku.
  assert.equal(
    parseSsdpResult({
      source_ip: '192.0.2.50',
      headers: 'ST: roku:ecp\r\nUSN: uuid:roku:ecp:ABC\r\n',
    }).ip,
    '192.0.2.50',
  );
  assert.equal(parseSsdpResult({ headers: '' }), null);
});

test('Roku OS 15 reports its home screen as "Roku Dynamic Menu" (562859): it is Home', () => {
  const home = parseActiveApp(fixture('active-app-dynamic-menu.xml'));
  assert.equal(home.id, HOME_APP_ID);
  assert.equal(home.name, 'Home');
  assert.equal(home.home, true);
});
