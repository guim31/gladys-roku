// -----------------------------------------------------------------------------
// User-facing explanations of what went wrong, in English, French, German and
// Spanish (the languages of the Gladys interface).
//
// The menu path of the Roku setting is given with its English labels in the
// other languages too: the labels the user reads on screen depend on the
// language of the Roku, not of Gladys.
// -----------------------------------------------------------------------------

/** The languages of every message sent to Gladys (`en` is its fallback). */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const SETTING_PATH_EN =
  'Settings > System > Advanced system settings > Control by mobile apps > Network access';

/** Fixed messages: the connection status and the command refusals. */
export const MESSAGES = {
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh in den Protokollen der Integration nach.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  unknownRoku: {
    en: 'This Roku is unknown to the integration: run a device scan (Discovery tab).',
    fr: "Ce Roku est inconnu de l'intégration : lancez une recherche d'appareils (onglet Découverte).",
    de: 'Dieser Roku ist der Integration unbekannt: Starte eine Gerätesuche (Tab „Entdecken“).',
    es: 'Este Roku es desconocido para la integración: inicie una búsqueda de dispositivos (pestaña Descubrir).',
  },
  tvOnlyPower: {
    en: 'Only a Roku TV can be turned on and off: a Roku player follows the TV it is plugged in.',
    fr: "Seule une Roku TV s'allume et s'éteint : un lecteur Roku suit la TV sur laquelle il est branché.",
    de: 'Nur ein Roku TV lässt sich ein- und ausschalten: Ein Roku-Player folgt dem Fernseher, an dem er angeschlossen ist.',
    es: 'Solo un Roku TV se enciende y se apaga: un reproductor Roku sigue al televisor al que está conectado.',
  },
};

/**
 * The same text in every language: an error message from elsewhere, or a
 * name.
 *
 * @param {string} text The text.
 * @returns {Record<string, string>} The message.
 */
export function sameInEveryLanguage(text) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, text]));
}

/**
 * The explanation of a RokuError, for an action message, a widget toast or
 * the connection status.
 *
 * @param {Object} err The error (a RokuError, or anything thrown).
 * @param {string} [label] How to name the Roku (its name, else its address).
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 */
export function explainError(err, label) {
  const name = label || err?.ip;
  const who = name || 'the Roku';
  const qui = name || 'le Roku';
  const wer = name || 'Der Roku';
  const quien = name || 'El Roku';
  switch (err?.kind) {
    case 'forbidden':
      return {
        en: `${who} refuses remote control. On the Roku, open ${SETTING_PATH_EN} and choose "Enabled" (not "Limited" or "Disabled"), then try again.`,
        fr: `${qui} refuse le contrôle à distance. Sur le Roku, ouvrez Paramètres > Système > Paramètres système avancés > Contrôle par applications mobiles > Accès réseau (en anglais : ${SETTING_PATH_EN}) et choisissez « Activé » (« Enabled », et non « Limité » ou « Désactivé »), puis réessayez.`,
        de: `${wer} lehnt die Fernsteuerung ab. Öffne auf dem Roku Einstellungen > System > Erweiterte Systemeinstellungen > Steuerung durch mobile Apps > Netzwerkzugriff (auf Englisch: ${SETTING_PATH_EN}), wähle „Aktiviert“ („Enabled“, nicht „Eingeschränkt“ oder „Deaktiviert“) und versuche es erneut.`,
        es: `${quien} rechaza el control remoto. En el Roku, abra Configuración > Sistema > Configuración avanzada del sistema > Control por aplicaciones móviles > Acceso a la red (en inglés: ${SETTING_PATH_EN}), elija "Habilitado" ("Enabled", no "Limitado" ni "Deshabilitado") y vuelva a intentarlo.`,
      };
    case 'refused':
      return {
        en: `Nothing accepts connections on port 8060 at ${err.ip}: either it is not a Roku, or remote control is disabled on it (${SETTING_PATH_EN}: choose "Enabled").`,
        fr: `Rien n'accepte de connexion sur le port 8060 à l'adresse ${err.ip} : ce n'est pas un Roku, ou son contrôle à distance est désactivé (${SETTING_PATH_EN} : choisissez « Enabled »).`,
        de: `Unter ${err.ip} nimmt nichts Verbindungen auf Port 8060 an: Entweder ist es kein Roku, oder seine Fernsteuerung ist deaktiviert (${SETTING_PATH_EN}: „Enabled“ wählen).`,
        es: `Nada acepta conexiones en el puerto 8060 en ${err.ip}: o no es un Roku, o su control remoto está desactivado (${SETTING_PATH_EN}: elija "Enabled").`,
      };
    case 'timeout':
    case 'unreachable':
      return {
        en: `${who} does not answer. Check that it is plugged in, on the same network as Gladys, and that its address has not changed (a DHCP reservation in your router prevents that). A Roku TV in standby only answers when "Fast TV start" is on.`,
        fr: `${qui} ne répond pas. Vérifiez qu'il est branché, sur le même réseau que Gladys, et que son adresse n'a pas changé (une réservation DHCP dans votre box l'évite). Une Roku TV en veille ne répond que si le « démarrage rapide » (Fast TV start) est activé.`,
        de: `${wer} antwortet nicht. Prüfe, ob er eingesteckt ist, im selben Netzwerk wie Gladys, und ob sich seine Adresse nicht geändert hat (eine DHCP-Reservierung im Router verhindert das). Ein Roku TV im Standby antwortet nur, wenn der „Schnellstart“ (Fast TV start) aktiviert ist.`,
        es: `${quien} no responde. Compruebe que esté enchufado, en la misma red que Gladys, y que su dirección no haya cambiado (una reserva DHCP en su router lo evita). Un Roku TV en espera solo responde si el "inicio rápido" (Fast TV start) está activado.`,
      };
    case 'http':
    case 'malformed':
      return {
        en: `${who} gave an unexpected answer (${err.message}). Turn on the debug logs in the configuration and share them in an issue, please.`,
        fr: `${qui} a fait une réponse inattendue (${err.message}). Activez les journaux de débogage dans la configuration et partagez-les dans un ticket, s'il vous plaît.`,
        de: `${wer} hat unerwartet geantwortet (${err.message}). Bitte aktiviere die Debug-Protokolle in der Konfiguration und teile sie in einem Issue.`,
        es: `${quien} dio una respuesta inesperada (${err.message}). Active los registros de depuración en la configuración y compártalos en una incidencia, por favor.`,
      };
    default:
      return err?.messages ?? sameInEveryLanguage(err?.message || String(err));
  }
}

/**
 * The short form of explainError(), for a widget toast (≤ 200 characters).
 *
 * @param {Object} err The error.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 */
export function explainErrorShort(err) {
  switch (err?.kind) {
    case 'forbidden':
      return {
        en: 'Refused by the Roku: set Control by mobile apps > Network access to "Enabled" in its settings.',
        fr: 'Refusé par le Roku : réglez Control by mobile apps > Network access sur « Enabled » dans ses paramètres.',
        de: 'Vom Roku abgelehnt: Stelle in seinen Einstellungen Control by mobile apps > Network access auf „Enabled“.',
        es: 'Rechazado por el Roku: ponga Control by mobile apps > Network access en "Enabled" en sus ajustes.',
      };
    case 'refused':
    case 'timeout':
    case 'unreachable':
      return {
        en: 'The Roku does not answer: is it plugged in, on the same network, at the same address?',
        fr: 'Le Roku ne répond pas : est-il branché, sur le même réseau, à la même adresse ?',
        de: 'Der Roku antwortet nicht: Ist er eingesteckt, im selben Netzwerk, unter derselben Adresse?',
        es: 'El Roku no responde: ¿está enchufado, en la misma red, en la misma dirección?',
      };
    default: {
      const full = explainError(err);
      return Object.fromEntries(
        LANGUAGES.map((language) => [language, full[language].slice(0, 200)]),
      );
    }
  }
}

/**
 * An Error whose message exists in every language: the English one is the
 * `message` (what the SDK acks), the full set rides along in `messages` for
 * the callers that resolve a multi-language message instead of throwing.
 */
export class UserError extends Error {
  /** @param {{ en: string, fr: string, de: string, es: string }} messages */
  constructor(messages) {
    super(messages.en);
    this.name = 'UserError';
    this.messages = messages;
  }
}
