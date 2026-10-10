// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+).
//
//   - remote : power / app / input of a Roku, then Power (Roku TV) or
//              Play/Pause (player), Home, Back and OK (a widget holds 4
//              buttons at most; every other key is a feature of the device);
//   - media  : the foreground app, its icon, the playback state and position,
//              then play/pause, rewind, fast forward, instant replay;
//   - navigation: the four arrows, to place next to the remote (OK, Back and
//              Home are there: a widget holds 4 buttons, a form behind a
//              button is not in any released Gladys yet);
//   - apps   : up to four app shortcuts (named in the widget settings, the
//              first installed apps otherwise), shown with their icons in a
//              grid, the foreground one marked.
//
// A widget shows the Roku picked in its `device` setting (a `source: "devices"`
// select: the device external id), else the first known Roku. Its buttons
// carry the serial number in their params; onWidgetAction only accepts the
// action keys of widgetCommand().
//
// Core budget: 8 components, 1 focal (image or card-list), 2 texts, 1 status,
// 4 buttons, a button dropped when its action key is already used. A current
// choice is shown by its icon (`check-circle`), never by the `primary` style
// (invisible in dark mode). App icons are served by the Roku itself
// (/query/icon/<id>) and relayed through onWidgetGetImage.
//
// The core re-pulls a content at most 30 times a minute per integration, and
// counts the refused attempts too: beyond, it answers 429 and a tap on a
// button never reaches the integration (it re-reads the content to check the
// action key). So the TTLs are long and a widget is only nudged when what it
// shows changed (widgetSignatures()).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { HOME_APP_ID, isTvInput } from './ecp/parse.js';
import { explainErrorShort } from './messages.js';

/** Widget keys, declared in the manifest `widgets` (forever: never rename). */
export const WIDGET = {
  REMOTE: 'remote',
  MEDIA: 'media',
  APPS: 'apps',
  NAVIGATION: 'navigation',
};

/** The settings naming the apps of the apps widget (forever). */
export const APP_SETTINGS = ['app_1', 'app_2', 'app_3', 'app_4'];

// Content freshness, in seconds. The nudges follow the changes: the TTL only
// catches up with a missed one, and with the playback position, which drifts
// without being a change.
export const WIDGET_TTL_SECONDS = {
  remote: 600,
  media: 120,
  apps: 900,
  navigation: 3600,
  empty: 300,
};

const CURRENT_ICON = 'check-circle';

const T = {
  noRoku: {
    en: 'No Roku known yet. Run a device scan in the integration (Discovery tab), then pick the Roku in the settings of this widget.',
    fr: "Aucun Roku connu pour l'instant. Lancez une recherche d'appareils dans l'intégration (onglet Découverte), puis choisissez le Roku dans les réglages de ce widget.",
  },
  unknownRoku: {
    en: 'The Roku picked in the settings of this widget is not reachable by the integration yet. Run a device scan, or pick another one.',
    fr: "Le Roku choisi dans les réglages de ce widget n'est pas encore joignable par l'intégration. Lancez une recherche d'appareils, ou choisissez-en un autre.",
  },
  forbidden: {
    en: 'Remote control refused: see "Control by mobile apps"',
    fr: 'Contrôle refusé : voir « Control by mobile apps »',
  },
  noApp: {
    en: 'No app to show: the Roku did not list its apps yet.',
    fr: "Aucune application à afficher : le Roku n'a pas encore donné sa liste.",
  },
  power: { en: 'Power', fr: 'Alimentation' },
  on: { en: 'On', fr: 'Allumé' },
  standby: { en: 'Standby', fr: 'En veille' },
  unreachable: { en: 'Unreachable', fr: 'Injoignable' },
  refused: { en: 'Refused', fr: 'Refusé' },
  app: { en: 'App', fr: 'Application' },
  home: { en: 'Home', fr: 'Accueil' },
  input: { en: 'Input', fr: 'Entrée' },
  playback: { en: 'Playback', fr: 'Lecture' },
  playing: { en: 'Playing', fr: 'En lecture' },
  paused: { en: 'Paused', fr: 'En pause' },
  stopped: { en: 'Stopped', fr: 'Arrêtée' },
  position: { en: 'Position', fr: 'Position' },
  live: { en: 'Live', fr: 'En direct' },
  now: { en: 'Now', fr: 'En cours' },
  turnOn: { en: 'Turn on', fr: 'Allumer' },
  turnOff: { en: 'Turn off', fr: 'Éteindre' },
  back: { en: 'Back', fr: 'Retour' },
  ok: { en: 'OK', fr: 'OK' },
  up: { en: 'Up', fr: 'Haut' },
  down: { en: 'Down', fr: 'Bas' },
  left: { en: 'Left', fr: 'Gauche' },
  right: { en: 'Right', fr: 'Droite' },
  playPause: { en: 'Play / Pause', fr: 'Lecture / Pause' },
  rewind: { en: 'Rewind', fr: 'Retour rapide' },
  forward: { en: 'Fast forward', fr: 'Avance rapide' },
  replay: { en: 'Replay', fr: 'Relecture' },
  unknownApps: {
    en: (unknown) => `Not installed: ${unknown}`,
    fr: (unknown) => `Non installées : ${unknown}`,
  },
};

/** Buttons of fixed meaning: action key -> ECP key. */
const KEY_BUTTONS = {
  home: 'Home',
  back: 'Back',
  ok: 'Select',
  play_pause: 'Play',
  rewind: 'Rev',
  forward: 'Fwd',
  replay: 'InstantReplay',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
};

/**
 * A text cut to a bound, with an ellipsis.
 *
 * @param {unknown} text The text.
 * @param {number} max Bound in characters.
 * @returns {string} The text.
 */
export function fit(text, max) {
  const value = String(text ?? '').trim();
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function lang(language) {
  return language === 'fr' ? 'fr' : 'en';
}

/**
 * The widget image key of an app icon: changes with the app version, so the
 * core's one-hour image cache follows an update.
 *
 * @param {Object} app App ({ id, version }).
 * @returns {string} The key (`^[a-z0-9][a-z0-9-]{0,63}$`).
 */
export function iconKey(app) {
  const part = (value) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const version = part(app.version) || '0';
  return `icon-${part(app.id) || 'app'}-${version}`.slice(0, 64).replace(/-+$/, '');
}

/**
 * The Roku a widget shows.
 *
 * @param {Object} manager RokuManager.
 * @param {Object} settings Widget settings ({ device }).
 * @returns {{ roku: Object|undefined, reason: 'none'|'unknown'|null }}
 */
export function resolveWidgetRoku(manager, settings) {
  const picked = typeof settings?.device === 'string' ? settings.device.trim() : '';
  if (picked) {
    const roku = manager.findByExternalId(picked);
    return roku?.info ? { roku, reason: null } : { roku: undefined, reason: 'unknown' };
  }
  const [first] = manager.knownRokus();
  return first ? { roku: first, reason: null } : { roku: undefined, reason: 'none' };
}

/**
 * A widget with only a sentence to show.
 *
 * @param {'none'|'unknown'} reason See resolveWidgetRoku().
 * @returns {Object} Content.
 */
export function emptyContent(reason) {
  return {
    version: 1,
    ttl_seconds: WIDGET_TTL_SECONDS.empty,
    components: [
      { type: 'text', variant: 'body', text: reason === 'unknown' ? T.unknownRoku : T.noRoku },
    ],
  };
}

function heading(roku) {
  return { type: 'text', variant: 'heading', text: fit(roku.info.name, 40) };
}

function button(label, key, params, icon, extra = {}) {
  return { type: 'button', label, icon, action: { key, params, ...extra } };
}

function isOn(roku) {
  return roku.reachable !== false && roku.state?.poweredOn === true;
}

function forbidden(roku) {
  return roku.error?.kind === 'forbidden';
}

/**
 * The power row of a status list.
 *
 * @param {Object} roku The Roku.
 * @returns {Object} Status item.
 */
export function powerStatus(roku) {
  if (forbidden(roku)) {
    return { label: T.power, value: T.refused, color: WIDGET_COLORS.DANGER };
  }
  if (roku.reachable === false) {
    return { label: T.power, value: T.unreachable, color: WIDGET_COLORS.WARNING };
  }
  return isOn(roku)
    ? { label: T.power, value: T.on, color: WIDGET_COLORS.SUCCESS }
    : { label: T.power, value: T.standby, color: WIDGET_COLORS.NEUTRAL };
}

function currentApp(roku) {
  return isOn(roku) ? roku.state.app : undefined;
}

function appRows(roku) {
  const app = currentApp(roku);
  if (!app) {
    return [];
  }
  if (isTvInput(app.id)) {
    return [{ label: T.input, value: fit(app.name, 40) }];
  }
  return [{ label: T.app, value: app.home ? T.home : fit(app.name, 40) }];
}

function refusedCaption(roku) {
  return forbidden(roku) ? [{ type: 'text', variant: 'caption', text: T.forbidden }] : [];
}

/**
 * The "remote" widget.
 *
 * @param {Object} roku The Roku.
 * @returns {Object} Content.
 */
export function remoteContent(roku) {
  const params = { serial: roku.serial };
  const buttons = roku.info.isTv
    ? [
        button(isOn(roku) ? T.turnOff : T.turnOn, 'power', params, 'power'),
        button(T.home, 'home', params, 'home'),
        button(T.back, 'back', params, 'corner-up-left'),
        button(T.ok, 'ok', params, 'check'),
      ]
    : [
        button(T.playPause, 'play_pause', params, roku.state?.playing ? 'pause' : 'play'),
        button(T.home, 'home', params, 'home'),
        button(T.back, 'back', params, 'corner-up-left'),
        button(T.ok, 'ok', params, 'check'),
      ];
  return {
    version: 1,
    ttl_seconds: WIDGET_TTL_SECONDS.remote,
    components: [
      heading(roku),
      ...refusedCaption(roku),
      { type: 'status', items: [powerStatus(roku), ...appRows(roku)] },
      ...buttons,
    ],
  };
}

/**
 * The "navigation" widget: the arrows of the remote, nothing else to read.
 *
 * @param {Object} roku The Roku.
 * @returns {Object} Content.
 */
export function navigationContent(roku) {
  const params = { serial: roku.serial };
  return {
    version: 1,
    ttl_seconds: WIDGET_TTL_SECONDS.navigation,
    components: [
      heading(roku),
      ...refusedCaption(roku),
      button(T.up, 'up', params, 'chevron-up'),
      button(T.down, 'down', params, 'chevron-down'),
      button(T.left, 'left', params, 'chevron-left'),
      button(T.right, 'right', params, 'chevron-right'),
    ],
  };
}

/**
 * "12:34" or "1:02:03".
 *
 * @param {number} ms Duration in milliseconds.
 * @returns {string} The clock text.
 */
export function clock(ms) {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

function playbackRows(roku) {
  const app = currentApp(roku);
  if (!app || app.home || isTvInput(app.id)) {
    return [];
  }
  const media = roku.state.media;
  const rows = [];
  if (roku.state.playing === true) {
    rows.push({ label: T.playback, value: T.playing, color: WIDGET_COLORS.SUCCESS });
  } else if (media?.state === 'pause') {
    rows.push({ label: T.playback, value: T.paused, color: WIDGET_COLORS.INFO });
  } else {
    rows.push({ label: T.playback, value: T.stopped, color: WIDGET_COLORS.NEUTRAL });
  }
  // A closed player keeps its last position: shown only while a video is open.
  const open = media?.state === 'play' || media?.state === 'pause';
  if (open && media.live) {
    rows.push({ label: T.position, value: T.live });
  } else if (open && media.positionMs !== null && media.positionMs !== undefined) {
    const position = clock(media.positionMs);
    rows.push({
      label: T.position,
      value: media.durationMs ? `${position} / ${clock(media.durationMs)}` : position,
    });
  }
  return rows;
}

/**
 * The icon of an app, when the Roku lists it.
 *
 * @param {Object} roku The Roku.
 * @param {string} appId App id.
 * @returns {Object|undefined} The app ({ id, name, version }).
 */
function listedApp(roku, appId) {
  return (roku.apps ?? []).find((app) => app.id === appId);
}

/**
 * The "media" widget.
 *
 * @param {Object} roku The Roku.
 * @returns {Object} Content.
 */
export function mediaContent(roku) {
  const params = { serial: roku.serial };
  const app = currentApp(roku);
  const components = [heading(roku), ...refusedCaption(roku)];
  const listed = app && !app.home ? (listedApp(roku, app.id) ?? app) : undefined;
  if (listed) {
    components.push({
      type: 'image',
      key: iconKey(listed),
      alt: fit(listed.name, 80),
      fit: 'contain',
    });
  }
  const rows = isOn(roku) ? [...appRows(roku), ...playbackRows(roku)] : [];
  // Never an empty list: the core would drop the component.
  components.push({ type: 'status', items: rows.length > 0 ? rows : [powerStatus(roku)] });
  components.push(
    button(T.playPause, 'play_pause', params, roku.state?.playing ? 'pause' : 'play'),
    button(T.rewind, 'rewind', params, 'rewind'),
    button(T.forward, 'forward', params, 'fast-forward'),
    button(T.replay, 'replay', params, 'rotate-ccw'),
  );
  return { version: 1, ttl_seconds: WIDGET_TTL_SECONDS.media, components };
}

/**
 * The apps of the apps widget: the names typed in its settings, matched
 * against the installed apps (case, accents and spaces ignored); without any
 * name, the first installed apps.
 *
 * @param {Object} roku The Roku.
 * @param {Object} settings Widget settings.
 * @param {Function} findApp (roku, name) => app.
 * @returns {{ apps: Array<Object>, unknown: string[] }} Apps, and the names matching nothing.
 */
export function chosenApps(roku, settings, findApp) {
  const installed = (roku.apps ?? []).filter((app) => !isTvInput(app.id));
  const names = APP_SETTINGS.map((key) => settings?.[key])
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => name.trim());
  if (names.length === 0) {
    return { apps: installed.slice(0, APP_SETTINGS.length), unknown: [] };
  }
  const apps = [];
  const unknown = [];
  for (const name of names) {
    const app = findApp(roku, name);
    if (!app) {
      unknown.push(name);
    } else if (!apps.some((known) => known.id === app.id)) {
      apps.push(app);
    }
  }
  return { apps: apps.slice(0, APP_SETTINGS.length), unknown };
}

/**
 * The "apps" widget.
 *
 * @param {Object} roku The Roku.
 * @param {Object} settings Widget settings.
 * @param {string} language User language.
 * @param {Function} findApp (roku, name) => app.
 * @returns {Object} Content.
 */
export function appsContent(roku, settings, language, findApp) {
  const l = lang(language);
  const { apps, unknown } = chosenApps(roku, settings, findApp);
  const current = currentApp(roku);
  const components = [heading(roku), ...refusedCaption(roku)];
  if (unknown.length > 0 && !forbidden(roku)) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: fit(T.unknownApps[l](unknown.join(', ')), 80),
    });
  }
  if (apps.length === 0) {
    components.push({ type: 'text', variant: 'body', text: T.noApp });
  } else {
    const withIcons = apps.filter((app) => app.id !== HOME_APP_ID);
    if (withIcons.length > 0) {
      components.push({
        type: 'card-list',
        display: 'grid',
        items: withIcons.map((app) => ({
          title: fit(app.name, 60),
          image: iconKey(app),
          ...(current?.id === app.id
            ? { badge: { text: T.now, color: WIDGET_COLORS.SUCCESS } }
            : {}),
        })),
      });
    }
  }
  apps.forEach((app, index) => {
    // Numbered keys: the core drops a button whose key another one uses.
    components.push(
      button(
        fit(app.id === HOME_APP_ID ? T.home[l] : app.name, 24),
        APP_SETTINGS[index],
        { serial: roku.serial, app: app.id },
        current?.id === app.id ? CURRENT_ICON : 'play-circle',
      ),
    );
  });
  return { version: 1, ttl_seconds: WIDGET_TTL_SECONDS.apps, components };
}

/**
 * What a widget button stands for — and only what a widget button may do.
 *
 * @param {string} actionKey Button action key.
 * @param {Object} params Its params ({ serial, app? }).
 * @returns {Object|null} `{ kind: 'power'|'key'|'app', serial, ecp?, times?, app? }`,
 * null for anything else.
 */
export function widgetCommand(actionKey, params = {}) {
  const serial = typeof params?.serial === 'string' ? params.serial.trim() : '';
  if (!serial) {
    return null;
  }
  if (actionKey === 'power') {
    return { kind: 'power', serial };
  }
  if (KEY_BUTTONS[actionKey]) {
    return { kind: 'key', serial, ecp: KEY_BUTTONS[actionKey], times: 1 };
  }
  if (APP_SETTINGS.includes(actionKey) && typeof params.app === 'string' && params.app.trim()) {
    return { kind: 'app', serial, app: params.app.trim() };
  }
  return null;
}

/** Wait before re-reading a Roku after a widget command (ECP state lags). */
export const SETTLE_AFTER_ACTION_MS = 1000;

/**
 * Run a widget command.
 *
 * @param {Object} manager RokuManager.
 * @param {Object} command See widgetCommand().
 * @param {Object} roku The Roku.
 * @returns {Promise<{ en: string, fr: string }>} The toast.
 */
async function runCommand(manager, command, roku) {
  if (command.kind === 'power') {
    const on = !isOn(roku);
    await manager.setPower(command.serial, on);
    return on
      ? { en: 'Turning the TV on…', fr: 'Allumage de la TV…' }
      : { en: 'Turning the TV off…', fr: 'Extinction de la TV…' };
  }
  if (command.kind === 'app') {
    await manager.launch(command.serial, command.app);
    const name = fit(listedApp(roku, command.app)?.name ?? command.app, 40);
    return { en: `Opening ${name}…`, fr: `Ouverture de ${name}…` };
  }
  await manager.pressKey(command.serial, command.ecp, command.times);
  return { en: 'Key sent to the Roku.', fr: 'Touche envoyée au Roku.' };
}

/**
 * The widget handlers, bound to a RokuManager.
 *
 * @param {Object} manager RokuManager.
 * @returns {Object} `{ get(key, request), action(key, actionKey, params, extra), image(key) }`.
 */
export function createWidgetHandlers(manager) {
  return {
    async get(key, { settings, language } = {}) {
      const { roku, reason } = resolveWidgetRoku(manager, settings);
      if (!roku) {
        return emptyContent(reason);
      }
      if (key === WIDGET.REMOTE) {
        return remoteContent(roku);
      }
      if (key === WIDGET.MEDIA) {
        return mediaContent(roku);
      }
      if (key === WIDGET.APPS) {
        return appsContent(roku, settings, language, (r, name) => manager.findApp(r, name));
      }
      if (key === WIDGET.NAVIGATION) {
        return navigationContent(roku);
      }
      throw new Error(`Unknown widget: ${key}`);
    },

    async action(_key, actionKey, params) {
      const command = widgetCommand(actionKey, params);
      if (!command) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      const roku = manager.require(command.serial);
      try {
        const toast = await runCommand(manager, command, roku);
        // Read the Roku again before answering: the core reloads this widget
        // as soon as the action resolves, it then shows the new state.
        await manager.sleep(SETTLE_AFTER_ACTION_MS);
        await manager.refresh(command.serial).catch(() => {});
        return toast;
      } catch (err) {
        if (err?.kind) {
          return explainErrorShort(err);
        }
        throw err;
      }
    },

    /**
     * Resolve the raw base64 of an app icon, fetched from a Roku listing it.
     *
     * @param {string} imageKey Key built by iconKey().
     * @returns {Promise<string>} Raw base64.
     */
    async image(imageKey) {
      for (const roku of manager.knownRokus()) {
        const candidates = [...(roku.apps ?? []), roku.state?.app].filter(Boolean);
        const app = candidates.find((candidate) => iconKey(candidate) === imageKey);
        if (!app || roku.reachable === false) {
          continue;
        }
        const { body } = await manager.createClient(roku.ip).icon(app.id);
        const base64 = body.toString('base64');
        const issues = validateWidgetImage(base64);
        if (issues.length > 0) {
          throw new Error(`Icon of ${app.name} not usable: ${issues.join('; ')}`);
        }
        return base64;
      }
      throw new Error(`Unknown image: ${imageKey}`);
    },
  };
}

/**
 * What each widget shows of the Rokus, as one string per widget key: a
 * widget is nudged only when its string changed. The playback position is
 * left out on purpose: it changes on every poll, the TTL refreshes it.
 *
 * @param {Object} manager RokuManager.
 * @returns {{ remote: string, media: string, apps: string }} Signatures.
 */
export function widgetSignatures(manager) {
  const rokus = manager.knownRokus();
  const base = (roku) => [
    roku.serial,
    roku.info.name,
    isOn(roku),
    roku.reachable,
    roku.error?.kind ?? '',
    currentApp(roku)?.id ?? '',
  ];
  return {
    [WIDGET.REMOTE]: JSON.stringify(
      rokus.map((roku) => [...base(roku), roku.state?.playing === true]),
    ),
    [WIDGET.MEDIA]: JSON.stringify(
      rokus.map((roku) => [
        ...base(roku),
        roku.state?.playing ?? null,
        roku.state?.media?.state ?? '',
      ]),
    ),
    [WIDGET.APPS]: JSON.stringify(
      rokus.map((roku) => [...base(roku), (roku.apps ?? []).map((app) => app.id).join(',')]),
    ),
    // The arrows show only the name of the Roku and a refusal.
    [WIDGET.NAVIGATION]: JSON.stringify(
      rokus.map((roku) => [roku.serial, roku.info.name, roku.error?.kind === 'forbidden']),
    ),
  };
}

/** For the manifest consistency test: every widget key has a handler. */
export const WIDGET_KEYS = Object.values(WIDGET);
