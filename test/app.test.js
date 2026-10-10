// The integration wired to a (fake) SDK: the journeys a user goes through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { LAN, createReferenceLan } from './helpers/fakeRoku.js';
import { createVirtualTime } from './helpers/fakeCore.js';

const ssdpResults = JSON.parse(
  readFileSync(new URL('./fixtures/ecp/ssdp-results.json', import.meta.url), 'utf8'),
);

function setup({ config = {}, devices = [], time } = {}) {
  const gladys = createFakeGladys({ scanResults: { ssdp: ssdpResults }, config, devices });
  const lan = createReferenceLan();
  const app = createApp(
    gladys,
    { createClient: lan.createClient, schedule: () => 0, sleep: async () => {} },
    time ? { now: time.now, schedule: time.schedule } : {},
  );
  return { gladys, lan, app };
}

test('connection: SSDP + typed addresses published to the Discovery tab, status OK', async () => {
  const { gladys, app } = setup({ config: { hosts: LAN.stick.ip } });
  await gladys.handlers.on.connected();
  assert.equal(gladys.discovered.length, 3);
  assert.deepEqual(gladys.connectionStatuses.at(-1), { connected: true, message: undefined });
  assert.deepEqual(gladys.widgetRefreshes.sort(), ['apps', 'media', 'remote']);
  app.shutdown();
});

test('a created device gets every state, and the widgets are nudged', async () => {
  const { gladys, app } = setup();
  await gladys.handlers.on.connected();
  assert.equal(gladys.states.length, 0, 'nothing created yet: nothing published');
  const device = gladys.discovered.find((d) => d.external_id.endsWith(LAN.tv.serial));
  await gladys.handlers.deviceCreated(device);
  assert.equal(gladys.lastState(`${device.external_id}:power`), 1);
  assert.equal(gladys.lastState(`${device.external_id}:input`), 'tvinput.dtv');
  app.shutdown();
});

test('after a restart, the created devices are polled from their params', async () => {
  const devices = [
    {
      external_id: `ext:roku-test:roku:${LAN.box.serial}`,
      params: [{ name: 'ROKU_IP', value: LAN.box.ip }],
    },
  ];
  const { gladys, app } = setup({ devices });
  gladys.scanResults.ssdp = [];
  await gladys.handlers.on.connected();
  assert.equal(gladys.lastState(`${devices[0].external_id}:app`), '12');
  const before = gladys.states.length;
  await gladys.handlers.poll(devices[0]);
  assert.equal(gladys.states.length, before, 'a poll without change publishes nothing');
  app.shutdown();
});

test('a Roku in Limited mode turns the connection status red, with the fix', async () => {
  const { gladys, lan, app } = setup();
  lan.roku(LAN.tv.ip).fail = 'forbidden';
  await gladys.handlers.on.connected();
  const status = gladys.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.en, /192\.0\.2\.30 refuses remote control/);
  assert.match(status.message.en, /"Enabled"/);

  delete lan.roku(LAN.tv.ip).fail;
  await gladys.handlers.scanRequest();
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
  app.shutdown();
});

test('the app_changed scene event fires on a change seen by a poll', async () => {
  const { gladys, lan, app } = setup();
  await gladys.handlers.on.connected();
  const device = gladys.discovered.find((d) => d.external_id.endsWith(LAN.box.serial));
  await gladys.handlers.deviceCreated(device);
  lan.roku(LAN.box.ip).activeApp = 'active-app-pluto.xml';
  await gladys.handlers.poll(device);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(gladys.sceneEvents, [
    {
      key: 'app_changed',
      data: { device: device.external_id, app: "Pluto TV - It's Free TV", app_id: '74519' },
    },
  ]);
  app.shutdown();
});

test('commands from the device page, actions, scene actions and widgets reach the Roku', async () => {
  const { gladys, lan, app } = setup();
  await gladys.handlers.on.connected();
  const tv = gladys.discovered.find((d) => d.external_id.endsWith(LAN.tv.serial));
  lan.calls.length = 0;
  await gladys.handlers.setValue(tv, { external_id: `${tv.external_id}:key:volume_up` }, 1);
  await gladys.handlers.sceneAction.send_key({ device: tv.external_id, key: 'volume_mute' });
  await gladys.handlers.widgetAction.remote('home', { serial: LAN.tv.serial }, {});
  assert.deepEqual(
    lan.calls.filter((call) => call.op === 'keypress').map((call) => call.arg),
    ['VolumeUp', 'VolumeMute', 'Home'],
  );
  const message = await gladys.handlers.action.test_connection({ device: tv.external_id });
  assert.match(message.en, /Remote control accepted/);
  const content = await gladys.handlers.widgetGet.remote({ settings: {}, language: 'en' });
  assert.ok(content.components.length > 0);
  assert.ok(await gladys.handlers.widgetGetImage('icon-12-0'));
  app.shutdown();
});

test('debug logs follow the configuration, live', async () => {
  const saved = process.env.LOG_LEVEL;
  const { gladys, app } = setup();
  await gladys.handlers.configUpdated({ debug_logs: true, hosts: 'nonsense!' });
  assert.equal(process.env.LOG_LEVEL, 'debug');
  await gladys.handlers.configUpdated({ debug_logs: false });
  // Back to the level the container started with.
  assert.notEqual(process.env.LOG_LEVEL, 'debug');
  process.env.LOG_LEVEL = saved;
  app.shutdown();
});

test('going Home on Roku OS 15 fires app_changed with "Home", not "Roku Dynamic Menu"', async () => {
  const { gladys, lan, app } = setup();
  await gladys.handlers.on.connected();
  const device = gladys.discovered.find((d) => d.external_id.endsWith(LAN.box.serial));
  await gladys.handlers.deviceCreated(device);
  lan.roku(LAN.box.ip).activeApp = 'active-app-dynamic-menu.xml';
  await gladys.handlers.poll(device);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(gladys.sceneEvents.at(-1), {
    key: 'app_changed',
    data: { device: device.external_id, app: 'Home', app_id: 'home' },
  });
  assert.equal(gladys.lastState(`${device.external_id}:app`), 'home');
  const content = await gladys.handlers.widgetGet.remote({ settings: {}, language: 'en' });
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items[1].value, { en: 'Home', fr: 'Accueil' });
  app.shutdown();
});

test('a widget is nudged only when what it shows changed', async () => {
  const time = createVirtualTime();
  const { gladys, lan, app } = setup({ time });
  await gladys.handlers.on.connected();
  const device = gladys.discovered.find((d) => d.external_id.endsWith(LAN.box.serial));
  await gladys.handlers.deviceCreated(device);
  await gladys.handlers.poll(device);
  await time.advance(60 * 1000);
  const before = gladys.widgetRefreshes.length;
  // Nothing changed on the Roku: no nudge, even once the window is over.
  await gladys.handlers.poll(device);
  await gladys.handlers.poll(device);
  await time.advance(60 * 1000);
  assert.equal(gladys.widgetRefreshes.length, before);
  // The app changes: the three widgets show it, all three are nudged.
  const settled = gladys.widgetRefreshes.length;
  lan.roku(LAN.box.ip).activeApp = 'active-app-pluto.xml';
  await gladys.handlers.poll(device);
  assert.deepEqual(gladys.widgetRefreshes.slice(settled).sort(), ['apps', 'media', 'remote']);
  app.shutdown();
});
