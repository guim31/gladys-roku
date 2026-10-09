// -----------------------------------------------------------------------------
// A fake LAN of Rokus, answering with the real device answers of
// test/fixtures/ecp. It stands in for RokuClient through the `createClient`
// option of RokuManager: the parsing code under test is the real one.
//
//   const lan = createFakeLan({
//     '192.0.2.10': { deviceInfo: 'device-info-box.xml', apps: 'apps.xml',
//                     activeApp: 'active-app-netflix.xml', media: 'media-player-amazon-play.xml' },
//   });
//   lan.roku('192.0.2.10').fail = 'forbidden';   // every request answers 403
//   lan.roku('192.0.2.10').failKeys = 'forbidden'; // only the commands do (Limited mode)
//   lan.calls  // [{ ip, op, arg }]
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { RokuError } from '../../src/ecp/client.js';
import {
  parseActiveApp,
  parseApps,
  parseDeviceInfo,
  parseMediaPlayer,
} from '../../src/ecp/parse.js';

export function fixture(name) {
  return readFileSync(new URL(`../fixtures/ecp/${name}`, import.meta.url), 'utf8');
}

// A 1x1 PNG: what /query/icon answers, at its smallest.
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export function createFakeLan(spec = {}) {
  const calls = [];
  const rokus = new Map(Object.entries(spec).map(([ip, roku]) => [ip, { ...roku }]));

  function error(kind, ip, path) {
    return new RokuError(`fake ${kind} on ${ip}${path}`, {
      kind,
      ip,
      path,
      status: kind === 'forbidden' ? 403 : undefined,
    });
  }

  function answer(ip, op, path, parse, file) {
    calls.push({ ip, op });
    const roku = rokus.get(ip);
    if (!roku) {
      throw error('unreachable', ip, path);
    }
    if (roku.fail) {
      throw error(roku.fail, ip, path);
    }
    return parse(fixture(roku[file]));
  }

  function command(ip, op, arg) {
    calls.push({ ip, op, arg });
    const roku = rokus.get(ip);
    if (!roku) {
      throw error('unreachable', ip, `/${op}`);
    }
    const failure = roku.fail || roku.failKeys;
    if (failure) {
      throw error(failure, ip, `/${op}/${arg}`);
    }
    if (op === 'launch' && roku.refuseLaunch?.includes(arg)) {
      throw new RokuError('HTTP 404', { kind: 'http', ip, status: 404 });
    }
  }

  return {
    calls,
    roku: (ip) => rokus.get(ip),
    add: (ip, roku) => rokus.set(ip, { ...roku }),
    remove: (ip) => rokus.delete(ip),
    createClient(ip) {
      return {
        ip,
        deviceInfo: async () =>
          answer(ip, 'deviceInfo', '/query/device-info', parseDeviceInfo, 'deviceInfo'),
        apps: async () => answer(ip, 'apps', '/query/apps', parseApps, 'apps'),
        activeApp: async () =>
          answer(ip, 'activeApp', '/query/active-app', parseActiveApp, 'activeApp'),
        mediaPlayer: async () =>
          answer(ip, 'mediaPlayer', '/query/media-player', parseMediaPlayer, 'media'),
        keypress: async (key) => command(ip, 'keypress', key),
        launch: async (appId) => command(ip, 'launch', appId),
        icon: async (appId) => {
          calls.push({ ip, op: 'icon', arg: appId });
          if (!rokus.has(ip)) {
            throw error('unreachable', ip, '/query/icon');
          }
          return { body: rokus.get(ip).icon ?? PNG_1X1, contentType: 'image/png' };
        },
      };
    },
  };
}

/** The three reference Rokus of the tests: a box, a stick and a Roku TV. */
export const LAN = {
  box: {
    ip: '192.0.2.10',
    serial: 'BOX000000001',
    spec: {
      deviceInfo: 'device-info-box.xml',
      apps: 'apps.xml',
      activeApp: 'active-app-netflix.xml',
      media: 'media-player-amazon-play.xml',
    },
  },
  stick: {
    ip: '192.0.2.20',
    serial: 'STK000000002',
    spec: {
      deviceInfo: 'device-info-stick.xml',
      apps: 'apps.xml',
      activeApp: 'active-app-roku.xml',
      media: 'media-player-close.xml',
    },
  },
  tv: {
    ip: '192.0.2.30',
    serial: 'TVX000000003',
    spec: {
      deviceInfo: 'device-info-tv.xml',
      apps: 'apps-tv.xml',
      activeApp: 'active-app-tv.xml',
      media: 'media-player-close.xml',
    },
  },
};

export function createReferenceLan() {
  return createFakeLan(Object.fromEntries(Object.values(LAN).map((roku) => [roku.ip, roku.spec])));
}
