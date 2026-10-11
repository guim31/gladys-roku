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
import { LANGUAGES, explainError } from './messages.js';

const log = createLogger({ name: 'roku:action' });

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function describe(roku) {
  const { info, state } = roku;
  const model = [info.vendor, info.model || info.modelNumber].filter(Boolean).join(' ');
  const app = state.app && !state.app.home ? state.app.name : null;
  const version = `Roku OS ${info.softwareVersion || '?'}`;
  const en = [
    `${info.name} (${roku.ip}): ${model}, ${version}`,
    info.poweredOn
      ? `on${app ? `, showing ${app}` : ', home screen'}`
      : `in standby (${info.powerMode})`,
  ].join(', ');
  const fr = [
    `${info.name} (${roku.ip}) : ${model}, ${version}`,
    info.poweredOn
      ? `allumé${app ? `, sur ${app}` : ", sur l'accueil"}`
      : `en veille (${info.powerMode})`,
  ].join(', ');
  const de = [
    `${info.name} (${roku.ip}): ${model}, ${version}`,
    info.poweredOn
      ? `eingeschaltet${app ? `, zeigt ${app}` : ', Startbildschirm'}`
      : `im Standby (${info.powerMode})`,
  ].join(', ');
  const es = [
    `${info.name} (${roku.ip}): ${model}, ${version}`,
    info.poweredOn
      ? `encendido${app ? `, en ${app}` : ', en la pantalla de inicio'}`
      : `en espera (${info.powerMode})`,
  ].join(', ');
  return {
    en: `${en}. Remote control accepted.`,
    fr: `${fr}. Contrôle à distance accepté.`,
    de: `${de}. Fernsteuerung akzeptiert.`,
    es: `${es}. Control remoto aceptado.`,
  };
}

/**
 * Test the ECP access to one Roku.
 *
 * @param {Object} manager RokuManager.
 * @param {string} ip Address.
 * @returns {Promise<{ ok: boolean, message: { en, fr, de, es }, roku?: Object }>}
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
 * @returns {Promise<{ en: string, fr: string, de: string, es: string }>} Message shown
 * under the button.
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
        de: 'Die Integration kennt die Adresse dieses Geräts noch nicht: Starte zuerst eine Gerätesuche.',
        es: 'La integración aún no conoce la dirección de este dispositivo: inicie primero una búsqueda de dispositivos.',
      };
    }
    ips = [roku.ip];
  } else if (typedIp) {
    if (!isValidHost(typedIp)) {
      return {
        en: `"${typedIp}" is not an IP address. Expected format: 192.168.1.40.`,
        fr: `« ${typedIp} » n'est pas une adresse IP. Format attendu : 192.168.1.40.`,
        de: `„${typedIp}“ ist keine IP-Adresse. Erwartetes Format: 192.168.1.40.`,
        es: `"${typedIp}" no es una dirección IP. Formato esperado: 192.168.1.40.`,
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
      de: 'Noch kein Roku bekannt. Starte eine Gerätesuche (Tab „Entdecken“) oder gib in dieser Aktion die Adresse deines Roku ein.',
      es: 'Aún no se conoce ningún Roku. Inicie una búsqueda de dispositivos (pestaña Descubrir) o escriba la dirección de su Roku en esta acción.',
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
  const lines = Object.fromEntries(
    LANGUAGES.map((language) => [language, results.map((result) => result.message[language])]),
  );
  if (isNew) {
    lines.en.push(
      'It is now in the Discovery tab. Add its address to the "Roku addresses" field to keep finding it if the network discovery cannot.',
    );
    lines.fr.push(
      "Il est maintenant dans l'onglet Découverte. Ajoutez son adresse au champ « Adresses des Roku » pour le retrouver même si la découverte réseau n'y arrive pas.",
    );
    lines.de.push(
      'Er ist jetzt im Tab „Entdecken“. Füge seine Adresse dem Feld „Roku-Adressen“ hinzu, damit er auch dann gefunden wird, wenn die Netzwerkerkennung es nicht schafft.',
    );
    lines.es.push(
      'Ahora aparece en la pestaña Descubrir. Añada su dirección al campo "Direcciones de los Roku" para encontrarlo aunque el descubrimiento de red no lo consiga.',
    );
  }
  return Object.fromEntries(LANGUAGES.map((language) => [language, lines[language].join('\n')]));
}

/** Manifest action handlers, by key (forever). */
export const ACTIONS = {
  test_connection: testConnection,
};
