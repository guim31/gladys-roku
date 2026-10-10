// -----------------------------------------------------------------------------
// Scene triggers and actions (Gladys 5.1+).
//
// Trigger (fired by index.js from the manager's `appChanged` event):
//   - app_changed: the foreground app of a Roku changed (polled every 10 s),
//     filterable by Roku and by app name — "when Netflix starts, dim the
//     lights". The power and playback states are device features: a scene
//     uses them directly.
//
// Actions:
//   - launch_app: open an app by name (or id) — "movie night";
//   - send_key: press a remote key, a number of times — "mute the TV";
//   - type_text: type a text in the field on screen (search, login), the only
//     text entry a widget can reach on a Gladys without widget forms: a scene
//     holding the text, started from a scene button of the dashboard.
// Keys are forever once published.
// -----------------------------------------------------------------------------

import { REMOTE_KEYS } from './devices/roku.js';
import { HOME_APP_ID } from './ecp/parse.js';

export const SCENE_TRIGGER = { APP_CHANGED: 'app_changed' };

/** Scene trigger keys fired by the code (declared in the manifest). */
export const SCENE_TRIGGER_KEYS = Object.values(SCENE_TRIGGER);

/** Key values of the send_key action (manifest options): remote keys + power. */
export const SCENE_KEY_VALUES = [...REMOTE_KEYS.map((entry) => entry.key), 'power_on', 'power_off'];

const MAX_TIMES = 20;

function requireRoku(manager, externalId) {
  const roku = manager.findByExternalId(externalId);
  if (!roku?.ip) {
    throw new Error(`Unknown Roku device: ${externalId}`);
  }
  return roku;
}

/**
 * The data of an `app_changed` event.
 *
 * @param {string} deviceExternalId Device external id.
 * @param {Object} app The new foreground app ({ id, name, home }).
 * @returns {{ device: string, app: string, app_id: string }} Flat event data.
 */
export function appChangedEvent(deviceExternalId, app) {
  return {
    device: deviceExternalId,
    app: app.home ? 'Home' : app.name,
    app_id: app.id,
  };
}

/**
 * The scene action handlers, bound to a RokuManager.
 *
 * @param {Object} manager RokuManager.
 * @returns {Object} Handlers by key.
 */
export function createSceneActions(manager) {
  return {
    async launch_app(fields) {
      const roku = requireRoku(manager, fields.device);
      const wanted = String(fields.app ?? '').trim();
      let app = manager.findApp(roku, wanted);
      if (!app && roku.apps !== null) {
        // Installed since the last read?
        await manager.refreshApps(roku).catch(() => false);
        app = manager.findApp(roku, wanted);
      }
      if (!app) {
        const installed = (roku.apps ?? []).map((candidate) => candidate.name).join(', ');
        throw new Error(
          `"${wanted}" is not installed on ${roku.info?.name ?? roku.ip}. Installed: ${installed || 'unknown'}`,
        );
      }
      await manager.launch(roku.serial, app.id);
      return { app_id: app.id, app_name: app.id === HOME_APP_ID ? 'Home' : app.name };
    },

    async send_key(fields) {
      const roku = requireRoku(manager, fields.device);
      const times = Math.min(Math.max(Math.trunc(Number(fields.times) || 1), 1), MAX_TIMES);
      if (fields.key === 'power_on' || fields.key === 'power_off') {
        await manager.setPower(roku.serial, fields.key === 'power_on');
        return undefined;
      }
      const remoteKey = REMOTE_KEYS.find((entry) => entry.key === fields.key);
      if (!remoteKey) {
        throw new Error(`Unknown key: ${fields.key}`);
      }
      await manager.pressKey(roku.serial, remoteKey.ecp, times);
      return undefined;
    },

    async type_text(fields) {
      const roku = requireRoku(manager, fields.device);
      await manager.typeText(roku.serial, fields.text);
      return undefined;
    },
  };
}

/** Scene action keys (forever), for the manifest consistency test. */
export const SCENE_ACTION_KEYS = ['launch_app', 'send_key', 'type_text'];
