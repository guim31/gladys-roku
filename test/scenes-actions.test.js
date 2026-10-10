// Scene actions, the app_changed trigger data, and the test_connection action.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RokuManager } from '../src/manager.js';
import { appChangedEvent, createSceneActions } from '../src/scenes.js';
import { testConnection } from '../src/actions.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { LAN, createReferenceLan } from './helpers/fakeRoku.js';

async function setup({ discover = true } = {}) {
  const gladys = createFakeGladys();
  const lan = createReferenceLan();
  const manager = new RokuManager(gladys, {
    createClient: lan.createClient,
    schedule: () => 0,
    sleep: async () => {},
  });
  if (discover) {
    await manager.discover({ hosts: Object.values(LAN).map((roku) => roku.ip) }, { ssdp: false });
  }
  return { gladys, lan, manager, actions: createSceneActions(manager) };
}

const deviceOf = (serial) => `ext:roku-test:roku:${serial}`;

test('launch_app opens an app by name and outputs what it opened', async () => {
  const { lan, actions } = await setup();
  lan.calls.length = 0;
  const outputs = await actions.launch_app({ device: deviceOf(LAN.box.serial), app: 'Pluto TV' });
  assert.deepEqual(outputs, { app_id: '74519', app_name: "Pluto TV - It's Free TV" });
  assert.deepEqual(lan.calls, [{ ip: LAN.box.ip, op: 'launch', arg: '74519' }]);
  await actions.launch_app({ device: deviceOf(LAN.box.serial), app: 'home' });
  assert.deepEqual(lan.calls.at(-1), { ip: LAN.box.ip, op: 'keypress', arg: 'Home' });
});

test('launch_app re-reads the app list before saying an app is missing', async () => {
  const { lan, actions } = await setup();
  lan.calls.length = 0;
  await assert.rejects(
    actions.launch_app({ device: deviceOf(LAN.box.serial), app: 'Hulu' }),
    /"Hulu" is not installed on My Roku 3\. Installed: Roku Channel Store, Netflix/,
  );
  assert.deepEqual(
    lan.calls.map((call) => call.op),
    ['apps'],
  );
  await assert.rejects(
    actions.launch_app({ device: deviceOf('NOPE'), app: 'Netflix' }),
    /Unknown Roku/,
  );
});

test('send_key presses a key a number of times, or powers a Roku TV', async () => {
  const { lan, actions } = await setup();
  lan.calls.length = 0;
  await actions.send_key({ device: deviceOf(LAN.tv.serial), key: 'volume_down', times: 3 });
  await actions.send_key({ device: deviceOf(LAN.tv.serial), key: 'power_off' });
  await actions.send_key({ device: deviceOf(LAN.tv.serial), key: 'select', times: 500 });
  const ops = lan.calls.map((call) => call.arg);
  assert.deepEqual(ops.slice(0, 4), ['VolumeDown', 'VolumeDown', 'VolumeDown', 'PowerOff']);
  assert.equal(ops.filter((key) => key === 'Select').length, 20, 'capped at 20');
  await assert.rejects(
    actions.send_key({ device: deviceOf(LAN.tv.serial), key: 'self_destruct' }),
    /Unknown key/,
  );
});

test('app_changed data is flat: device, app name, app id', () => {
  assert.deepEqual(appChangedEvent('ext:x:roku:S', { id: '12', name: 'Netflix', home: false }), {
    device: 'ext:x:roku:S',
    app: 'Netflix',
    app_id: '12',
  });
  assert.equal(appChangedEvent('d', { id: 'home', name: 'Home', home: true }).app, 'Home');
});

test('test_connection: a typed address joins the Discovery tab', async () => {
  const { gladys, manager } = await setup({ discover: false });
  const message = await testConnection({
    fields: { ip: LAN.tv.ip },
    manager,
    config: { hosts: [] },
  });
  assert.match(
    message.en,
    /TCL•Roku TV - TVX000000003 \(192\.0\.2\.30\): TCL TCL•Roku TV, Roku OS 11\.5\.0, on/,
  );
  assert.match(message.en, /Remote control accepted/);
  assert.match(message.en, /Discovery tab/);
  assert.match(message.fr, /Contrôle à distance accepté/);
  assert.equal(gladys.discovered.length, 1);
});

test('test_connection explains a refusing Roku and an absent one', async () => {
  const { lan, manager } = await setup();
  lan.roku(LAN.box.ip).fail = 'forbidden';
  const refused = await testConnection({
    fields: { device: deviceOf(LAN.box.serial) },
    manager,
    config: { hosts: [] },
  });
  assert.match(refused.en, /Control by mobile apps > Network access/);
  assert.match(refused.fr, /Contrôle par applications mobiles/);

  const absent = await testConnection({
    fields: { ip: '192.0.2.250' },
    manager,
    config: { hosts: [] },
  });
  assert.match(absent.en, /does not answer/);

  const invalid = await testConnection({
    fields: { ip: 'roku please' },
    manager,
    config: { hosts: [] },
  });
  assert.match(invalid.en, /not an IP address/);
});

test('test_connection without fields tests every known Roku', async () => {
  const { manager } = await setup();
  const message = await testConnection({ fields: {}, manager, config: { hosts: [] } });
  assert.equal(message.en.split('\n').length, 3);
  const nothing = await testConnection({
    fields: {},
    manager: new RokuManager(createFakeGladys()),
    config: { hosts: [] },
  });
  assert.match(nothing.en, /No Roku known yet/);
});

test('type_text types one Lit_ key per character, and never logs the text', async () => {
  const { lan, actions } = await setup();
  lan.calls.length = 0;
  await actions.type_text({ device: deviceOf(LAN.box.serial), text: 'Kiké 2@x' });
  assert.deepEqual(
    lan.calls.map((call) => call.arg),
    ['Lit_K', 'Lit_i', 'Lit_k', 'Lit_é', 'Lit_ ', 'Lit_2', 'Lit_@', 'Lit_x'],
  );
  await assert.rejects(
    actions.type_text({ device: deviceOf(LAN.box.serial), text: '' }),
    /No text/,
  );
  await assert.rejects(
    actions.type_text({ device: deviceOf(LAN.box.serial), text: 'x'.repeat(101) }),
    /100 at most/,
  );
});
