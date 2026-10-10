// The first real feedback (Roku Express 4K, Roku OS 15.3.4, Gladys 5.1.4),
// replayed against a simulation of the core's widget path: a minute of use
// with the three widgets on the dashboard, then the playback buttons.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { LAN, createReferenceLan } from './helpers/fakeRoku.js';
import { MAX_PULLS_PER_MINUTE, createFakeCore, createVirtualTime } from './helpers/fakeCore.js';

async function testerSession() {
  const time = createVirtualTime();
  const gladys = createFakeGladys({ config: { hosts: LAN.box.ip } });
  gladys.scanResults.ssdp = [];
  const lan = createReferenceLan();
  const roku = lan.roku(LAN.box.ip);
  roku.media = 'media-player-close.xml';
  const app = createApp(
    gladys,
    {
      createClient: lan.createClient,
      now: time.now,
      schedule: time.schedule,
      sleep: async () => {},
    },
    { now: time.now, schedule: time.schedule },
  );
  const core = createFakeCore(gladys, time);
  await gladys.handlers.on.connected();
  const device = gladys.discovered[0];
  await gladys.handlers.deviceCreated(device);
  await core.openBoxes();

  // The core polls every 10 s; the user acts in between.
  const poll = () => gladys.handlers.poll(device);
  const steps = [
    ['remote', 'home', () => (roku.activeApp = 'active-app-dynamic-menu.xml')],
    ['apps', 'app_2', () => (roku.activeApp = 'active-app-netflix.xml')],
    [null, null, () => (roku.activeApp = 'active-app-pluto.xml')], // physical remote
    [null, null, () => (roku.activeApp = 'active-app-dynamic-menu.xml')], // physical Home
    ['apps', 'app_2', () => (roku.activeApp = 'active-app-netflix.xml')],
    ['remote', 'back', () => {}],
  ];
  for (const [key, actionKey, effect] of steps) {
    if (key) {
      await core.tap(key, actionKey);
    }
    effect();
    await time.advance(5000);
    await poll();
    await time.advance(5000);
  }
  lan.calls.length = 0;
  const playback = [];
  for (const actionKey of ['play_pause', 'replay', 'rewind', 'forward']) {
    playback.push(await core.tap('media', actionKey));
    await time.advance(2000);
  }
  app.shutdown();
  return { core, lan, gladys, playback };
}

test('after a minute of use, every playback button of the media widget reaches the Roku', async () => {
  const { core, lan, playback } = await testerSession();
  assert.deepEqual(
    core.refusedActions,
    [],
    `refused by the core: ${JSON.stringify(core.refusedActions)}`,
  );
  assert.deepEqual(
    lan.calls.filter((call) => call.op === 'keypress').map((call) => call.arg),
    ['Play', 'InstantReplay', 'Rev', 'Fwd'],
  );
  for (const result of playback) {
    assert.deepEqual(result.message, {
      en: 'Key sent to the Roku.',
      fr: 'Touche envoyée au Roku.',
    });
  }
});

test('the widgets stay well under the core budget of 30 content pulls per minute', async () => {
  const { core } = await testerSession();
  assert.equal(core.refusedPulls, 0);
  // A third of the budget left for the other dashboards and the TTLs.
  const peak = core.maxPullsPerMinute();
  assert.ok(peak <= (MAX_PULLS_PER_MINUTE * 2) / 3, `${peak} pulls in one minute`);
});
