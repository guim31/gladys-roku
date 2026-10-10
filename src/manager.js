// -----------------------------------------------------------------------------
// What the integration knows of the Rokus, and everything it does with them.
//
// One entry per Roku, keyed by serial number:
//   { serial, ip, mac, info, apps, appsAt, state, reachable, error, failures }
// filled from three sources: the devices the user created in Gladys (their
// ROKU_IP / ROKU_MAC params), the SSDP discovery relayed by the core, and the
// addresses typed in the configuration.
//
// The manager never talks to the dashboard or the scene engine itself: it
// emits `refreshed` (roku) after every read, `changed` (roku) after a read
// that changed something, and
// `appChanged` (serial, previous, current) when the foreground app changed —
// index.js turns them into widget refreshes and scene events.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createLogger } from '@gladysassistant/integration-sdk';
import { RokuClient } from './ecp/client.js';
import { HOME_APP_ID, isTvInput, parseSsdpResult } from './ecp/parse.js';
import {
  FEATURE,
  PARAM_IP,
  PARAM_MAC,
  REMOTE_KEYS,
  buildRokuDevice,
  featureKey,
  inputKey,
  rokuIds,
  rokuStates,
  serialFromExternalId,
} from './devices/roku.js';
import { UserError } from './messages.js';

const log = createLogger({ name: 'roku' });

/** The installed apps are re-read this often (they rarely change). */
export const APPS_REFRESH_MS = 15 * 60 * 1000;
/** ...or sooner when the foreground app is not in the list, at most this often. */
const UNKNOWN_APP_REFRESH_MS = 60 * 1000;
/** SSDP scan length on a scan request, and when looking for a Roku that moved. */
export const SSDP_TIMEOUT_SECONDS = 4;
/** Failed refreshes in a row before looking for the Roku at another address. */
const FAILURES_BEFORE_RELOCATE = 3;
/** At most one "where did it go" SSDP scan this often. */
const RELOCATE_INTERVAL_MS = 10 * 60 * 1000;
/** Delay before re-reading a Roku after a command, so the state follows it. */
const REFRESH_AFTER_COMMAND_MS = 1500;
/** Wake-on-LAN: PowerOn retries, and the delay between them (core: 1 wake / 2 s). */
const WAKE_ATTEMPTS = 4;
const WAKE_RETRY_DELAY_MS = 2500;

const NETWORK_ERRORS = new Set(['unreachable', 'timeout', 'refused']);
/** Longest text typed by the type_text scene action (one request per character). */
export const MAX_TEXT_LENGTH = 100;

/**
 * Lowercase, accent-free, alphanumeric form of an app name, to match what a
 * user typed ("disney plus" finds "Disney+").
 *
 * @param {unknown} name The name.
 * @returns {string} The slug.
 */
export function slug(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]/g, '');
}

function sameApps(a = [], b = []) {
  return (
    a.length === b.length &&
    a.every((app, index) => app.id === b[index].id && app.name === b[index].name)
  );
}

function stateSignature(state) {
  return state.text !== undefined ? `t:${state.text}` : `n:${state.state}`;
}

export class RokuManager extends EventEmitter {
  /**
   * @param {Object} gladys SDK instance.
   * @param {Object} [options]
   * @param {Function} [options.createClient] (ip) => RokuClient (tests).
   * @param {Function} [options.now] Clock (tests).
   * @param {Function} [options.sleep] (ms) => Promise (tests).
   * @param {Function} [options.schedule] (fn, ms) => timer (tests).
   */
  constructor(gladys, options = {}) {
    super();
    this.gladys = gladys;
    this.createClient = options.createClient ?? ((ip) => new RokuClient(ip));
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms);
        timer.unref?.();
        return timer;
      });
    /** @type {Map<string, Object>} */
    this.rokus = new Map();
    /** Last state published per feature external id (publish changes only). */
    this.published = new Map();
    this.inFlight = new Map();
    this.refreshTimers = new Map();
    this.lastRelocateAt = 0;
    this.lastRefreshChanged = false;
    /** Addresses the last discovery could not read: [{ ip, source, error }]. */
    this.lastFailures = [];
    /** Outcome of the last SSDP scan: { at, count, error }. */
    this.lastScan = null;
  }

  // --- Registry ----------------------------------------------------------------

  /**
   * The Roku a device or feature external id points to.
   *
   * @param {unknown} externalId External id.
   * @returns {Object|undefined} The Roku.
   */
  findByExternalId(externalId) {
    const serial = serialFromExternalId(externalId);
    return serial ? this.rokus.get(serial) : undefined;
  }

  /** @returns {Array<Object>} The Rokus whose device-info was read at least once. */
  knownRokus() {
    return [...this.rokus.values()].filter((roku) => roku.info);
  }

  /**
   * How to name a Roku in a message.
   *
   * @param {Object} roku The Roku.
   * @returns {string} "Living room TV (192.168.1.40)".
   */
  label(roku) {
    return roku.info ? `${roku.info.name} (${roku.ip})` : roku.ip;
  }

  entry(serial) {
    let roku = this.rokus.get(serial);
    if (!roku) {
      roku = {
        serial,
        ip: '',
        mac: '',
        info: null,
        apps: null,
        appsAt: 0,
        state: {},
        reachable: null,
        error: null,
        failures: 0,
      };
      this.rokus.set(serial, roku);
    }
    return roku;
  }

  /**
   * Learn the Rokus the user created in Gladys: their address and MAC live in
   * the device params, so a restart needs no scan to reach them.
   *
   * @param {Array<Object>} devices `gladys.devices`.
   */
  syncCreatedDevices(devices = []) {
    for (const device of devices) {
      const serial = serialFromExternalId(device?.external_id);
      if (!serial) {
        continue;
      }
      const params = Object.fromEntries((device.params ?? []).map((p) => [p.name, p.value]));
      const roku = this.entry(serial);
      // An address found by a scan is newer than the stored one.
      if (!roku.ip && params[PARAM_IP]) {
        roku.ip = params[PARAM_IP];
      }
      if (!roku.mac && params[PARAM_MAC]) {
        roku.mac = params[PARAM_MAC];
      }
      roku.created = true;
    }
  }

  // --- Discovery ---------------------------------------------------------------

  /**
   * Ask the core for an SSDP search of `roku:ecp`.
   *
   * @param {number} [timeoutSeconds] Scan length.
   * @returns {Promise<Array<{ ip, serial, mac }>>} The Rokus that answered.
   */
  async scanSsdp(timeoutSeconds = SSDP_TIMEOUT_SECONDS) {
    try {
      const results = await this.gladys.scanNetwork('ssdp', { timeoutSeconds });
      const found = new Map();
      for (const result of results ?? []) {
        const parsed = parseSsdpResult(result);
        if (parsed && !found.has(parsed.ip)) {
          found.set(parsed.ip, parsed);
        }
      }
      log.info(`SSDP: ${found.size} Roku(s) answered (${(results ?? []).length} replies)`);
      for (const roku of found.values()) {
        log.debug(`SSDP: Roku ${roku.serial || '(no serial)'} at ${roku.ip}`);
      }
      this.lastScan = { at: this.now(), count: found.size, error: null };
      return [...found.values()];
    } catch (err) {
      // 403: a core without SSDP discovery; 409: a scan already running.
      log.warn(
        `SSDP discovery unavailable (${err.status ?? ''} ${err.message}): manual addresses only`,
      );
      this.lastScan = { at: this.now(), count: 0, error: err };
      return [];
    }
  }

  /**
   * Read a Roku at an address and remember it under its serial number.
   *
   * @param {string} ip Address.
   * @param {{ mac?: string }} [hint] What the scan already knows.
   * @returns {Promise<Object>} The Roku.
   */
  async probe(ip, hint = {}) {
    const client = this.createClient(ip);
    const info = await client.deviceInfo();
    const roku = this.entry(info.serial);
    if (roku.ip && roku.ip !== ip) {
      log.info(`${info.name}: address changed from ${roku.ip} to ${ip}`);
    }
    roku.ip = ip;
    roku.mac = info.mac || hint.mac || roku.mac;
    this.applyInfo(roku, info);
    try {
      await this.refreshApps(roku, client);
    } catch (err) {
      // The device is known all the same; its app list comes with a poll.
      log.debug(`${info.name}: apps not read (${err.message})`);
    }
    return roku;
  }

  applyInfo(roku, info) {
    roku.info = info;
    roku.reachable = true;
    roku.error = null;
    roku.failures = 0;
    roku.state.poweredOn = info.poweredOn;
    roku.state.powerMode = info.powerMode;
    log.debug(
      `${info.name} (${roku.ip}): ${info.vendor} ${info.model} [${info.modelNumber}], ` +
        `${info.deviceType}, Roku OS ${info.softwareVersion}, power-mode=${info.powerMode || '?'}`,
    );
  }

  /**
   * Find every Roku: SSDP, the addresses of the configuration, and the
   * addresses already known (created devices).
   *
   * @param {{ hosts: string[] }} config Normalized configuration.
   * @param {{ ssdp?: boolean }} [options] `ssdp: false` skips the network scan.
   * @returns {Promise<{ found: Array<Object>, failures: Array<{ ip, source, error }> }>}
   */
  async discover(config, { ssdp = true } = {}) {
    const candidates = new Map();
    const add = (ip, source, hint = {}) => {
      if (ip && !candidates.has(ip)) {
        candidates.set(ip, { ip, source, hint });
      }
    };
    if (ssdp) {
      for (const result of await this.scanSsdp()) {
        add(result.ip, 'ssdp', result);
      }
    }
    for (const host of config.hosts ?? []) {
      add(host, 'config');
    }
    for (const roku of this.rokus.values()) {
      add(roku.ip, 'known', { mac: roku.mac });
    }
    const outcomes = await Promise.allSettled(
      [...candidates.values()].map((candidate) => this.probe(candidate.ip, candidate.hint)),
    );
    const found = [];
    const failures = [];
    [...candidates.values()].forEach((candidate, index) => {
      const outcome = outcomes[index];
      if (outcome.status === 'fulfilled') {
        if (!found.includes(outcome.value)) {
          found.push(outcome.value);
        }
      } else {
        const error = outcome.reason;
        failures.push({ ip: candidate.ip, source: candidate.source, error });
        const known = [...this.rokus.values()].find((roku) => roku.ip === candidate.ip);
        if (known && error?.kind === 'forbidden') {
          known.error = error;
        }
        // A known Roku that does not answer is usually a TV in standby: no warning.
        const level = candidate.source === 'known' && error?.kind !== 'forbidden' ? 'info' : 'warn';
        log[level](`No Roku read at ${candidate.ip} (${candidate.source}): ${error?.message}`);
      }
    });
    log.info(`Discovery: ${found.length} Roku(s) ready, ${failures.length} address(es) failed`);
    this.lastFailures = failures;
    return { found, failures };
  }

  /**
   * The Rokus that refuse ECP ("Control by mobile apps" not on Enabled):
   * known ones, and addresses the last discovery could not read for that
   * reason (a Roku in Limited mode may refuse even its device-info).
   *
   * @returns {Array<{ label: string, error: Object }>} One entry per Roku.
   */
  refusing() {
    const entries = this.knownRokus()
      .filter((roku) => roku.error?.kind === 'forbidden')
      .map((roku) => ({ label: this.label(roku), error: roku.error }));
    const readIps = new Set(
      this.knownRokus()
        .filter((roku) => roku.error?.kind !== 'forbidden')
        .map((roku) => roku.ip),
    );
    for (const failure of this.lastFailures) {
      const listed = entries.some((entry) => entry.error.ip === failure.ip);
      if (failure.error?.kind === 'forbidden' && !readIps.has(failure.ip) && !listed) {
        entries.push({ label: failure.ip, error: failure.error });
      }
    }
    return entries;
  }

  /** @returns {Array<Object>} The discovery payload of every known Roku. */
  buildDiscoveredDevices() {
    return this.knownRokus().map((roku) => buildRokuDevice(this.gladys, roku));
  }

  /** Publish every known Roku to the Discovery tab (the core upserts params and options). */
  async publishDiscovered() {
    await this.gladys.publishDiscoveredDevices(this.buildDiscoveredDevices());
  }

  // --- State -------------------------------------------------------------------

  async refreshApps(roku, client = this.createClient(roku.ip)) {
    const apps = await client.apps();
    roku.appsAt = this.now();
    const changed = !sameApps(roku.apps ?? [], apps);
    roku.apps = apps;
    if (changed) {
      log.debug(`${this.label(roku)}: ${apps.length} apps/inputs installed`);
    }
    return changed;
  }

  needsApps(roku) {
    if (!roku.apps) {
      return true;
    }
    const age = this.now() - roku.appsAt;
    if (age >= APPS_REFRESH_MS) {
      return true;
    }
    const app = roku.state.app;
    const unknown = app && !app.home && !roku.apps.some((candidate) => candidate.id === app.id);
    return Boolean(unknown) && age >= UNKNOWN_APP_REFRESH_MS;
  }

  /**
   * Re-read a Roku and publish what changed. Concurrent calls share one read.
   *
   * @param {string} serial Serial number.
   * @returns {Promise<Object|undefined>} The Roku.
   */
  refresh(serial) {
    if (!this.inFlight.has(serial)) {
      const run = this.doRefresh(serial).finally(() => this.inFlight.delete(serial));
      this.inFlight.set(serial, run);
    }
    return this.inFlight.get(serial);
  }

  async doRefresh(serial) {
    const roku = this.rokus.get(serial);
    if (!roku?.ip) {
      return roku;
    }
    const before = {
      app: roku.state.app?.id,
      appName: roku.state.app?.name,
      reachable: roku.reachable,
      error: roku.error?.kind,
    };
    let appsChanged = false;
    let infoChanged = false;
    try {
      const client = this.createClient(roku.ip);
      const info = await client.deviceInfo();
      if (info.serial !== serial) {
        // Another Roku took this address (DHCP): look for ours elsewhere.
        throw Object.assign(new Error(`${roku.ip} is now another Roku (${info.serial})`), {
          kind: 'unreachable',
          ip: roku.ip,
        });
      }
      infoChanged = !roku.info || roku.info.name !== info.name || roku.info.isTv !== info.isTv;
      this.applyInfo(roku, info);
      if (info.poweredOn) {
        const app = await client.activeApp();
        roku.state.app = app;
        if (app.home || isTvInput(app.id)) {
          roku.state.playing = false;
          roku.state.media = null;
        } else {
          const media = await client.mediaPlayer().catch((err) => {
            if (err.kind === 'forbidden') {
              throw err;
            }
            log.debug(`${info.name}: media-player not read (${err.message})`);
            return null;
          });
          roku.state.media = media;
          if (media && media.playing !== null) {
            roku.state.playing = media.playing;
          }
        }
        log.debug(
          `${info.name}: app=${app.id} (${app.name})${app.screensaver ? ' +screensaver' : ''}` +
            `, player=${roku.state.media?.state ?? '-'}`,
        );
      } else {
        roku.state.playing = false;
        roku.state.media = null;
      }
      if (this.needsApps(roku)) {
        appsChanged = await this.refreshApps(roku, client);
      }
    } catch (err) {
      this.recordFailure(roku, err);
      if (roku.failures >= FAILURES_BEFORE_RELOCATE && (await this.relocate(roku))) {
        return this.doRefresh(serial);
      }
    }

    // A refusing Roku says nothing reliable: publish nothing rather than a guess.
    if (roku.error?.kind !== 'forbidden') {
      await this.publishStates(roku);
    } else {
      this.lastRefreshChanged = false;
    }
    if (appsChanged || infoChanged) {
      await this.publishDiscovered().catch((err) =>
        log.warn(`Discovered devices not re-published: ${err.message}`),
      );
    }
    const app = roku.state.app;
    if (app?.id && before.app && app.id !== before.app && roku.reachable) {
      this.emit('appChanged', roku, { id: before.app, name: before.appName }, app);
    }
    if (
      appsChanged ||
      app?.id !== before.app ||
      roku.reachable !== before.reachable ||
      roku.error?.kind !== before.error ||
      this.lastRefreshChanged
    ) {
      this.emit('changed', roku);
    }
    // After every read, changed or not: the widgets compare what they show.
    this.emit('refreshed', roku);
    return roku;
  }

  recordFailure(roku, err) {
    const wasKind = roku.error?.kind;
    roku.error = err;
    if (err?.kind === 'forbidden') {
      // The Roku answers, it only refuses: its power state is unknown.
      roku.reachable = true;
      if (wasKind !== 'forbidden') {
        log.warn(
          `${this.label(roku)}: ECP refused (${err.message}) - see "Control by mobile apps"`,
        );
      }
      return;
    }
    roku.failures += 1;
    roku.reachable = false;
    roku.state.playing = false;
    roku.state.media = null;
    const message = `${this.label(roku)}: not reachable (${err?.message})`;
    if (roku.failures === 1) {
      log.info(message);
    } else {
      log.debug(message);
    }
  }

  /**
   * A Roku stopped answering: maybe DHCP gave it another address. One SSDP
   * scan (rate-limited) finds it by serial number.
   *
   * @param {Object} roku The Roku.
   * @returns {Promise<boolean>} True when it was found elsewhere.
   */
  async relocate(roku) {
    if (this.now() - this.lastRelocateAt < RELOCATE_INTERVAL_MS) {
      return false;
    }
    this.lastRelocateAt = this.now();
    const knownIps = new Set([...this.rokus.values()].map((known) => known.ip));
    // The USN of the reply carries the serial number: check it first, then
    // any address no known Roku uses (the device-info serial is the truth).
    const candidates = (await this.scanSsdp())
      .filter((result) => result.ip !== roku.ip)
      .filter((result) => result.serial === roku.serial || !knownIps.has(result.ip))
      .sort((a, b) => Number(b.serial === roku.serial) - Number(a.serial === roku.serial));
    let match;
    for (const candidate of candidates) {
      const info = await this.createClient(candidate.ip)
        .deviceInfo()
        .catch(() => null);
      if (info?.serial === roku.serial) {
        match = candidate;
        break;
      }
    }
    if (!match) {
      return false;
    }
    log.info(`${this.label(roku)}: found again at ${match.ip}`);
    roku.ip = match.ip;
    roku.failures = 0;
    await this.publishDiscovered().catch((err) =>
      log.warn(`Discovered devices not re-published: ${err.message}`),
    );
    return true;
  }

  /**
   * Publish the states of a Roku that changed since the last publication.
   *
   * @param {Object} roku The Roku.
   * @returns {Promise<number>} How many states were sent.
   */
  async publishStates(roku) {
    const changed = rokuStates(this.gladys, roku).filter(
      (state) => this.published.get(state.device_feature_external_id) !== stateSignature(state),
    );
    this.lastRefreshChanged = changed.length > 0;
    if (changed.length === 0) {
      return 0;
    }
    await this.gladys.publishStates(changed);
    for (const state of changed) {
      this.published.set(state.device_feature_external_id, stateSignature(state));
    }
    log.debug(
      `${this.label(roku)}: published ${changed.map((s) => `${s.device_feature_external_id.split(':').pop()}=${s.text ?? s.state}`).join(', ')}`,
    );
    return changed.length;
  }

  /**
   * Forget what was published for a Roku, so the next publication sends every
   * state again (the core drops the states of a feature not created yet).
   *
   * @param {string} serial Serial number.
   */
  forgetPublished(serial) {
    const prefix = `${rokuIds(this.gladys, serial).device}:`;
    for (const key of [...this.published.keys()]) {
      if (key.startsWith(prefix)) {
        this.published.delete(key);
      }
    }
  }

  scheduleRefresh(serial, delayMs = REFRESH_AFTER_COMMAND_MS) {
    clearTimeout(this.refreshTimers.get(serial));
    this.refreshTimers.set(
      serial,
      this.schedule(() => {
        this.refreshTimers.delete(serial);
        this.refresh(serial).catch((err) =>
          log.debug(`Refresh after command failed: ${err.message}`),
        );
      }, delayMs),
    );
  }

  stop() {
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
  }

  // --- Commands ----------------------------------------------------------------

  /**
   * The Roku a command targets, or a clear error.
   *
   * @param {string} serial Serial number.
   * @returns {Object} The Roku.
   */
  require(serial) {
    const roku = this.rokus.get(serial);
    if (!roku?.ip) {
      throw new UserError({
        en: 'This Roku is unknown to the integration: run a device scan (Discovery tab).',
        fr: "Ce Roku est inconnu de l'intégration : lancez une recherche d'appareils (onglet Découverte).",
      });
    }
    return roku;
  }

  async run(roku, command) {
    try {
      await command(this.createClient(roku.ip));
      if (roku.error?.kind === 'forbidden') {
        roku.error = null;
      }
    } catch (err) {
      if (err?.kind === 'forbidden' && roku.error?.kind !== 'forbidden') {
        roku.error = err;
        this.emit('changed', roku);
      }
      throw err;
    } finally {
      this.scheduleRefresh(roku.serial);
    }
  }

  /**
   * Press a remote key.
   *
   * @param {string} serial Serial number.
   * @param {string} ecpKey ECP key name.
   * @param {number} [times] Repetitions.
   */
  async pressKey(serial, ecpKey, times = 1) {
    const roku = this.require(serial);
    log.debug(`${this.label(roku)}: key ${ecpKey}${times > 1 ? ` x${times}` : ''}`);
    await this.run(roku, async (client) => {
      for (let i = 0; i < times; i += 1) {
        await client.keypress(ecpKey);
      }
    });
  }

  /**
   * Type a text in the field the Roku shows, one `Lit_` key per character
   * (the only text input ECP has). The text is never logged: it may be a
   * login.
   *
   * @param {string} serial Serial number.
   * @param {string} text Text, at most MAX_TEXT_LENGTH characters.
   */
  async typeText(serial, text) {
    const roku = this.require(serial);
    const characters = [...String(text ?? '')];
    if (characters.length === 0) {
      throw new Error('No text to type');
    }
    if (characters.length > MAX_TEXT_LENGTH) {
      throw new Error(`The text holds ${characters.length} characters, ${MAX_TEXT_LENGTH} at most`);
    }
    log.debug(`${this.label(roku)}: typing ${characters.length} characters`);
    await this.run(roku, async (client) => {
      for (const character of characters) {
        await client.keypress(`Lit_${character}`);
      }
    });
  }

  /**
   * Turn a Roku TV on or off. A TV that does not answer is woken up with
   * Wake-on-LAN first when its MAC address is known.
   *
   * @param {string} serial Serial number.
   * @param {boolean} on Target state.
   */
  async setPower(serial, on) {
    const roku = this.require(serial);
    if (roku.info && !roku.info.isTv) {
      throw new UserError({
        en: 'Only a Roku TV can be turned on and off: a Roku player follows the TV it is plugged in.',
        fr: "Seule une Roku TV s'allume et s'éteint : un lecteur Roku suit la TV sur laquelle il est branché.",
      });
    }
    log.debug(`${this.label(roku)}: power ${on ? 'on' : 'off'}`);
    await this.run(roku, async (client) => {
      try {
        await client.keypress(on ? 'PowerOn' : 'PowerOff');
        return;
      } catch (err) {
        if (!on || !NETWORK_ERRORS.has(err?.kind) || !roku.mac) {
          throw err;
        }
        log.info(`${this.label(roku)}: no answer, sending Wake-on-LAN`);
      }
      let lastError;
      for (let attempt = 0; attempt < WAKE_ATTEMPTS; attempt += 1) {
        await this.gladys.wakeOnLan(roku.mac).catch((err) => {
          log.debug(`Wake-on-LAN not sent: ${err.message}`);
        });
        await this.sleep(WAKE_RETRY_DELAY_MS);
        try {
          await client.keypress('PowerOn');
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    });
  }

  /**
   * Find an app of a Roku by id or by name (case, accents and spaces ignored).
   *
   * @param {Object} roku The Roku.
   * @param {string} wanted Id or name.
   * @returns {Object|undefined} The app ({ id, name }).
   */
  findApp(roku, wanted) {
    const key = slug(wanted);
    if (!key) {
      return undefined;
    }
    if (key === 'home' || key === 'accueil') {
      return { id: HOME_APP_ID, name: 'Home' };
    }
    const apps = roku.apps ?? [];
    return (
      apps.find((app) => app.id === String(wanted).trim()) ??
      apps.find((app) => slug(app.name) === key) ??
      apps.find((app) => slug(app.name).startsWith(key))
    );
  }

  /**
   * Bring an app (or a TV input, or the home screen) to the foreground.
   *
   * @param {string} serial Serial number.
   * @param {string} appId App id, `tvinput.*`, or `home`.
   */
  async launch(serial, appId) {
    const roku = this.require(serial);
    log.debug(`${this.label(roku)}: launch ${appId}`);
    await this.run(roku, async (client) => {
      if (appId === HOME_APP_ID) {
        await client.keypress('Home');
        return;
      }
      try {
        await client.launch(appId);
      } catch (err) {
        // Some Roku TVs refuse /launch for an input: its own key works.
        const key = inputKey(appId);
        if (!key || err?.kind !== 'http') {
          throw err;
        }
        await client.keypress(key);
      }
    });
  }

  /**
   * Handler of `onSetValue`.
   *
   * @param {Object} device Gladys device.
   * @param {Object} feature Gladys feature.
   * @param {number|string} value Value.
   */
  async setValue(device, feature, value) {
    const serial = serialFromExternalId(device?.external_id);
    if (!this.rokus.has(serial)) {
      this.syncCreatedDevices([device]);
    }
    this.require(serial);
    const key = featureKey(device.external_id, feature.external_id);
    if (key === FEATURE.POWER) {
      await this.setPower(serial, Number(value) === 1);
      return;
    }
    if (key === FEATURE.APP || key === FEATURE.INPUT) {
      const appId = String(value ?? '').trim();
      if (!appId) {
        throw new Error('No application selected');
      }
      await this.launch(serial, appId);
      return;
    }
    const remoteKey = REMOTE_KEYS.find((entry) => key === `key:${entry.key}`);
    if (remoteKey) {
      await this.pressKey(serial, remoteKey.ecp);
      return;
    }
    throw new Error(`Unknown feature: ${feature.external_id}`);
  }

  /**
   * Handler of `onDeviceCreated`: re-send every state of the Roku, which the
   * core dropped while its features did not exist.
   *
   * @param {Object} device Gladys device.
   */
  async deviceCreated(device) {
    this.syncCreatedDevices([device]);
    const serial = serialFromExternalId(device.external_id);
    if (!serial) {
      return;
    }
    this.forgetPublished(serial);
    await this.refresh(serial);
  }
}
