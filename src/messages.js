// -----------------------------------------------------------------------------
// User-facing explanations of what went wrong, in English and French.
//
// The menu path of the Roku setting is given with its English labels in the
// French text too: Roku sells few devices in French, and the labels the user
// reads on screen depend on the language of the Roku, not of Gladys.
// -----------------------------------------------------------------------------

const SETTING_PATH_EN =
  'Settings > System > Advanced system settings > Control by mobile apps > Network access';

/**
 * The explanation of a RokuError, for an action message, a widget toast or
 * the connection status.
 *
 * @param {Object} err The error (a RokuError, or anything thrown).
 * @param {string} [label] How to name the Roku (its name, else its address).
 * @returns {{ en: string, fr: string }} The message.
 */
export function explainError(err, label) {
  const who = label || err?.ip || 'the Roku';
  const qui = label || err?.ip || 'le Roku';
  switch (err?.kind) {
    case 'forbidden':
      return {
        en: `${who} refuses remote control. On the Roku, open ${SETTING_PATH_EN} and choose "Enabled" (not "Limited" or "Disabled"), then try again.`,
        fr: `${qui} refuse le contrôle à distance. Sur le Roku, ouvrez Paramètres > Système > Paramètres système avancés > Contrôle par applications mobiles > Accès réseau (en anglais : ${SETTING_PATH_EN}) et choisissez « Activé » (« Enabled », et non « Limité » ou « Désactivé »), puis réessayez.`,
      };
    case 'refused':
      return {
        en: `Nothing accepts connections on port 8060 at ${err.ip}: either it is not a Roku, or remote control is disabled on it (${SETTING_PATH_EN}: choose "Enabled").`,
        fr: `Rien n'accepte de connexion sur le port 8060 à l'adresse ${err.ip} : ce n'est pas un Roku, ou son contrôle à distance est désactivé (${SETTING_PATH_EN} : choisissez « Enabled »).`,
      };
    case 'timeout':
    case 'unreachable':
      return {
        en: `${who} does not answer. Check that it is plugged in, on the same network as Gladys, and that its address has not changed (a DHCP reservation in your router prevents that). A Roku TV in standby only answers when "Fast TV start" is on.`,
        fr: `${qui} ne répond pas. Vérifiez qu'il est branché, sur le même réseau que Gladys, et que son adresse n'a pas changé (une réservation DHCP dans votre box l'évite). Une Roku TV en veille ne répond que si le « démarrage rapide » (Fast TV start) est activé.`,
      };
    case 'http':
    case 'malformed':
      return {
        en: `${who} gave an unexpected answer (${err.message}). Turn on the debug logs in the configuration and share them in an issue, please.`,
        fr: `${qui} a fait une réponse inattendue (${err.message}). Activez les journaux de débogage dans la configuration et partagez-les dans un ticket, s'il vous plaît.`,
      };
    default:
      return {
        en: err?.message || String(err),
        fr: err?.messageFr || err?.message || String(err),
      };
  }
}

/**
 * The short form of explainError(), for a widget toast (≤ 200 characters).
 *
 * @param {Object} err The error.
 * @returns {{ en: string, fr: string }} The message.
 */
export function explainErrorShort(err) {
  switch (err?.kind) {
    case 'forbidden':
      return {
        en: 'Refused by the Roku: set Control by mobile apps > Network access to "Enabled" in its settings.',
        fr: 'Refusé par le Roku : réglez Control by mobile apps > Network access sur « Enabled » dans ses paramètres.',
      };
    case 'refused':
    case 'timeout':
    case 'unreachable':
      return {
        en: 'The Roku does not answer: is it plugged in, on the same network, at the same address?',
        fr: 'Le Roku ne répond pas : est-il branché, sur le même réseau, à la même adresse ?',
      };
    default: {
      const full = explainError(err);
      return { en: full.en.slice(0, 200), fr: full.fr.slice(0, 200) };
    }
  }
}

/**
 * An Error whose message exists in both languages: the English one is the
 * `message` (what the SDK acks), the French one rides along for the callers
 * that resolve a multi-language message instead of throwing.
 */
export class UserError extends Error {
  constructor({ en, fr }) {
    super(en);
    this.name = 'UserError';
    this.messageFr = fr;
  }
}
