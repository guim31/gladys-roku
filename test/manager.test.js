// The Roku manager: discovery, state publication, commands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RokuManager, slug } from '../src/manager.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { LAN, createFakeLan, createReferenceLan } from './helpers/fakeRoku.js';

const ssdpResults = JSON.parse(
  readFileSync(new URL('./fixtures/ecp/ssdp-results.json', import.meta.url), 'utf8'),
);

function setup({
  scanResults = { ssdp: ssdpResults },
  devices = [],
  lan = createReferenceLan(),
} = {}) {
  const gladys = createFakeGladys({ scanResults, devices });
  let clock = 1_000_000;
  const scheduled = [];
  const sleeps = [];
  const manager = new RokuManager(gladys, {
    createClient: lan.createClient,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      await manager.onSleep?.();
    },
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
  });
  const events = { changed: [], appChanged: [] };
  manager.on('changed', (roku) => events.changed.push(roku.serial));
  manager.on('appChanged', (roku, previous, app) =>
    events.appChanged.push({ serial: roku.serial, from: previous.id, to: app.id }),
  );
  return {
    gladys,
    lan,
    manager,
    events,
    scheduled,
    sleeps,
    advance: (ms) => {
      clock += ms;
    },
  };
}

const id = (gladys, serial, key) => gladys.externalIds('roku', serial).feature(key);

test('discovery: SSDP and configured addresses, one device per serial number', async () => {
  const { gladys, manager } = setup();
  const { found, failures } = await manager.discover({ hosts: [LAN.stick.ip, LAN.box.ip] });
  assert.deepEqual(
    found.map((roku) => roku.serial).sort(),
    [LAN.box.serial, LAN.stick.serial, LAN.tv.serial].sort(),
  );
  assert.deepEqual(failures, []);
  assert.deepEqual(gladys.scans, [{ type: 'ssdp', options: { timeoutSeconds: 4 } }]);

  await manager.publishDiscovered();
  const tv = gladys.discovered.find((device) => device.external_id.endsWith(LAN.tv.serial));
  assert.equal(tv.external_id, `ext:roku-test:roku:${LAN.tv.serial}`);
  assert.deepEqual(tv.params, [
    { name: 'ROKU_IP', value: LAN.tv.ip },
    { name: 'ROKU_MAC', value: '02:00:00:00:0d:01' },
  ]);
  assert.equal(tv.model, 'TCL TCL•Roku TV');
});

test('discovery without SSDP support in the core falls back to the typed addresses', async () => {
  const forbidden = Object.assign(new Error('network_discovery: not declared'), { status: 403 });
  const { manager } = setup({ scanResults: { ssdp: forbidden } });
  const { found } = await manager.discover({ hosts: [LAN.box.ip] });
  assert.deepEqual(
    found.map((roku) => roku.serial),
    [LAN.box.serial],
  );
  assert.equal(manager.lastScan.error, forbidden);
});

test('an address without Roku is a failure, not a crash', async () => {
  const { manager } = setup({ scanResults: {} });
  const { found, failures } = await manager.discover({ hosts: ['192.0.2.250'] });
  assert.deepEqual(found, []);
  assert.equal(failures[0].ip, '192.0.2.250');
  assert.equal(failures[0].error.kind, 'unreachable');
});

test('refresh publishes the states of a playing box, then only what changes', async () => {
  const { gladys, lan, manager, events } = setup();
  await manager.discover({ hosts: [LAN.box.ip] }, { ssdp: false });
  await manager.refresh(LAN.box.serial);
  assert.equal(gladys.lastState(id(gladys, LAN.box.serial, 'power')), 1);
  assert.equal(gladys.lastState(id(gladys, LAN.box.serial, 'app')), '12');
  assert.equal(gladys.lastState(id(gladys, LAN.box.serial, 'playback')), 1);
  assert.equal(gladys.states.length, 3);

  await manager.refresh(LAN.box.serial);
  assert.equal(gladys.states.length, 3, 'nothing changed, nothing published');

  lan.roku(LAN.box.ip).media = 'media-player-amazon-pause.xml';
  await manager.refresh(LAN.box.serial);
  assert.deepEqual(gladys.states.slice(3), [
    { device_feature_external_id: id(gladys, LAN.box.serial, 'playback'), state: 0 },
  ]);

  lan.roku(LAN.box.ip).activeApp = 'active-app-roku.xml';
  await manager.refresh(LAN.box.serial);
  assert.equal(gladys.lastState(id(gladys, LAN.box.serial, 'app')), 'home');
  assert.deepEqual(events.appChanged, [{ serial: LAN.box.serial, from: '12', to: 'home' }]);
  assert.ok(events.changed.includes(LAN.box.serial));
});

test('a Roku TV on its antenna input: input published, app left alone', async () => {
  const { gladys, manager } = setup();
  await manager.discover({ hosts: [LAN.tv.ip] }, { ssdp: false });
  await manager.refresh(LAN.tv.serial);
  assert.equal(gladys.lastState(id(gladys, LAN.tv.serial, 'input')), 'tvinput.dtv');
  assert.equal(gladys.lastState(id(gladys, LAN.tv.serial, 'app')), undefined);
  assert.equal(gladys.lastState(id(gladys, LAN.tv.serial, 'playback')), 0);
});

test('a Roku TV in standby: power 0, playback 0, and no app query', async () => {
  const lan = createFakeLan({
    '192.0.2.31': {
      deviceInfo: 'device-info-tv-standby.xml',
      apps: 'apps-tv.xml',
      activeApp: 'active-app-tv.xml',
      media: 'media-player-close.xml',
    },
  });
  const { gladys, manager } = setup({ lan });
  await manager.discover({ hosts: ['192.0.2.31'] }, { ssdp: false });
  lan.calls.length = 0;
  await manager.refresh('TVX000000005');
  assert.equal(gladys.lastState(id(gladys, 'TVX000000005', 'power')), 0);
  assert.equal(gladys.lastState(id(gladys, 'TVX000000005', 'playback')), 0);
  assert.deepEqual(
    lan.calls.map((call) => call.op),
    ['deviceInfo'],
  );
});

test('an unreachable Roku is off; it comes back on the next poll', async () => {
  const { gladys, lan, manager, events } = setup();
  await manager.discover({ hosts: [LAN.box.ip] }, { ssdp: false });
  await manager.refresh(LAN.box.serial);
  const spec = lan.roku(LAN.box.ip);
  lan.remove(LAN.box.ip);
  await manager.refresh(LAN.box.serial);
  const roku = manager.rokus.get(LAN.box.serial);
  assert.equal(roku.reachable, false);
  assert.equal(gladys.lastState(id(gladys, LAN.box.serial, 'power')), 0);
  assert.equal(gladys.lastState(id(gladys, LAN.box.serial, 'playback')), 0);
  assert.ok(events.changed.includes(LAN.box.serial));

  lan.add(LAN.box.ip, spec);
  await manager.refresh(LAN.box.serial);
  assert.equal(roku.reachable, true);
  assert.equal(gladys.lastState(id(gladys, LAN.box.serial, 'power')), 1);
});

test('a Roku refusing ECP is reported, and its power state is not guessed', async () => {
  const { gladys, lan, manager } = setup();
  await manager.discover({ hosts: [LAN.box.ip] }, { ssdp: false });
  lan.roku(LAN.box.ip).fail = 'forbidden';
  await manager.refresh(LAN.box.serial);
  assert.equal(gladys.states.length, 0);
  const [refusing] = manager.refusing();
  assert.equal(refusing.label, `My Roku 3 (${LAN.box.ip})`);
  assert.equal(refusing.error.kind, 'forbidden');

  delete lan.roku(LAN.box.ip).fail;
  await manager.refresh(LAN.box.serial);
  assert.deepEqual(manager.refusing(), []);
});

test('a Roku refusing even its device-info shows up by address', async () => {
  const { manager, lan } = setup({ scanResults: {} });
  lan.roku(LAN.box.ip).fail = 'forbidden';
  await manager.discover({ hosts: [LAN.box.ip] });
  assert.deepEqual(
    manager.refusing().map((entry) => entry.label),
    [LAN.box.ip],
  );
});

test('created devices are reached through their params, and re-sent every state', async () => {
  const gladysDevice = {
    external_id: `ext:roku-test:roku:${LAN.box.serial}`,
    params: [
      { name: 'ROKU_IP', value: LAN.box.ip },
      { name: 'ROKU_MAC', value: '02:00:00:00:0b:02' },
    ],
  };
  const { gladys, manager } = setup({ devices: [gladysDevice] });
  manager.syncCreatedDevices(gladys.devices);
  const roku = manager.rokus.get(LAN.box.serial);
  assert.equal(roku.ip, LAN.box.ip);
  assert.equal(roku.created, true);

  await manager.refresh(LAN.box.serial);
  assert.equal(gladys.states.length, 3);
  // The core dropped them if the device did not exist yet: all sent again.
  await manager.deviceCreated(gladysDevice);
  assert.equal(gladys.states.length, 6);
});

test('a moved Roku is found again by SSDP after a few failed polls', async () => {
  const { gladys, lan, manager, advance } = setup({ scanResults: { ssdp: [] } });
  await manager.discover({ hosts: [LAN.box.ip] }, { ssdp: false });
  const spec = lan.roku(LAN.box.ip);
  lan.remove(LAN.box.ip);
  lan.add('192.0.2.11', spec);
  gladys.scanResults.ssdp = [
    {
      source_ip: '192.0.2.11',
      source_port: 1900,
      headers: `ST: roku:ecp\r\nLOCATION: http://192.0.2.11:8060/\r\nUSN: uuid:roku:ecp:${LAN.box.serial}\r\n`,
    },
  ];
  advance(60 * 60 * 1000);
  await manager.refresh(LAN.box.serial);
  await manager.refresh(LAN.box.serial);
  assert.equal(gladys.scans.length, 0, 'no scan before 3 failures');
  await manager.refresh(LAN.box.serial);
  const roku = manager.rokus.get(LAN.box.serial);
  assert.equal(roku.ip, '192.0.2.11');
  assert.equal(roku.reachable, true);
  assert.equal(gladys.discovered[0].params[0].value, '192.0.2.11', 'params re-published');
});

test('a new app in the foreground refreshes the app list and its options', async () => {
  const { gladys, lan, manager, advance } = setup();
  await manager.discover({ hosts: [LAN.tv.ip] }, { ssdp: false });
  await manager.publishDiscovered();
  const calls = gladys.discoveredCalls;
  lan.roku(LAN.tv.ip).activeApp = 'active-app-pluto.xml';
  lan.roku(LAN.tv.ip).apps = 'apps.xml';
  advance(61 * 1000);
  await manager.refresh(LAN.tv.serial);
  assert.equal(gladys.discoveredCalls, calls + 1);
  const app = gladys.discovered[0].features.find((feature) => feature.external_id.endsWith(':app'));
  assert.ok(app.supported_options.some((option) => option.value === '74519'));
});

test('commands: keys, apps, inputs, power', async () => {
  const { gladys, lan, manager, scheduled } = setup();
  await manager.discover({ hosts: [LAN.tv.ip, LAN.box.ip] }, { ssdp: false });
  lan.roku(LAN.tv.ip).refuseLaunch = ['tvinput.hdmi1'];
  const tv = { external_id: gladys.externalIds('roku', LAN.tv.serial).device };
  const box = { external_id: gladys.externalIds('roku', LAN.box.serial).device };
  const feature = (device, key) => ({ external_id: `${device.external_id}:${key}` });
  lan.calls.length = 0;

  await manager.setValue(tv, feature(tv, 'key:select'), 1);
  await manager.setValue(tv, feature(tv, 'key:volume_mute'), 1);
  await manager.setValue(tv, feature(tv, 'app'), '12');
  await manager.setValue(tv, feature(tv, 'input'), 'home');
  await manager.setValue(tv, feature(tv, 'input'), 'tvinput.hdmi1');
  await manager.setValue(tv, feature(tv, 'power'), 0);
  await manager.setValue(tv, feature(tv, 'power'), 1);
  assert.deepEqual(
    lan.calls.map((call) => `${call.op} ${call.arg}`),
    [
      'keypress Select',
      'keypress VolumeMute',
      'launch 12',
      'keypress Home',
      'launch tvinput.hdmi1',
      'keypress InputHDMI1',
      'keypress PowerOff',
      'keypress PowerOn',
    ],
  );
  // The state follows the command: a refresh is scheduled.
  assert.ok(scheduled.length > 0);
  assert.equal(scheduled.at(-1).ms, 1500);

  await assert.rejects(manager.setValue(box, feature(box, 'power'), 1), /Only a Roku TV/);
  await assert.rejects(manager.setValue(box, feature(box, 'nope'), 1), /Unknown feature/);
  await assert.rejects(
    manager.setValue({ external_id: 'ext:roku-test:roku:UNKNOWN' }, { external_id: 'x' }, 1),
    /unknown to the integration/,
  );
});

test('turning on an unreachable Roku TV sends Wake-on-LAN, then PowerOn', async () => {
  const { gladys, lan, manager, sleeps } = setup();
  await manager.discover({ hosts: [LAN.tv.ip] }, { ssdp: false });
  const spec = lan.roku(LAN.tv.ip);
  lan.remove(LAN.tv.ip);
  let wakes = 0;
  manager.onSleep = () => {
    wakes += 1;
    if (wakes === 2) {
      lan.add(LAN.tv.ip, spec); // the TV wakes up on the second packet
    }
  };
  await manager.setPower(LAN.tv.serial, true);
  assert.deepEqual(gladys.wakes, ['02:00:00:00:0d:01', '02:00:00:00:0d:01']);
  assert.deepEqual(sleeps, [2500, 2500]);
  assert.equal(lan.calls.filter((call) => call.arg === 'PowerOn').length, 3);
});

test('turning off never wakes; a refused command keeps its reason', async () => {
  const { gladys, lan, manager, events } = setup();
  await manager.discover({ hosts: [LAN.tv.ip] }, { ssdp: false });
  lan.roku(LAN.tv.ip).failKeys = 'forbidden';
  await assert.rejects(manager.setPower(LAN.tv.serial, false), (err) => err.kind === 'forbidden');
  assert.deepEqual(gladys.wakes, []);
  assert.equal(manager.rokus.get(LAN.tv.serial).error.kind, 'forbidden');
  assert.ok(events.changed.includes(LAN.tv.serial));
});

test('apps are found by id or by a loosely typed name', async () => {
  const { manager } = setup();
  await manager.discover({ hosts: [LAN.box.ip] }, { ssdp: false });
  const roku = manager.rokus.get(LAN.box.serial);
  assert.equal(manager.findApp(roku, '12').name, 'Netflix');
  assert.equal(manager.findApp(roku, ' netflix ').id, '12');
  assert.equal(manager.findApp(roku, 'pluto').id, '74519');
  assert.equal(manager.findApp(roku, 'MLB.TV').id, '14');
  assert.equal(manager.findApp(roku, 'Home').id, 'home');
  assert.equal(manager.findApp(roku, 'Hulu'), undefined);
  assert.equal(manager.findApp(roku, ''), undefined);
  assert.equal(slug('Disney+'), 'disneyplus');
  assert.equal(slug('Télé Québec'), 'telequebec');
});
