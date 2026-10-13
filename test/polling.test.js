// The internal poll loop (Gladys#3198: the core 5.2.0 never polls a device
// created without a valid should_poll / poll_frequency) and the log volume of
// a normal day: nothing at info level per read, one line per outage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';
import { createFakeGladys as createSdkFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../src/app.js';
import { RokuManager } from '../src/manager.js';
import { POLL_FREQUENCY_MS } from '../src/devices/roku.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { LAN, createReferenceLan } from './helpers/fakeRoku.js';
import { createVirtualTime } from './helpers/fakeCore.js';

const BOX_ID = `ext:roku-test:roku:${LAN.box.serial}`;
const TV_ID = `ext:roku-test:roku:${LAN.tv.serial}`;

/** Two Rokus created in Gladys before a restart, with a virtual clock. */
async function startCreated() {
  const time = createVirtualTime();
  const devices = [
    { external_id: BOX_ID, params: [{ name: 'ROKU_IP', value: LAN.box.ip }] },
    { external_id: TV_ID, params: [{ name: 'ROKU_IP', value: LAN.tv.ip }] },
  ];
  const gladys = createFakeGladys({ devices });
  gladys.scanResults.ssdp = [];
  const lan = createReferenceLan();
  const app = createApp(
    gladys,
    {
      createClient: lan.createClient,
      now: time.now,
      schedule: time.schedule,
      cancel: time.cancel,
      sleep: async () => {},
    },
    { now: time.now, schedule: time.schedule },
  );
  await gladys.handlers.on.connected();
  return { time, gladys, lan, app };
}

function reads(lan, ip) {
  return lan.calls.filter((call) => call.ip === ip && call.op === 'deviceInfo').length;
}

/** Collect what the SDK logger writes (info/debug to console.log, warn/error to console.error). */
function captureLogs(t, level = 'info') {
  const saved = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = saved;
  });
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  return lines;
}

test('poll_frequency is one of the core values', () => {
  assert.ok(Object.values(DEVICE_POLL_FREQUENCIES).includes(POLL_FREQUENCY_MS));
});

test('created Rokus the core never polls are read by the internal timer', async () => {
  const { time, gladys, lan, app } = await startCreated();
  assert.equal(gladys.lastState(`${BOX_ID}:app`), '12');

  lan.roku(LAN.box.ip).activeApp = 'active-app-pluto.xml';
  await time.advance(POLL_FREQUENCY_MS);
  assert.equal(gladys.lastState(`${BOX_ID}:app`), '74519', 'no onPoll, the timer read it');
  assert.equal(gladys.sceneEvents.at(-1).data.app_id, '74519');

  // And it keeps going, every POLL_FREQUENCY_MS.
  const before = reads(lan, LAN.tv.ip);
  await time.advance(3 * POLL_FREQUENCY_MS);
  assert.equal(reads(lan, LAN.tv.ip) - before, 3);
  app.shutdown();
});

test('a Roku the core polls is not read a second time by the timer', async () => {
  const { time, gladys, lan, app } = await startCreated();
  const box = { external_id: BOX_ID };
  const boxBefore = reads(lan, LAN.box.ip);
  const tvBefore = reads(lan, LAN.tv.ip);
  // The core polls the box every 10 s (a working core); the TV is never polled.
  for (let i = 0; i < 6; i += 1) {
    await time.advance(POLL_FREQUENCY_MS / 2);
    await gladys.handlers.poll(box);
    await time.advance(POLL_FREQUENCY_MS / 2);
  }
  assert.equal(
    reads(lan, LAN.box.ip) - boxBefore,
    6,
    'one read per core poll, none from the timer',
  );
  assert.equal(reads(lan, LAN.tv.ip) - tvBefore, 6, 'the timer reads the TV');
  app.shutdown();
});

test('a deleted device is no longer read, and shutdown stops the timer', async () => {
  const { time, gladys, lan, app } = await startCreated();
  gladys.devices = gladys.devices.filter((device) => device.external_id !== TV_ID);
  const before = reads(lan, LAN.tv.ip);
  await time.advance(3 * POLL_FREQUENCY_MS);
  assert.equal(reads(lan, LAN.tv.ip), before);

  app.shutdown();
  const boxBefore = reads(lan, LAN.box.ip);
  await time.advance(3 * POLL_FREQUENCY_MS);
  assert.equal(reads(lan, LAN.box.ip), boxBefore);
});

test('a normal cycle writes nothing at info level', async (t) => {
  const { time, gladys, lan, app } = await startCreated();
  const lines = captureLogs(t);
  // A few minutes of use: app changes, states and scene events published,
  // core polls and commands in between.
  const box = lan.roku(LAN.box.ip);
  for (const file of [
    'active-app-pluto.xml',
    'active-app-dynamic-menu.xml',
    'active-app-netflix.xml',
  ]) {
    box.activeApp = file;
    await time.advance(POLL_FREQUENCY_MS);
    await gladys.handlers.poll({ external_id: TV_ID });
  }
  await gladys.handlers.setValue({ external_id: BOX_ID }, { external_id: `${BOX_ID}:key:home` }, 1);
  await time.advance(10 * POLL_FREQUENCY_MS);
  assert.ok(gladys.sceneEvents.length >= 3, 'the cycle did publish');
  assert.deepEqual(lines, []);
  app.shutdown();
});

test('a repeated failure is logged once, and once when it is over', async (t) => {
  const { time, gladys, lan, app } = await startCreated();
  const lines = captureLogs(t);

  // The TV is unplugged for a minute: one line, not one per read.
  const tv = lan.roku(LAN.tv.ip);
  lan.remove(LAN.tv.ip);
  await time.advance(6 * POLL_FREQUENCY_MS);
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /not reachable/);
  lan.add(LAN.tv.ip, tv);
  await time.advance(POLL_FREQUENCY_MS);
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /reachable again/);

  // Gladys refuses the states for a while: one warning, one line on return.
  const publishStates = gladys.publishStates;
  gladys.publishStates = async () => {
    throw new Error('429 TOO_MANY_REQUESTS');
  };
  const box = lan.roku(LAN.box.ip);
  for (const file of ['active-app-pluto.xml', 'active-app-netflix.xml', 'active-app-pluto.xml']) {
    box.activeApp = file;
    await time.advance(POLL_FREQUENCY_MS);
  }
  assert.equal(lines.length, 3, lines.join('\n'));
  assert.match(lines[2], /States not sent to Gladys: 429/);
  gladys.publishStates = publishStates;
  // The Roku stays on Pluto TV: the state Gladys refused is sent with the next read.
  await time.advance(POLL_FREQUENCY_MS);
  assert.equal(lines.length, 4, lines.join('\n'));
  assert.match(lines[3], /States sent to Gladys again/);
  assert.equal(gladys.lastState(`${BOX_ID}:app`), '74519');
  app.shutdown();
});

test('Limited mode is reported once, not on every read', async (t) => {
  const { time, lan, app } = await startCreated();
  const lines = captureLogs(t);
  lan.roku(LAN.tv.ip).fail = 'forbidden';
  await time.advance(5 * POLL_FREQUENCY_MS);
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0], /ECP refused/);
  delete lan.roku(LAN.tv.ip).fail;
  await time.advance(POLL_FREQUENCY_MS);
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[1], /remote control accepted again/);
  app.shutdown();
});

test('the SDK fake Gladys (host API checks) accepts the devices and their states', async () => {
  // The SDK 0.15 fake validates like the core: prefix, category/type/unit,
  // poll_frequency among DEVICE_POLL_FREQUENCIES, state shapes.
  const sdk = createSdkFakeGladys({ selector: 'roku-test' });
  await sdk.connect();
  const lan = createReferenceLan();
  const manager = new RokuManager(sdk, { createClient: lan.createClient, schedule: () => 0 });
  await manager.discover({ hosts: Object.values(LAN).map((roku) => roku.ip) }, { ssdp: false });
  await manager.publishDiscovered();
  assert.equal(sdk.fake.discoveredDevices.length, 3);
  for (const device of sdk.fake.discoveredDevices) {
    assert.equal(device.should_poll, true);
    assert.ok(Object.values(DEVICE_POLL_FREQUENCIES).includes(device.poll_frequency));
  }
  for (const roku of Object.values(LAN)) {
    await manager.refresh(roku.serial);
  }
  assert.equal(sdk.fake.lastState(`${BOX_ID}:app`), '12');
  manager.stop();
  await sdk.disconnect();
});
