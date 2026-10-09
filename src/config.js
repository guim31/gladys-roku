// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or with a raw string.
// -----------------------------------------------------------------------------

import { isValidHost } from './ecp/client.js';

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // Addresses typed by hand, for a Roku the network discovery does not find.
  hosts: '',
  // Writes every ECP request and answer summary in the logs.
  debug_logs: false,
};

/**
 * Split the "Roku addresses" field: commas, semicolons or spaces separate the
 * entries, duplicates and invalid entries are dropped.
 *
 * @param {unknown} raw The field value.
 * @returns {{ hosts: string[], invalid: string[] }} Valid addresses, and the rest.
 */
export function parseHosts(raw) {
  const entries = String(raw ?? '')
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const hosts = [];
  const invalid = [];
  for (const entry of entries) {
    // Accept a pasted "http://192.168.1.40:8060/" too.
    const host = entry.replace(/^https?:\/\//i, '').replace(/(:\d+)?\/?$/, '');
    if (!isValidHost(host)) {
      invalid.push(entry);
    } else if (!hosts.includes(host)) {
      hosts.push(host);
    }
  }
  return { hosts, invalid };
}

/**
 * Merge the user config with the defaults.
 *
 * @param {Record<string, unknown>} raw Config returned by the SDK.
 * @returns {{ hosts: string[], invalidHosts: string[], debug_logs: boolean }} The config.
 */
export function normalizeConfig(raw = {}) {
  const { hosts, invalid } = parseHosts(raw?.hosts ?? DEFAULT_CONFIG.hosts);
  return {
    hosts,
    invalidHosts: invalid,
    debug_logs: raw?.debug_logs === true || raw?.debug_logs === 'true',
  };
}
