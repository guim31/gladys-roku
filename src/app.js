// -----------------------------------------------------------------------------
// The integration, wired to a Gladys SDK instance: every handler is registered
// here, before connect(). index.js only creates the SDK client and connects;
// the tests drive this function with a fake SDK (test/app.test.js).
// -----------------------------------------------------------------------------

import { logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { RokuManager } from './manager.js';
import { ACTIONS } from './actions.js';
import { SCENE_TRIGGER, appChangedEvent, createSceneActions } from './scenes.js';
import { WIDGET_KEYS, createWidgetHandlers, widgetSignatures } from './widgets.js';
import { MESSAGES, explainError } from './messages.js';
import { rokuIds } from './devices/roku.js';
import { createWidgetNudger } from './nudger.js';

// The level the container was started with, restored when debug logs go off.
const INITIAL_LOG_LEVEL = process.env.LOG_LEVEL;

/**
 * Register every handler of the integration on a Gladys SDK instance.
 *
 * @param {Object} gladys GladysIntegration (or a stand-in, in the tests).
 * @param {Object} [managerOptions] RokuManager options (tests).
 * @param {Object} [nudgerOptions] Widget nudger options: `{ now, schedule }` (tests).
 * @returns {{ manager: RokuManager, onConnected: Function, shutdown: Function }}
 */
export function createApp(gladys, managerOptions = {}, nudgerOptions = {}) {
  const manager = new RokuManager(gladys, managerOptions);
  const widgets = createWidgetHandlers(manager);
  const sceneActions = createSceneActions(manager);
  const nudger = createWidgetNudger(gladys, WIDGET_KEYS, nudgerOptions);

  let config = normalizeConfig();
  let lastStatus = '';

  function applyConfig(raw) {
    config = normalizeConfig(raw);
    // The SDK logger re-reads LOG_LEVEL on every line: the switch is live.
    if (config.debug_logs) {
      process.env.LOG_LEVEL = 'debug';
    } else if (INITIAL_LOG_LEVEL === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = INITIAL_LOG_LEVEL;
    }
    if (config.invalidHosts.length > 0) {
      logger.warn(`Ignored Roku addresses (not an IP address): ${config.invalidHosts.join(', ')}`);
    }
  }

  /**
   * Show in the Configuration screen the Rokus that refuse remote control:
   * the most likely problem, and one only the user can fix on the Roku.
   */
  async function updateConnectionStatus() {
    const refusing = manager.refusing();
    const status = refusing.map((entry) => entry.label).join(', ');
    if (status === lastStatus) {
      return;
    }
    lastStatus = status;
    if (refusing.length === 0) {
      await gladys.setConnectionStatus(true).catch(() => {});
      return;
    }
    const message = explainError(refusing[0].error, status);
    await gladys.setConnectionStatus(false, message).catch(() => {});
  }

  async function discoverAndPublish() {
    const result = await manager.discover(config);
    await manager.publishDiscovered();
    await updateConnectionStatus();
    return result;
  }

  // Nudge a widget only when what it shows changed: every nudge costs a
  // content pull, and the core allows 30 a minute per integration (refused
  // attempts included) before it refuses the pulls AND the button taps.
  let signatures = {};
  // Widgets whose button is being handled: the core reloads them itself once
  // the action resolves, a nudge would cost a second pull.
  // A count per widget key: two taps on the same widget can overlap.
  const acting = new Map();
  function nudgeChangedWidgets() {
    const next = widgetSignatures(manager);
    for (const key of WIDGET_KEYS) {
      if (next[key] !== signatures[key] && !acting.get(key)) {
        nudger.nudge(key);
      }
    }
    signatures = next;
  }

  function nudgeAllWidgets() {
    signatures = widgetSignatures(manager);
    nudger.nudgeAll();
  }

  manager.on('refreshed', nudgeChangedWidgets);
  manager.on('changed', () => {
    nudgeChangedWidgets();
    updateConnectionStatus().catch(() => {});
  });

  let sceneEventsFailing = false;
  manager.on('appChanged', (roku, _previous, app) => {
    const data = appChangedEvent(rokuIds(gladys, roku.serial).device, app);
    logger.debug(`Scene event ${SCENE_TRIGGER.APP_CHANGED}: ${data.app} on ${roku.info?.name}`);
    gladys
      .publishSceneEvent(SCENE_TRIGGER.APP_CHANGED, data)
      .then(() => {
        sceneEventsFailing = false;
      })
      .catch((err) => {
        // One warning per outage, not one per app change.
        logger[sceneEventsFailing ? 'debug' : 'warn'](`Scene event not sent: ${err.message}`);
        sceneEventsFailing = true;
      });
  });

  // --- Discovery -----------------------------------------------------------------
  gladys.onScanRequest(async () => {
    logger.info('Scan requested: SSDP discovery + configured addresses');
    await discoverAndPublish();
  });

  // --- Commands, polling, device lifecycle ---------------------------------------
  gladys.onSetValue(async (device, feature, value) => {
    logger.debug(`setValue ${feature.external_id} = ${value}`);
    await manager.setValue(device, feature, value);
  });

  // The fallback: the internal timer (manager.startPolling) reads the created
  // Rokus the core does not poll (Gladys#3198), and leaves alone those it does.
  gladys.onPoll(async (device) => {
    await manager.corePoll(device);
  });

  gladys.onDeviceCreated(async (device) => {
    // The core dropped the states published before the device existed.
    await manager.deviceCreated(device);
    nudgeAllWidgets();
  });

  // --- Manifest actions, scene actions, widgets ----------------------------------
  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(key, (fields) => handler({ fields, manager, config }));
  }

  for (const [key, handler] of Object.entries(sceneActions)) {
    gladys.onSceneAction(key, (fields) => handler(fields));
  }

  for (const key of WIDGET_KEYS) {
    gladys.onWidgetGet(key, (request) => widgets.get(key, request));
    gladys.onWidgetAction(key, async (actionKey, params, extra) => {
      acting.set(key, (acting.get(key) ?? 0) + 1);
      try {
        return await widgets.action(key, actionKey, params, extra);
      } finally {
        acting.set(key, acting.get(key) - 1);
      }
    });
  }
  gladys.onWidgetGetImage((imageKey) => widgets.image(imageKey));

  // --- Configuration -------------------------------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    applyConfig(newConfig);
    await discoverAndPublish();
  });

  // --- Connection lifecycle ------------------------------------------------------
  async function onConnected() {
    try {
      applyConfig(await gladys.getConfig());
      manager.syncCreatedDevices(gladys.devices);
      lastStatus = null;
      await discoverAndPublish();
      // States of the created devices, re-sent from scratch after a restart.
      for (const roku of manager.rokus.values()) {
        manager.forgetPublished(roku.serial);
        if (roku.created) {
          await manager.refresh(roku.serial);
        }
      }
      nudgeAllWidgets();
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys.setConnectionStatus(false, MESSAGES.initFailed).catch(() => {});
    }
    // Even after a failed initialization: the created Rokus are known from gladys.devices.
    manager.startPolling(gladys);
  }
  gladys.on('connected', onConnected);

  function shutdown() {
    manager.stop();
    nudger.stop();
  }

  return { manager, onConnected, shutdown };
}
