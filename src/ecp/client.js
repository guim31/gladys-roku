// -----------------------------------------------------------------------------
// HTTP client of the Roku External Control Protocol (ECP), port 8060.
//
// ECP is plain HTTP on the local network, documented by Roku:
// https://developer.roku.com/docs/developer-program/dev-tools/external-control-api.md
// Queries are GETs answering XML, commands are POSTs with an empty body.
// Node's global fetch is enough: no dependency.
//
// Every failure is a RokuError carrying a `kind`, so the callers can tell the
// user what to do. `forbidden` is the one that matters most: recent Roku OS
// releases ship "Control by mobile apps" set to Limited (or let the user
// disable it), and the Roku then answers 403 to most of ECP.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { parseActiveApp, parseApps, parseDeviceInfo, parseMediaPlayer } from './parse.js';

export const ECP_PORT = 8060;
const DEFAULT_TIMEOUT_MS = 5000;

const log = createLogger({ name: 'roku:ecp' });

export class RokuError extends Error {
  /**
   * @param {string} message Technical message (logs).
   * @param {Object} details
   * @param {'forbidden'|'unreachable'|'refused'|'timeout'|'http'|'malformed'} details.kind
   * @param {string} details.ip Address of the Roku.
   * @param {string} [details.path] ECP path.
   * @param {number} [details.status] HTTP status.
   */
  constructor(message, { kind, ip, path, status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RokuError';
    this.kind = kind;
    this.ip = ip;
    this.path = path;
    this.status = status;
  }
}

function networkErrorCode(err) {
  return err?.cause?.code || err?.code || '';
}

/**
 * Validate an IPv4 address or a host name typed by a user.
 *
 * @param {unknown} host The value.
 * @returns {boolean} True when it can be put in an URL as is.
 */
export function isValidHost(host) {
  if (typeof host !== 'string' || !host || host.length > 253) {
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').every((part) => Number(part) <= 255);
  }
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(host);
}

export class RokuClient {
  /**
   * @param {string} ip Address of the Roku.
   * @param {Object} [options]
   * @param {number} [options.port] ECP port (8060).
   * @param {number} [options.timeoutMs] Per-request timeout.
   * @param {Function} [options.fetch] fetch implementation (tests).
   */
  constructor(
    ip,
    { port = ECP_PORT, timeoutMs = DEFAULT_TIMEOUT_MS, fetch = globalThis.fetch } = {},
  ) {
    if (!isValidHost(ip)) {
      throw new RokuError(`Invalid Roku address: ${ip}`, { kind: 'unreachable', ip });
    }
    this.ip = ip;
    this.baseUrl = `http://${ip}:${port}`;
    this.timeoutMs = timeoutMs;
    this.fetch = fetch;
  }

  /**
   * Run one ECP request.
   *
   * @param {'GET'|'POST'} method HTTP method.
   * @param {string} path ECP path, e.g. `/query/device-info`.
   * @param {'text'|'binary'} [as] How to read the body.
   * @returns {Promise<{ body: string|Buffer, contentType: string }>} The answer.
   */
  async request(method, path, as = 'text') {
    const started = Date.now();
    // A typed character never reaches the logs or an error message: it may
    // belong to a login.
    const shown = path.startsWith('/keypress/Lit_') ? '/keypress/Lit_*' : path;
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/xml, text/xml, */*' },
        body: method === 'POST' ? '' : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const code = networkErrorCode(err);
      const elapsed = Date.now() - started;
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        log.debug(`${method} ${this.ip}${shown} -> timeout after ${elapsed} ms`);
        throw new RokuError(`No answer from ${this.ip} within ${this.timeoutMs} ms`, {
          kind: 'timeout',
          ip: this.ip,
          path: shown,
          cause: err,
        });
      }
      log.debug(`${method} ${this.ip}${shown} -> ${code || err?.message} after ${elapsed} ms`);
      throw new RokuError(`Cannot reach ${this.ip}:${ECP_PORT} (${code || err?.message})`, {
        kind: code === 'ECONNREFUSED' ? 'refused' : 'unreachable',
        ip: this.ip,
        path: shown,
        cause: err,
      });
    }
    const elapsed = Date.now() - started;
    log.debug(`${method} ${this.ip}${shown} -> HTTP ${response.status} (${elapsed} ms)`);
    if (response.status === 401 || response.status === 403) {
      // The body says why (Limited mode, disabled...): useful in a bug report.
      const reason = (await response.text().catch(() => '')).slice(0, 200).trim();
      log.debug(`${this.ip}${shown} refused by the Roku${reason ? `: ${reason}` : ''}`);
      throw new RokuError(`The Roku at ${this.ip} refused ${shown} (HTTP ${response.status})`, {
        kind: 'forbidden',
        ip: this.ip,
        path: shown,
        status: response.status,
      });
    }
    if (!response.ok) {
      throw new RokuError(`The Roku at ${this.ip} answered HTTP ${response.status} to ${shown}`, {
        kind: 'http',
        ip: this.ip,
        path: shown,
        status: response.status,
      });
    }
    const contentType = response.headers.get('content-type') || '';
    const body =
      as === 'binary' ? Buffer.from(await response.arrayBuffer()) : await response.text();
    return { body, contentType };
  }

  async query(path, parser) {
    const { body } = await this.request('GET', path);
    try {
      return parser(body);
    } catch (err) {
      log.debug(`${this.ip}${path}: unreadable answer (${err.message}): ${body.slice(0, 200)}`);
      throw new RokuError(`Unreadable answer from ${this.ip}${path}: ${err.message}`, {
        kind: 'malformed',
        ip: this.ip,
        path,
        cause: err,
      });
    }
  }

  /** @returns {Promise<Object>} See parseDeviceInfo(). */
  deviceInfo() {
    return this.query('/query/device-info', parseDeviceInfo);
  }

  /** @returns {Promise<Array<Object>>} See parseApps(). */
  apps() {
    return this.query('/query/apps', parseApps);
  }

  /** @returns {Promise<Object>} See parseActiveApp(). */
  activeApp() {
    return this.query('/query/active-app', parseActiveApp);
  }

  /** @returns {Promise<Object>} See parseMediaPlayer(). */
  mediaPlayer() {
    return this.query('/query/media-player', parseMediaPlayer);
  }

  /**
   * Press a remote key (`Home`, `Select`, `PowerOn`, `VolumeUp`…).
   *
   * @param {string} key ECP key name.
   */
  async keypress(key) {
    await this.request('POST', `/keypress/${encodeURIComponent(key)}`);
  }

  /**
   * Launch an app, or switch a Roku TV to an input (`tvinput.hdmi1`).
   *
   * @param {string} appId App id.
   */
  async launch(appId) {
    await this.request('POST', `/launch/${encodeURIComponent(appId)}`);
  }

  /**
   * The icon of an app, as served by the Roku (PNG or JPEG).
   *
   * @param {string} appId App id.
   * @returns {Promise<{ body: Buffer, contentType: string }>} The image.
   */
  icon(appId) {
    return this.request('GET', `/query/icon/${encodeURIComponent(appId)}`, 'binary');
  }
}
