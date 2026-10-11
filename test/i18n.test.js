// -----------------------------------------------------------------------------
// Every text shown to the user exists in the four languages of the Gladys
// interface (en, fr, de, es), is not empty and fits its bound: the manifest,
// and the message tables of the code.
//
// Gladys shows the user's language when a text has it, English otherwise: a
// missing language does not break anything, it silently shows English. This
// test is the only place that notices.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RokuManager } from '../src/manager.js';
import { RokuError } from '../src/ecp/client.js';
import { testConnection } from '../src/actions.js';
import {
  LANGUAGES,
  MESSAGES,
  UserError,
  explainError,
  explainErrorShort,
  sameInEveryLanguage,
} from '../src/messages.js';
import {
  WIDGET_TEMPLATES,
  WIDGET_TEXTS,
  WIDGET_TOASTS,
  createWidgetHandlers,
  lang,
} from '../src/widgets.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { LAN, createReferenceLan } from './helpers/fakeRoku.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const EXPECTED = ['de', 'en', 'es', 'fr'];

// The keys whose value is always a text shown to the user.
const TEXT_KEYS = new Set(['label', 'description', 'placeholder']);

// Bounds of the store schema and of the core, in characters per language.
const SECTION_MAX = 1000;
const TEXT_MAX = 300;
const TOAST_MAX = 200;

/**
 * Check a multi-language text: exactly the four languages, none empty, none
 * past the bound.
 */
function assertText(value, path, { min = 1, max = TEXT_MAX } = {}) {
  assert.ok(value && typeof value === 'object', `${path}: a multi-language object expected`);
  assert.deepEqual(Object.keys(value).sort(), EXPECTED, `${path}: languages`);
  for (const language of EXPECTED) {
    const text = value[language];
    assert.equal(typeof text, 'string', `${path}.${language}: a string expected`);
    const length = text.trim().length;
    assert.ok(length >= min, `${path}.${language}: ${length} characters, ${min} at least`);
    assert.ok(length <= max, `${path}.${language}: ${length} characters, ${max} at most`);
  }
}

/** The bound of a manifest text, from its path. */
function boundOf(path, parent) {
  if (path === 'description') {
    return { min: 10, max: 100 };
  }
  if (/^widgets\[\d+\]\.label$/.test(path)) {
    return { min: 3, max: 30 };
  }
  if (/^widgets\[\d+\]\.description$/.test(path)) {
    return { max: 100 };
  }
  if (parent?.type === 'section' && path.endsWith('.description')) {
    return { max: SECTION_MAX };
  }
  return { max: TEXT_MAX };
}

/**
 * Every text of the manifest: the values of the text keys (never a plain
 * string), and any other object carrying an `en` key.
 */
function manifestTexts(node, path = '', found = []) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => manifestTexts(item, `${path}[${index}]`, found));
    return found;
  }
  if (!node || typeof node !== 'object') {
    return found;
  }
  for (const [key, value] of Object.entries(node)) {
    const childPath = path ? `${path}.${key}` : key;
    if (TEXT_KEYS.has(key) || (value && typeof value === 'object' && 'en' in value)) {
      found.push({ path: childPath, value, bound: boundOf(childPath, node) });
    } else {
      manifestTexts(value, childPath, found);
    }
  }
  return found;
}

test('every text of the manifest exists in en, fr, de and es, within its bound', () => {
  const texts = manifestTexts(manifest);
  // A walk that finds nothing would pass: the manifest holds 81 texts.
  assert.ok(texts.length >= 81, `only ${texts.length} texts found`);
  for (const { path, value, bound } of texts) {
    assertText(value, path, bound);
  }
});

test('no language key hides elsewhere in the manifest', () => {
  // An object holding `fr` but no `en` would escape the walk above.
  const stray = [];
  (function walk(node, path) {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
    } else if (node && typeof node === 'object') {
      if (['fr', 'de', 'es'].some((language) => language in node) && !('en' in node)) {
        stray.push(path);
      }
      Object.entries(node).forEach(([key, value]) => walk(value, `${path}.${key}`));
    }
  })(manifest, '');
  assert.deepEqual(stray, []);
});

test('the code speaks the four languages of the manifest', () => {
  assert.deepEqual([...LANGUAGES].sort(), EXPECTED);
  assert.equal(LANGUAGES[0], 'en', 'English first: the fallback');
  assert.deepEqual(sameInEveryLanguage('Netflix'), {
    en: 'Netflix',
    fr: 'Netflix',
    de: 'Netflix',
    es: 'Netflix',
  });
  assert.equal(lang('de'), 'de');
  assert.equal(lang('es-ES'), 'es');
  assert.equal(lang('it'), 'en');
  assert.equal(lang(undefined), 'en');
});

// Where each widget text is shown, hence its bound (SDK TEXT_BOUNDS).
const WIDGET_TEXT_BOUNDS = {
  noRoku: 300, // body
  unknownRoku: 300, // body
  noApp: 300, // body
  forbidden: 80, // caption
  now: 16, // badge
  // Status labels and values.
  power: 40,
  on: 40,
  standby: 40,
  unreachable: 40,
  refused: 40,
  app: 40,
  input: 40,
  playback: 40,
  playing: 40,
  paused: 40,
  stopped: 40,
  position: 40,
  live: 40,
  // Button labels (home is a status value too).
  home: 24,
  turnOn: 24,
  turnOff: 24,
  back: 24,
  ok: 24,
  up: 24,
  down: 24,
  left: 24,
  right: 24,
  playPause: 24,
  rewind: 24,
  forward: 24,
};

test('every widget text exists in the four languages, within its bound', () => {
  assert.deepEqual(Object.keys(WIDGET_TEXTS).sort(), Object.keys(WIDGET_TEXT_BOUNDS).sort());
  for (const [key, value] of Object.entries(WIDGET_TEXTS)) {
    assertText(value, `WIDGET_TEXTS.${key}`, { max: WIDGET_TEXT_BOUNDS[key] });
  }
  for (const [key, value] of Object.entries(WIDGET_TOASTS)) {
    assertText(value, `WIDGET_TOASTS.${key}`, { max: TOAST_MAX });
  }
  for (const [key, template] of Object.entries(WIDGET_TEMPLATES)) {
    assert.deepEqual(Object.keys(template).sort(), EXPECTED, `WIDGET_TEMPLATES.${key}`);
    const filled = Object.fromEntries(
      EXPECTED.map((language) => [language, template[language]('X')]),
    );
    assertText(filled, `WIDGET_TEMPLATES.${key}`, { max: TOAST_MAX });
    for (const language of EXPECTED) {
      assert.match(filled[language], /X/, `WIDGET_TEMPLATES.${key}.${language}: value dropped`);
    }
  }
});

test('every fixed message and every error explanation exists in the four languages', () => {
  for (const [key, value] of Object.entries(MESSAGES)) {
    assertText(value, `MESSAGES.${key}`, { max: TOAST_MAX });
    assert.deepEqual(explainError(new UserError(value)), value, `UserError ${key}`);
  }
  for (const kind of ['forbidden', 'refused', 'timeout', 'unreachable', 'http', 'malformed']) {
    const err = new RokuError('boom', { kind, ip: '192.0.2.1' });
    assertText(explainError(err), `explainError(${kind})`, { max: 1000 });
    assertText(explainError(err, 'Living room'), `explainError(${kind}, label)`, { max: 1000 });
    assertText(explainErrorShort(err), `explainErrorShort(${kind})`, { max: TOAST_MAX });
  }
  assertText(explainError(new Error('plain')), 'explainError(plain)');
});

async function setup() {
  const lan = createReferenceLan();
  const manager = new RokuManager(createFakeGladys(), {
    createClient: lan.createClient,
    schedule: () => 0,
    sleep: async () => {},
  });
  return { lan, manager };
}

test('every answer of the test_connection action exists in the four languages', async () => {
  const empty = await setup();
  const config = { hosts: [] };
  const answers = {
    none: await testConnection({ fields: {}, manager: empty.manager, config }),
    notAnIp: await testConnection({ fields: { ip: 'tv' }, manager: empty.manager, config }),
    unknownDevice: await testConnection({
      fields: { device: 'ext:roku-test:roku:NOPE' },
      manager: empty.manager,
      config,
    }),
    newRoku: await testConnection({ fields: { ip: LAN.tv.ip }, manager: empty.manager, config }),
    absent: await testConnection({
      fields: { ip: '192.0.2.250' },
      manager: empty.manager,
      config,
    }),
  };
  const { lan, manager } = await setup();
  await manager.discover({ hosts: Object.values(LAN).map((roku) => roku.ip) }, { ssdp: false });
  answers.every = await testConnection({ fields: {}, manager, config });
  lan.roku(LAN.box.ip).fail = 'forbidden';
  answers.refused = await testConnection({ fields: { ip: LAN.box.ip }, manager, config });
  for (const [name, answer] of Object.entries(answers)) {
    assertText(answer, `test_connection ${name}`, { max: 2000 });
  }
  assert.match(answers.newRoku.de, /Fernsteuerung akzeptiert/);
  assert.match(answers.newRoku.es, /pestaña Descubrir/);
});

test('every widget toast exists in the four languages', async () => {
  const { lan, manager } = await setup();
  await manager.discover({ hosts: Object.values(LAN).map((roku) => roku.ip) }, { ssdp: false });
  const widgets = createWidgetHandlers(manager);
  const tv = { serial: LAN.tv.serial };
  const toasts = {
    power: await widgets.action('remote', 'power', tv),
    key: await widgets.action('remote', 'home', tv),
    app: await widgets.action('apps', 'app_1', { serial: LAN.box.serial, app: '12' }),
  };
  lan.roku(LAN.tv.ip).failKeys = 'forbidden';
  toasts.refused = await widgets.action('remote', 'home', tv);
  for (const [name, toast] of Object.entries(toasts)) {
    assertText(toast, `toast ${name}`, { max: TOAST_MAX });
  }
});
