// Dashboard widgets: contents within the core vocabulary and budget, actions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { RokuManager } from '../src/manager.js';
import {
  APP_SETTINGS,
  WIDGET_KEYS,
  chosenApps,
  clock,
  createWidgetHandlers,
  emptyContent,
  iconKey,
  widgetCommand,
} from '../src/widgets.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { LAN, createReferenceLan } from './helpers/fakeRoku.js';

async function setup() {
  const gladys = createFakeGladys();
  const lan = createReferenceLan();
  const manager = new RokuManager(gladys, {
    createClient: lan.createClient,
    schedule: () => 0,
    sleep: async () => {},
  });
  await manager.discover({ hosts: Object.values(LAN).map((roku) => roku.ip) }, { ssdp: false });
  for (const roku of Object.values(LAN)) {
    await manager.refresh(roku.serial);
  }
  return { gladys, lan, manager, widgets: createWidgetHandlers(manager) };
}

const deviceOf = (serial) => `ext:roku-test:roku:${serial}`;

function assertFits(content, label) {
  assert.deepEqual(validateWidgetContent(content), [], `${label}: rendered exactly as sent`);
  const actionKeys = content.components
    .filter((component) => component.type === 'button')
    .map((component) => component.action.key);
  assert.equal(new Set(actionKeys).size, actionKeys.length, `${label}: duplicate action key`);
  for (const component of content.components) {
    if (component.type === 'image') {
      assert.match(component.key, /^[a-z0-9][a-z0-9-]{0,63}$/);
    }
    for (const item of component.items ?? []) {
      if (item.image) {
        assert.match(item.image, /^[a-z0-9][a-z0-9-]{0,63}$/);
      }
    }
    // Never `primary` to mark a state: invisible in dark mode.
    assert.notEqual(component.style, 'primary');
  }
}

test('every widget fits the core budget, for every reference Roku and language', async () => {
  const { widgets } = await setup();
  for (const roku of Object.values(LAN)) {
    for (const key of WIDGET_KEYS) {
      for (const language of ['en', 'fr']) {
        const content = await widgets.get(key, {
          settings: { device: deviceOf(roku.serial) },
          language,
        });
        assertFits(content, `${key} / ${roku.serial} / ${language}`);
      }
    }
  }
});

test('remote: Power on a Roku TV, OK on a player, and a "Keys…" form', async () => {
  const { widgets } = await setup();
  const tv = await widgets.get('remote', { settings: { device: deviceOf(LAN.tv.serial) } });
  const tvKeys = tv.components.filter((c) => c.type === 'button').map((c) => c.action.key);
  assert.deepEqual(tvKeys, ['power', 'home', 'back', 'keys']);
  const form = tv.components.find((c) => c.action?.key === 'keys').action.fields;
  const values = form[0].options.map((option) => option.value);
  assert.ok(values.includes('volume_mute') && values.includes('power_on'));

  const box = await widgets.get('remote', { settings: { device: deviceOf(LAN.box.serial) } });
  const boxKeys = box.components.filter((c) => c.type === 'button').map((c) => c.action.key);
  assert.deepEqual(boxKeys, ['home', 'back', 'ok', 'keys']);
  const boxForm = box.components.find((c) => c.action?.key === 'keys').action.fields;
  assert.ok(!boxForm[0].options.some((option) => option.value === 'volume_up'));
  const status = box.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items[1], { label: { en: 'App', fr: 'Application' }, value: 'Netflix' });
});

test('media: the app icon, the playback state and position', async () => {
  const { widgets } = await setup();
  const content = await widgets.get('media', { settings: { device: deviceOf(LAN.box.serial) } });
  const image = content.components.find((c) => c.type === 'image');
  assert.equal(image.key, 'icon-12-0');
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.equal(rows[1].value.en, 'Playing');
  assert.equal(rows[2].value, '0:31');
});

test('apps: the first installed apps by default, with icons, the current one marked', async () => {
  const { widgets } = await setup();
  const content = await widgets.get('apps', { settings: { device: deviceOf(LAN.box.serial) } });
  const grid = content.components.find((c) => c.type === 'card-list');
  assert.deepEqual(
    grid.items.map((item) => item.title),
    ['Roku Channel Store', 'Netflix', 'Amazon Video on Demand', 'MLB.TV®'],
  );
  assert.ok(grid.items[1].badge, 'Netflix is in the foreground');
  const buttons = content.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.action.key),
    APP_SETTINGS,
  );
  assert.equal(buttons[1].icon, 'check-circle');
  assert.deepEqual(buttons[1].action.params, { serial: LAN.box.serial, app: '12' });
});

test('apps: names from the settings, unknown names said in a caption', async () => {
  const { manager, widgets } = await setup();
  const settings = {
    device: deviceOf(LAN.box.serial),
    app_1: 'pluto',
    app_2: 'Hulu',
    app_3: 'netflix',
  };
  const content = await widgets.get('apps', { settings, language: 'fr' });
  assert.equal(content.components[1].text, 'Non installées : Hulu');
  const roku = manager.rokus.get(LAN.box.serial);
  const { apps, unknown } = chosenApps(roku, settings, (r, name) => manager.findApp(r, name));
  assert.deepEqual(
    apps.map((app) => app.id),
    ['74519', '12'],
  );
  assert.deepEqual(unknown, ['Hulu']);
});

test('no Roku, or an unknown one: a sentence, never an error', async () => {
  const empty = new RokuManager(createFakeGladys());
  const widgets = createWidgetHandlers(empty);
  assert.deepEqual(await widgets.get('remote', { settings: {} }), emptyContent('none'));
  assert.deepEqual(
    await widgets.get('media', { settings: { device: deviceOf('NOPE') } }),
    emptyContent('unknown'),
  );
  assertFits(emptyContent('none'), 'empty');
});

test('a refusing Roku says so in the widget', async () => {
  const { lan, manager, widgets } = await setup();
  lan.roku(LAN.box.ip).fail = 'forbidden';
  await manager.refresh(LAN.box.serial);
  const content = await widgets.get('remote', { settings: { device: deviceOf(LAN.box.serial) } });
  assert.equal(content.components[1].variant, 'caption');
  assert.equal(content.components.find((c) => c.type === 'status').items[0].value.en, 'Refused');
  assertFits(content, 'refused');
});

test('widget commands: only the declared buttons', () => {
  const params = { serial: 'S1' };
  assert.deepEqual(widgetCommand('power', params), { kind: 'power', serial: 'S1' });
  assert.deepEqual(widgetCommand('ok', params), {
    kind: 'key',
    serial: 'S1',
    ecp: 'Select',
    times: 1,
  });
  assert.deepEqual(widgetCommand('keys', params, { key: 'volume_up', times: 3 }), {
    kind: 'key',
    serial: 'S1',
    ecp: 'VolumeUp',
    times: 3,
  });
  assert.equal(widgetCommand('keys', params, { key: 'up', times: 99 }).times, 10);
  assert.deepEqual(widgetCommand('keys', params, { key: 'power_off' }), {
    kind: 'power',
    serial: 'S1',
    on: false,
  });
  assert.deepEqual(widgetCommand('app_2', { serial: 'S1', app: '12' }), {
    kind: 'app',
    serial: 'S1',
    app: '12',
  });
  assert.equal(widgetCommand('keys', params, { key: 'rm -rf' }), null);
  assert.equal(widgetCommand('app_9', { serial: 'S1', app: '12' }), null);
  assert.equal(widgetCommand('home', {}), null);
});

test('widget actions run the command and answer a toast', async () => {
  const { lan, widgets } = await setup();
  lan.calls.length = 0;
  const tv = { serial: LAN.tv.serial };
  assert.deepEqual(await widgets.action('remote', 'power', tv), {
    en: 'Turning the TV off…',
    fr: 'Extinction de la TV…',
  });
  await widgets.action('remote', 'keys', tv, { values: { key: 'volume_down', times: 2 } });
  const toast = await widgets.action('apps', 'app_1', { serial: LAN.box.serial, app: '12' });
  assert.equal(toast.en, 'Opening Netflix…');
  assert.deepEqual(
    lan.calls.map((call) => `${call.ip} ${call.op} ${call.arg}`),
    [
      `${LAN.tv.ip} keypress PowerOff`,
      `${LAN.tv.ip} keypress VolumeDown`,
      `${LAN.tv.ip} keypress VolumeDown`,
      `${LAN.box.ip} launch 12`,
    ],
  );

  lan.roku(LAN.tv.ip).failKeys = 'forbidden';
  const refused = await widgets.action('remote', 'home', tv);
  assert.match(refused.en, /Network access/);
  assert.ok(refused.en.length <= 200 && refused.fr.length <= 200);

  await assert.rejects(widgets.action('remote', 'keys', tv), /update Gladys/);
  await assert.rejects(widgets.action('remote', 'nope', tv), /Unknown widget action/);
});

test('app icons are relayed from the Roku and validated', async () => {
  const { lan, widgets } = await setup();
  const base64 = await widgets.image('icon-12-0');
  assert.ok(base64.startsWith('iVBORw0KGgo'));
  assert.ok(lan.calls.some((call) => call.op === 'icon' && call.arg === '12'));
  lan.roku(LAN.box.ip).icon = Buffer.from('not an image');
  await assert.rejects(widgets.image('icon-12-0'), /not usable/);
  await assert.rejects(widgets.image('icon-nope-0'), /Unknown image/);
});

test('icon keys follow the app version and stay within the core pattern', () => {
  assert.equal(iconKey({ id: 'tvinput.hdmi1', version: '1.0.0' }), 'icon-tvinput-hdmi1-1-0-0');
  assert.equal(iconKey({ id: '12', version: '' }), 'icon-12-0');
  const long = iconKey({ id: 'x'.repeat(80), version: '1' });
  assert.match(long, /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.equal(clock(3723000), '1:02:03');
  assert.equal(clock(59000), '0:59');
});
