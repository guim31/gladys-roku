// -----------------------------------------------------------------------------
// Conformance of the published devices to the rules of the Gladys core.
//
// Every Roku discovered from realistic device answers (a box, a stick, two
// Roku TVs, one in standby) is checked against test/fixtures/
// gladys-feature-table.json, the table drawn from the core code: a couple
// missing there is a feature the front cannot label or draw, a poll frequency
// outside the list a 400, a missing min/max an HTTP 422 on "Add to Gladys".
//
// Do not edit this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RokuManager } from '../src/manager.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { createFakeLan, fixture } from './helpers/fakeRoku.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const REFERENCE_ROKUS = {
  'Roku 3 (box)': {
    deviceInfo: 'device-info-box.xml',
    apps: 'apps.xml',
    activeApp: 'active-app-netflix.xml',
    media: 'media-player-amazon-play.xml',
  },
  'Roku Stick': {
    deviceInfo: 'device-info-stick.xml',
    apps: 'apps.xml',
    activeApp: 'active-app-roku.xml',
    media: 'media-player-close.xml',
  },
  'TCL Roku TV': {
    deviceInfo: 'device-info-tv.xml',
    apps: 'apps-tv.xml',
    activeApp: 'active-app-tv.xml',
    media: 'media-player-close.xml',
  },
  'onn. Roku TV': {
    deviceInfo: 'device-info-tv-onn.xml',
    apps: 'apps-tv.xml',
    activeApp: 'active-app-pluto.xml',
    media: 'media-player-pluto-live.xml',
  },
  'Roku TV in standby': {
    deviceInfo: 'device-info-tv-standby.xml',
    apps: 'apps-tv.xml',
    activeApp: 'active-app-roku.xml',
    media: 'media-player-close.xml',
  },
};

async function discoveredDevices() {
  const spec = {};
  Object.values(REFERENCE_ROKUS).forEach((roku, index) => {
    spec[`192.0.2.${100 + index}`] = roku;
  });
  const lan = createFakeLan(spec);
  const gladys = createFakeGladys();
  const manager = new RokuManager(gladys, { createClient: lan.createClient });
  await manager.discover({ hosts: Object.keys(spec) }, { ssdp: false });
  await manager.publishDiscovered();
  return gladys.discovered;
}

const devices = await discoveredDevices();

test('every reference Roku is discovered', () => {
  assert.equal(devices.length, Object.keys(REFERENCE_ROKUS).length);
  // The TV fixtures differ from the players: the checks below cover both.
  assert.ok(fixture('device-info-tv.xml').includes('<is-tv>true</is-tv>'));
});

for (const device of devices) {
  test(`${device.name}: every category/type couple is known to the core, with labels and icon`, () => {
    for (const feature of device.features) {
      const couple = `${feature.category}/${feature.type}`;
      assert.ok(table.categories.includes(feature.category), `${couple}: unknown category`);
      assert.ok(table.types.includes(feature.type), `${couple}: unknown type`);
      const entry = table.pairs[couple];
      assert.ok(entry, `${couple} is not in the feature table`);
      assert.ok(entry.label_en && entry.label_fr, `${couple}: no label`);
      assert.ok(entry.icon, `${couple}: no icon`);
    }
  });

  test(`${device.name}: should_poll iff poll_frequency, in milliseconds from the core list`, () => {
    const hasFrequency = device.poll_frequency !== undefined;
    assert.equal(
      device.should_poll === true,
      hasFrequency,
      'should_poll and poll_frequency go together',
    );
    if (hasFrequency) {
      assert.ok(
        table.poll_frequencies_ms.includes(device.poll_frequency),
        `poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
      );
    }
  });

  test(`${device.name}: min/max numbers, boolean flags, known units`, () => {
    for (const feature of device.features) {
      const id = feature.external_id;
      assert.equal(typeof feature.min, 'number', `${id}: min must be a number`);
      assert.equal(typeof feature.max, 'number', `${id}: max must be a number`);
      assert.ok(feature.min <= feature.max, `${id}: min > max`);
      assert.equal(typeof feature.read_only, 'boolean', `${id}: read_only must be a boolean`);
      assert.equal(typeof feature.has_feedback, 'boolean', `${id}: has_feedback must be a boolean`);
      if (feature.unit !== undefined && feature.unit !== null) {
        assert.ok(table.units.includes(feature.unit), `${id}: unknown unit ${feature.unit}`);
      }
    }
  });

  test(`${device.name}: unique feature external ids and distinct names`, () => {
    const ids = device.features.map((feature) => feature.external_id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate feature external_id');
    const names = device.features.map((feature) => feature.name);
    assert.equal(new Set(names).size, names.length, 'duplicate feature name');
    for (const id of ids) {
      assert.ok(id.startsWith(`${device.external_id}:`), `${id} is not under the device id`);
    }
  });
}
