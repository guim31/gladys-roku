// -----------------------------------------------------------------------------
// The Gladys device of a Roku: its features, and the states they carry.
//
// One device per Roku, keyed by its serial number (external ids are forever:
// the address changes with DHCP, the serial never does). Every Roku has the
// remote keys, the application select and the playback state; a Roku TV adds
// the power command, the volume and mute keys, the input select and, with a
// tuner, the channel keys.
//
// Choices inherited from the Android TV Remote integration, and from the core:
//   - remote keys are `television/<type>` features, which the Gladys front
//     renders as push buttons (never `button/click`, which it reads as a
//     sensor);
//   - the application and input lists are `text/select` features whose
//     options are the apps the Roku reports (`supported_options`, re-synced by
//     the core on every publication);
//   - `min`/`max` are set on every feature, text ones included (0/0), or
//     "Add to Gladys" fails.
// -----------------------------------------------------------------------------

import { HOME_APP_ID, isTvInput } from '../ecp/parse.js';

/** Device type namespace of the external ids (forever). */
export const DEVICE_TYPE = 'roku';

/** Device params: the address and the MAC, upserted by the core on re-publish. */
export const PARAM_IP = 'ROKU_IP';
export const PARAM_MAC = 'ROKU_MAC';

/** Poll cadence: one of the core's fixed values, in milliseconds. */
export const POLL_FREQUENCY_MS = 10000;

/** Feature keys (suffix of the feature external ids, forever). */
export const FEATURE = {
  POWER: 'power',
  APP: 'app',
  INPUT: 'input',
  PLAYBACK: 'playback',
};

/**
 * The remote keys, as features. `key` is the feature key suffix (forever),
 * `ecp` the ECP key name, `type` a `television` type the front draws as a push
 * button. `tv`: Roku TV only; `tuner`: Roku TV with a tuner only.
 */
export const REMOTE_KEYS = [
  { key: 'home', ecp: 'Home', type: 'exit', name: 'Home' },
  { key: 'back', ecp: 'Back', type: 'return', name: 'Back' },
  { key: 'up', ecp: 'Up', type: 'up', name: 'Up' },
  { key: 'down', ecp: 'Down', type: 'down', name: 'Down' },
  { key: 'left', ecp: 'Left', type: 'left', name: 'Left' },
  { key: 'right', ecp: 'Right', type: 'right', name: 'Right' },
  { key: 'select', ecp: 'Select', type: 'enter', name: 'OK' },
  // The "*" key of the Roku remote: the options of the current screen.
  { key: 'info', ecp: 'Info', type: 'info', name: 'Options (*)' },
  // Roku has a single play/pause key.
  { key: 'play', ecp: 'Play', type: 'play', name: 'Play/Pause' },
  { key: 'rewind', ecp: 'Rev', type: 'rewind', name: 'Rewind' },
  { key: 'forward', ecp: 'Fwd', type: 'forward', name: 'Fast forward' },
  { key: 'replay', ecp: 'InstantReplay', type: 'previous', name: 'Instant replay' },
  // ECP has no absolute volume, no volume level and no mute state: keys only.
  { key: 'volume_up', ecp: 'VolumeUp', type: 'volume-up', name: 'Volume up', tv: true },
  { key: 'volume_down', ecp: 'VolumeDown', type: 'volume-down', name: 'Volume down', tv: true },
  { key: 'volume_mute', ecp: 'VolumeMute', type: 'volume-mute', name: 'Mute', tv: true },
  { key: 'channel_up', ecp: 'ChannelUp', type: 'channel-up', name: 'Channel up', tuner: true },
  {
    key: 'channel_down',
    ecp: 'ChannelDown',
    type: 'channel-down',
    name: 'Channel down',
    tuner: true,
  },
];

/** ECP keys of the TV inputs, when launching the input app is refused. */
const INPUT_KEYS = {
  'tvinput.dtv': 'InputTuner',
  'tvinput.hdmi1': 'InputHDMI1',
  'tvinput.hdmi2': 'InputHDMI2',
  'tvinput.hdmi3': 'InputHDMI3',
  'tvinput.hdmi4': 'InputHDMI4',
  'tvinput.cvbs': 'InputAV1',
};

/**
 * The ECP key switching a Roku TV to an input, as a fallback of /launch.
 *
 * @param {string} inputId Input app id (`tvinput.hdmi1`).
 * @returns {string|undefined} The key.
 */
export function inputKey(inputId) {
  return INPUT_KEYS[inputId];
}

/**
 * The remote keys a Roku has.
 *
 * @param {Object} info Parsed device-info.
 * @returns {Array<Object>} Entries of REMOTE_KEYS.
 */
export function remoteKeysFor(info) {
  return REMOTE_KEYS.filter(
    (remoteKey) => (!remoteKey.tv || info.isTv) && (!remoteKey.tuner || info.hasTuner),
  );
}

/**
 * The external ids of a Roku.
 *
 * @param {Object} gladys SDK instance.
 * @param {string} serial Serial number.
 * @returns {{ device: string, feature: Function }} The ids.
 */
export function rokuIds(gladys, serial) {
  return gladys.externalIds(DEVICE_TYPE, serial);
}

/**
 * The serial number a device external id points to.
 *
 * @param {unknown} externalId A device or feature external id.
 * @returns {string|null} The serial, null when it is not a Roku id.
 */
export function serialFromExternalId(externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  const marker = `:${DEVICE_TYPE}:`;
  const index = externalId.indexOf(marker);
  if (index < 0) {
    return null;
  }
  const serial = externalId.slice(index + marker.length).split(':')[0];
  return serial || null;
}

/**
 * The feature key of a feature external id (`power`, `app`, `key:home`…).
 *
 * @param {string} deviceExternalId Device external id.
 * @param {string} featureExternalId Feature external id.
 * @returns {string|null} The key.
 */
export function featureKey(deviceExternalId, featureExternalId) {
  const prefix = `${deviceExternalId}:`;
  return typeof featureExternalId === 'string' && featureExternalId.startsWith(prefix)
    ? featureExternalId.slice(prefix.length)
    : null;
}

/**
 * The options of the application select: the home screen, then the installed
 * apps in the order the Roku lists them (TV inputs excluded, they have their
 * own select).
 *
 * @param {Array<Object>} apps Parsed apps.
 * @returns {Array<{ value: string, label: string, sort_order: number }>} Options.
 */
export function appOptions(apps) {
  const options = [{ value: HOME_APP_ID, label: 'Home' }];
  for (const app of apps ?? []) {
    if (!isTvInput(app.id) && !options.some((option) => option.value === app.id)) {
      options.push({ value: String(app.id), label: app.name || String(app.id) });
    }
  }
  return options.map((option, index) => ({ ...option, sort_order: index }));
}

/**
 * The options of the input select of a Roku TV: the Roku home (streaming),
 * then the inputs the TV reports, with the names the user gave them.
 *
 * @param {Array<Object>} apps Parsed apps.
 * @returns {Array<{ value: string, label: string, sort_order: number }>} Options.
 */
export function inputOptions(apps) {
  const options = [{ value: HOME_APP_ID, label: 'Roku (streaming)' }];
  for (const app of apps ?? []) {
    if (isTvInput(app.id) && !options.some((option) => option.value === app.id)) {
      options.push({ value: app.id, label: app.name || app.id });
    }
  }
  return options.map((option, index) => ({ ...option, sort_order: index }));
}

/**
 * The discovery payload of a Roku.
 *
 * @param {Object} gladys SDK instance.
 * @param {Object} roku Known Roku ({ serial, ip, mac, info, apps }).
 * @returns {Object} The Gladys device.
 */
export function buildRokuDevice(gladys, roku) {
  const { info } = roku;
  const ids = rokuIds(gladys, roku.serial);
  const feature = (key, fields) => ({
    external_id: ids.feature(key),
    selector: ids.feature(key),
    min: 0,
    max: 1,
    has_feedback: false,
    keep_history: true,
    ...fields,
  });

  const features = [
    feature(FEATURE.POWER, {
      name: 'Power',
      category: 'television',
      type: 'binary',
      // Only a Roku TV has real PowerOn/PowerOff keys: on a player, the state
      // (on / standby) is shown, not commanded.
      read_only: !info.isTv,
      has_feedback: info.isTv,
    }),
    feature(FEATURE.APP, {
      name: 'Application',
      category: 'text',
      type: 'select',
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      keep_history: false,
      supported_options: appOptions(roku.apps),
    }),
    feature(FEATURE.PLAYBACK, {
      name: 'Playback',
      category: 'music',
      type: 'playback_state',
      read_only: true,
    }),
  ];

  if (info.isTv) {
    features.push(
      feature(FEATURE.INPUT, {
        name: 'Input',
        category: 'text',
        type: 'select',
        min: 0,
        max: 0,
        read_only: false,
        has_feedback: true,
        keep_history: false,
        supported_options: inputOptions(roku.apps),
      }),
    );
  }

  for (const remoteKey of remoteKeysFor(info)) {
    features.push(
      feature(`key:${remoteKey.key}`, {
        name: remoteKey.name,
        category: 'television',
        type: remoteKey.type,
        read_only: false,
        keep_history: false,
      }),
    );
  }

  const params = [{ name: PARAM_IP, value: roku.ip }];
  if (roku.mac) {
    params.push({ name: PARAM_MAC, value: roku.mac });
  }

  return {
    name: info.name,
    external_id: ids.device,
    selector: ids.device,
    model: [info.vendor, info.model || info.modelNumber].filter(Boolean).join(' '),
    should_poll: true,
    poll_frequency: POLL_FREQUENCY_MS,
    features,
    params,
  };
}

/**
 * The states a Roku's features carry, from what the integration last read.
 * A feature whose value is unknown is left out (never a guess).
 *
 * @param {Object} gladys SDK instance.
 * @param {Object} roku Known Roku ({ serial, info, reachable, state }).
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>} States.
 */
export function rokuStates(gladys, roku) {
  const ids = rokuIds(gladys, roku.serial);
  const { state = {} } = roku;
  const states = [];
  // An unreachable Roku is a Roku in deep standby or unplugged: off.
  const on = roku.reachable && state.poweredOn === true;
  if (roku.reachable === false || typeof state.poweredOn === 'boolean') {
    states.push({ device_feature_external_id: ids.feature(FEATURE.POWER), state: on ? 1 : 0 });
  }
  if (!on && (roku.reachable === false || state.poweredOn === false)) {
    states.push({ device_feature_external_id: ids.feature(FEATURE.PLAYBACK), state: 0 });
  } else if (typeof state.playing === 'boolean') {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.PLAYBACK),
      state: state.playing ? 1 : 0,
    });
  }
  if (on && state.app?.id) {
    const appId = isTvInput(state.app.id) ? null : state.app.id;
    if (appId) {
      states.push({ device_feature_external_id: ids.feature(FEATURE.APP), text: appId });
    }
    if (roku.info?.isTv) {
      states.push({
        device_feature_external_id: ids.feature(FEATURE.INPUT),
        text: isTvInput(state.app.id) ? state.app.id : HOME_APP_ID,
      });
    }
  }
  return states;
}
