// The Gladys device of a Roku: which features, for which model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApps, parseDeviceInfo } from '../src/ecp/parse.js';
import {
  REMOTE_KEYS,
  appOptions,
  buildRokuDevice,
  featureKey,
  inputKey,
  inputOptions,
  rokuStates,
  serialFromExternalId,
} from '../src/devices/roku.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { fixture } from './helpers/fakeRoku.js';

const gladys = createFakeGladys();

function roku(deviceInfo, apps) {
  const info = parseDeviceInfo(fixture(deviceInfo));
  return {
    serial: info.serial,
    ip: '192.0.2.10',
    mac: info.mac,
    info,
    apps: parseApps(fixture(apps)),
    state: {},
    reachable: true,
  };
}

const keysOf = (device) =>
  device.features.map(
    (feature) => device.external_id && featureKey(device.external_id, feature.external_id),
  );

test('a Roku player: read-only power, apps, playback, navigation and playback keys', () => {
  const device = buildRokuDevice(gladys, roku('device-info-box.xml', 'apps.xml'));
  assert.equal(device.name, 'My Roku 3');
  assert.equal(device.external_id, 'ext:roku-test:roku:BOX000000001');
  assert.equal(device.should_poll, true);
  assert.equal(device.poll_frequency, 10000);
  assert.deepEqual(keysOf(device), [
    'power',
    'app',
    'playback',
    'key:home',
    'key:back',
    'key:up',
    'key:down',
    'key:left',
    'key:right',
    'key:select',
    'key:info',
    'key:play',
    'key:rewind',
    'key:forward',
    'key:replay',
  ]);
  const power = device.features[0];
  assert.equal(power.read_only, true, 'a player cannot be powered from ECP');
  assert.equal(power.category, 'television');
  assert.equal(power.type, 'binary');
});

test('a Roku TV adds power, volume and mute keys, the input select and the channel keys', () => {
  const device = buildRokuDevice(gladys, roku('device-info-tv.xml', 'apps-tv.xml'));
  const keys = keysOf(device);
  for (const key of [
    'input',
    'key:volume_up',
    'key:volume_down',
    'key:volume_mute',
    'key:channel_up',
  ]) {
    assert.ok(keys.includes(key), `${key} missing`);
  }
  const power = device.features.find((feature) => feature.external_id.endsWith(':power'));
  assert.equal(power.read_only, false);
  assert.equal(power.has_feedback, true);
  // ECP has no absolute volume: no volume level feature, keys only.
  assert.ok(!device.features.some((feature) => feature.type === 'volume'));
});

test('a Roku TV without tuner has no channel keys', () => {
  const tv = roku('device-info-tv.xml', 'apps-tv.xml');
  tv.info.hasTuner = false;
  const keys = keysOf(buildRokuDevice(gladys, tv));
  assert.ok(!keys.includes('key:channel_up'));
});

test('text selects: min/max 0, string options without duplicates, inputs apart', () => {
  const apps = parseApps(fixture('apps-tv.xml'));
  const options = appOptions(apps);
  assert.deepEqual(options[0], { value: 'home', label: 'Home', sort_order: 0 });
  assert.ok(options.every((option) => typeof option.value === 'string'));
  assert.ok(!options.some((option) => option.value.startsWith('tvinput.')));
  assert.equal(new Set(options.map((option) => option.value)).size, options.length);
  assert.deepEqual(
    inputOptions(apps).map((option) => option.value),
    ['home', 'tvinput.hdmi2', 'tvinput.hdmi1', 'tvinput.dtv'],
  );
  const device = buildRokuDevice(gladys, roku('device-info-tv.xml', 'apps-tv.xml'));
  for (const feature of device.features.filter((f) => f.category === 'text')) {
    assert.equal(feature.min, 0);
    assert.equal(feature.max, 0);
    assert.equal(feature.keep_history, false);
  }
  // A Roku that did not list its apps yet still offers Home.
  assert.deepEqual(
    appOptions(null).map((option) => option.value),
    ['home'],
  );
});

test('remote keys are push buttons of the television category with distinct ECP keys', () => {
  assert.equal(new Set(REMOTE_KEYS.map((entry) => entry.key)).size, REMOTE_KEYS.length);
  assert.equal(new Set(REMOTE_KEYS.map((entry) => entry.type)).size, REMOTE_KEYS.length);
  assert.ok(!REMOTE_KEYS.some((entry) => ['binary', 'volume', 'channel'].includes(entry.type)));
  assert.equal(inputKey('tvinput.hdmi3'), 'InputHDMI3');
  assert.equal(inputKey('tvinput.dtv'), 'InputTuner');
  assert.equal(inputKey('12'), undefined);
});

test('external ids give the serial and the feature key back', () => {
  assert.equal(serialFromExternalId('ext:roku-test:roku:TVX000000003'), 'TVX000000003');
  assert.equal(serialFromExternalId('ext:roku-test:roku:TVX000000003:key:home'), 'TVX000000003');
  assert.equal(serialFromExternalId('ext:roku-test:plug:1'), null);
  assert.equal(serialFromExternalId(undefined), null);
  assert.equal(featureKey('ext:a:roku:1', 'ext:a:roku:1:key:home'), 'key:home');
  assert.equal(featureKey('ext:a:roku:1', 'ext:a:roku:2:power'), null);
});

test('states: never a guess', () => {
  const tv = roku('device-info-tv.xml', 'apps-tv.xml');
  const ids = gladys.externalIds('roku', tv.serial);
  // Nothing read yet: nothing published.
  tv.reachable = null;
  assert.deepEqual(rokuStates(gladys, tv), []);
  // On, a streaming app in the foreground: app + input "Roku (streaming)".
  tv.reachable = true;
  tv.state = { poweredOn: true, playing: true, app: { id: '12', name: 'Netflix', home: false } };
  assert.deepEqual(rokuStates(gladys, tv), [
    { device_feature_external_id: ids.feature('power'), state: 1 },
    { device_feature_external_id: ids.feature('playback'), state: 1 },
    { device_feature_external_id: ids.feature('app'), text: '12' },
    { device_feature_external_id: ids.feature('input'), text: 'home' },
  ]);
  // Playback unknown (buffering): left out.
  tv.state.playing = undefined;
  assert.ok(
    !rokuStates(gladys, tv).some((s) => s.device_feature_external_id.endsWith(':playback')),
  );
  // Unreachable: off.
  tv.reachable = false;
  assert.deepEqual(rokuStates(gladys, tv), [
    { device_feature_external_id: ids.feature('power'), state: 0 },
    { device_feature_external_id: ids.feature('playback'), state: 0 },
  ]);
});
