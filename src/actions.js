// -----------------------------------------------------------------------------
// Manifest actions (buttons of the Configuration screen).
//
//   - test_connection: read a Roku (picked among the created devices, typed
//     by address, or every known one) and say, in plain words, what works:
//     model, Roku OS version, power, foreground app, and whether ECP accepts
//     the requests. A Roku found at a typed address joins the Discovery tab.
//
// Fields: a core action applies no `default` and requires every `required`
// field, so both fields are optional and the handler sorts it out.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isValidHost } from './ecp/client.js';
import { explainError } from './messages.js';

const log = createLogger({ name: 'roku:action' });

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function describe(roku) {
  const { info, state } = roku;
  const model = [info.vendor, info.model || info.modelNumber].filter(Boolean).join(' ');
  const app = state.app && !state.app.home ? state.app.name : null;
  const en = [
    `${info.name} (${roku.ip}): ${model}, Roku OS ${info.softwareVersion || '?'}`,
    info.poweredOn
      ? `on${app ? `, showing ${app}` : ', home screen'}`
      : `in standby (${info.powerMode})`,
  ].join(', ');
  const fr = [
    `${info.name} (${roku.ip}) : ${model}, Roku OS ${info.softwareVersion || '?'}`,
    info.poweredOn
      ? `allumé${app ? `, sur ${app}` : ", sur l'accueil"}`
      : `en veille (${info.powerMode})`,
  ].join(', ');
  return {
    en: `${en}. Remote control accepted.`,
    fr: `${fr}. Contrôle à distance accepté.`,
  };
}

/**
 * Test the ECP access to one Roku.
 *
 * @param {Object} manager RokuManager.
 * @param {string} ip Address.
 * @returns {Promise<{ ok: boolean, message: { en, fr }, roku?: Object }>}
 */
async function testOne(manager, ip) {
  try {
    const roku = await manager.probe(ip);
    // device-info alone may pass in Limited mode: read what a poll reads.
    await manager.refresh(roku.serial);
    if (roku.error) {
      throw roku.error;
    }
    return { ok: true, message: describe(roku), roku };
  } catch (err) {
    log.info(`Connection test to ${ip} failed: ${err.message}`);
    return { ok: false, message: explainError(err) };
  }
}

/**
 * Handler of the `test_connection` action.
 *
 * @param {Object} context `{ fields, manager, config }`.
 * @returns {Promise<{ en: string, fr: string }>} Message shown under the button.
 */
export async function testConnection({ fields, manager, config }) {
  const device = trim(fields?.device);
  const typedIp = trim(fields?.ip);
  let ips;
  if (device) {
    const roku = manager.findByExternalId(device);
    if (!roku?.ip) {
      return {
        en: 'The integration does not know the address of this device yet: run a device scan first.',
        fr: "L'intégration ne connaît pas encore l'adresse de cet appareil : lancez d'abord une recherche d'appareils.",
      };
    }
    ips = [roku.ip];
  } else if (typedIp) {
    if (!isValidHost(typedIp)) {
      return {
        en: `"${typedIp}" is not an IP address. Expected format: 192.168.1.40.`,
        fr: `« ${typedIp} » n'est pas une adresse IP. Format attendu : 192.168.1.40.`,
      };
    }
    ips = [typedIp];
  } else {
    ips = [
      ...new Set([...manager.rokus.values()].map((roku) => roku.ip).concat(config.hosts)),
    ].filter(Boolean);
  }
  if (ips.length === 0) {
    return {
      en: 'No Roku known yet. Run a device scan (Discovery tab), or type the address of your Roku in this action.',
      fr: "Aucun Roku connu pour l'instant. Lancez une recherche d'appareils (onglet Découverte), ou saisissez l'adresse de votre Roku dans cette action.",
    };
  }
  const results = [];
  for (const ip of ips) {
    results.push(await testOne(manager, ip));
  }
  const isNew = typedIp && results[0]?.ok && !results[0].roku.created;
  if (results.some((result) => result.ok)) {
    await manager.publishDiscovered().catch((err) => log.warn(`Publish failed: ${err.message}`));
  }
  const en = results.map((result) => result.message.en);
  const fr = results.map((result) => result.message.fr);
  if (isNew) {
    en.push(
      'It is now in the Discovery tab. Add its address to the "Roku addresses" field to keep finding it if the network discovery cannot.',
    );
    fr.push(
      "Il est maintenant dans l'onglet Découverte. Ajoutez son adresse au champ « Adresses des Roku » pour le retrouver même si la découverte réseau n'y arrive pas.",
    );
  }
  return { en: en.join('\n'), fr: fr.join('\n') };
}

/** Manifest action handlers, by key (forever). */
export const ACTIONS = {
  test_connection: testConnection,
};
