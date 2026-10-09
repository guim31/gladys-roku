// Configuration normalization, messages and widget nudges.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';
import { explainError, explainErrorShort } from '../src/messages.js';
import { NUDGE_INTERVAL_MS, createWidgetNudger } from '../src/nudger.js';
import { RokuError } from '../src/ecp/client.js';

test('addresses: separators, duplicates, pasted URLs, invalid entries', () => {
  assert.deepEqual(parseHosts('192.168.1.40, 192.168.1.41;192.168.1.40  roku.local'), {
    hosts: ['192.168.1.40', '192.168.1.41', 'roku.local'],
    invalid: [],
  });
  assert.deepEqual(parseHosts('http://192.168.1.40:8060/ 999.1.1.1 a/b'), {
    hosts: ['192.168.1.40'],
    invalid: ['999.1.1.1', 'a/b'],
  });
  assert.deepEqual(parseHosts(undefined), { hosts: [], invalid: [] });
});

test('normalized config', () => {
  assert.deepEqual(normalizeConfig(), { hosts: [], invalidHosts: [], debug_logs: false });
  assert.deepEqual(normalizeConfig({ hosts: '192.0.2.1', debug_logs: true }), {
    hosts: ['192.0.2.1'],
    invalidHosts: [],
    debug_logs: true,
  });
  assert.equal(normalizeConfig({ debug_logs: 'true' }).debug_logs, true);
  assert.deepEqual(Object.keys(DEFAULT_CONFIG).sort(), ['debug_logs', 'hosts']);
});

test('every error kind has a bilingual explanation', () => {
  for (const kind of ['forbidden', 'refused', 'timeout', 'unreachable', 'http', 'malformed']) {
    const err = new RokuError('boom', { kind, ip: '192.0.2.1' });
    const full = explainError(err, 'Living room TV');
    assert.ok(full.en && full.fr, kind);
    const short = explainErrorShort(err);
    assert.ok(short.en.length <= 200 && short.fr.length <= 200, `${kind}: toast too long`);
  }
  assert.deepEqual(explainError(new Error('plain')), { en: 'plain', fr: 'plain' });
});

test('widget nudges: at most one per widget every 10 s, the last one never lost', () => {
  const sent = [];
  const timers = [];
  let clock = 0;
  const nudger = createWidgetNudger(
    { requestWidgetRefresh: (key) => sent.push(key) },
    ['remote', 'media'],
    {
      now: () => clock,
      schedule: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
    },
  );
  nudger.nudgeAll();
  assert.deepEqual(sent, ['remote', 'media']);
  clock += 3000;
  nudger.nudge('remote');
  nudger.nudge('remote');
  assert.deepEqual(sent, ['remote', 'media'], 'throttled');
  assert.equal(timers.length, 1, 'one trailing nudge');
  assert.equal(timers[0].ms, NUDGE_INTERVAL_MS - 3000);
  clock += 7000;
  timers[0].fn();
  assert.deepEqual(sent, ['remote', 'media', 'remote']);
  nudger.stop();
});
