// -----------------------------------------------------------------------------
// Readers of the Roku External Control Protocol (ECP) answers, and of the SSDP
// replies relayed by the Gladys core.
//
// Pure functions from text to plain objects: everything the integration knows
// of a Roku goes through here, so the tests feed them real device answers
// (test/fixtures/ecp, adapted from python-rokuecp).
// -----------------------------------------------------------------------------

import { child, childText, parseXml } from './xml.js';

// The app Roku reports on its home screen (no id), and the one it reports
// while the "Power Saver" screen of some players is shown.
const HOME_APP_NAMES = new Set(['Roku', 'Power Saver']);

/** Value of the "home screen" option of the application and input selects. */
export const HOME_APP_ID = 'home';

function bool(value) {
  return String(value ?? '').trim() === 'true';
}

function expectRoot(xml, name) {
  const root = parseXml(xml);
  if (root.name !== name) {
    throw new Error(`Unexpected ECP answer: <${root.name}> instead of <${name}>`);
  }
  return root;
}

/**
 * The display name of a Roku, following the fallbacks of python-rokuecp: the
 * name the user gave it, then the names the firmware builds.
 *
 * @param {Object} fields device-info fields.
 * @returns {string} The name.
 */
export function deviceName(fields) {
  const candidates = [
    fields['user-device-name'],
    fields['friendly-device-name'],
    fields['default-device-name'],
  ];
  const named = candidates.find((value) => typeof value === 'string' && value.trim());
  if (named) {
    return named.trim();
  }
  const brand = (fields['vendor-name'] || 'Roku').trim();
  const model = (fields['model-name'] || '').trim();
  return model ? `${brand} ${model}` : brand;
}

/**
 * Read `/query/device-info`.
 *
 * @param {string} xml The answer.
 * @returns {Object} `{ serial, name, vendor, model, modelNumber, softwareVersion,
 * isTv, isStick, deviceType, powerMode, poweredOn, hasTuner, mac, supportsWakeOnWlan,
 * location, raw }`.
 */
export function parseDeviceInfo(xml) {
  const root = expectRoot(xml, 'device-info');
  const fields = {};
  for (const element of root.children) {
    fields[element.name] = element.text;
  }
  const serial = (fields['serial-number'] || fields['device-id'] || '').trim();
  if (!serial) {
    throw new Error('The Roku answered a device-info without serial number');
  }
  const isTv = bool(fields['is-tv']);
  const isStick = bool(fields['is-stick']);
  const networkType = fields['network-type'];
  // The MAC of the interface actually in use: Wake-on-LAN must target it.
  const mac =
    (networkType === 'ethernet' ? fields['ethernet-mac'] : fields['wifi-mac']) ||
    fields['wifi-mac'] ||
    fields['ethernet-mac'] ||
    '';
  const powerMode = (fields['power-mode'] || '').trim();
  return {
    serial,
    name: deviceName(fields),
    vendor: (fields['vendor-name'] || 'Roku').trim(),
    model: (fields['friendly-model-name'] || fields['model-name'] || '').trim(),
    modelNumber: (fields['model-number'] || '').trim(),
    softwareVersion: (fields['software-version'] || '').trim(),
    isTv,
    isStick,
    deviceType: isTv ? 'tv' : isStick ? 'stick' : 'box',
    powerMode,
    // Every other mode (PowerOff, DisplayOff, Ready, Headless, Suspend…) is a
    // flavour of standby, as python-rokuecp reads it.
    poweredOn: powerMode === 'PowerOn',
    hasTuner: isTv && Boolean((fields['tuner-type'] || '').trim()),
    mac: mac.trim().toLowerCase(),
    supportsWakeOnWlan: bool(fields['supports-wake-on-wlan']),
    location: (fields['user-device-location'] || '').trim(),
    raw: fields,
  };
}

/**
 * Read `/query/apps`.
 *
 * @param {string} xml The answer.
 * @returns {Array<{ id: string, name: string, type: string, version: string }>} The
 * installed apps, TV inputs (`type: "tvin"`) included, in the device order.
 */
export function parseApps(xml) {
  const root = expectRoot(xml, 'apps');
  return root.children
    .filter((element) => element.name === 'app' && element.attrs.id)
    .map((element) => ({
      id: element.attrs.id,
      name: element.text || element.attrs.id,
      type: element.attrs.type || 'appl',
      version: element.attrs.version || '',
    }));
}

/**
 * Whether an app id is a TV input of a Roku TV (HDMI, antenna, AV).
 *
 * @param {string} id App id.
 * @returns {boolean} True for `tvinput.*`.
 */
export function isTvInput(id) {
  return typeof id === 'string' && id.startsWith('tvinput.');
}

/**
 * Read `/query/active-app`.
 *
 * @param {string} xml The answer.
 * @returns {{ id: string, name: string, type: string, version: string, home: boolean,
 * screensaver: boolean }} The foreground app; the home screen has `id: "home"`.
 */
export function parseActiveApp(xml) {
  const root = expectRoot(xml, 'active-app');
  const app = child(root, 'app');
  const screensaver = Boolean(child(root, 'screensaver'));
  const id = app?.attrs.id;
  const name = app?.text || '';
  if (!id || HOME_APP_NAMES.has(name)) {
    return { id: HOME_APP_ID, name: 'Home', type: 'home', version: '', home: true, screensaver };
  }
  return {
    id,
    name: name || id,
    type: app.attrs.type || 'appl',
    version: app.attrs.version || '',
    home: false,
    screensaver,
  };
}

function milliseconds(text) {
  const value = parseInt(
    String(text ?? '')
      .replace(/ms/i, '')
      .trim(),
    10,
  );
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Read `/query/media-player`.
 *
 * @param {string} xml The answer.
 * @returns {{ state: string, playing: boolean|null, positionMs: number|null,
 * durationMs: number|null, live: boolean, appId: string|null, error: boolean }}
 * `playing` is null for the transient states (buffer, open, startup), when the
 * playback state is not known yet.
 */
export function parseMediaPlayer(xml) {
  const root = expectRoot(xml, 'player');
  const state = (root.attrs.state || 'none').trim();
  let playing = false;
  if (state === 'play') {
    playing = true;
  } else if (['buffer', 'open', 'startup'].includes(state)) {
    playing = null;
  }
  return {
    state,
    playing,
    positionMs: milliseconds(childText(root, 'position')),
    durationMs: milliseconds(childText(root, 'duration')),
    live: childText(root, 'is_live') === 'true',
    appId: child(root, 'plugin')?.attrs.id || null,
    error: root.attrs.error === 'true',
  };
}

/**
 * Read one SSDP reply relayed by the core (`scanNetwork('ssdp')`).
 *
 * @param {{ source_ip: string, source_mac?: string, headers: string }} result Raw result.
 * @returns {{ ip: string, port: number, serial: string, mac: string }|null} The
 * Roku that answered, null when the reply is not a Roku ECP one.
 */
export function parseSsdpResult(result) {
  const headers = {};
  for (const line of String(result?.headers ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
  }
  const st = (headers.st || headers.nt || '').toLowerCase();
  const usn = headers.usn || '';
  if (st !== 'roku:ecp' && !/roku:ecp/i.test(usn)) {
    return null;
  }
  let ip = result?.source_ip || '';
  let port = 8060;
  try {
    const location = new URL(headers.location);
    ip = location.hostname || ip;
    port = Number(location.port) || 8060;
  } catch {
    // No usable LOCATION: the sender address is the Roku.
  }
  if (!ip) {
    return null;
  }
  const serialMatch = usn.match(/roku:ecp:([A-Za-z0-9]+)/i);
  return {
    ip,
    port,
    serial: serialMatch ? serialMatch[1] : '',
    mac: typeof result.source_mac === 'string' ? result.source_mac.toLowerCase() : '',
  };
}
