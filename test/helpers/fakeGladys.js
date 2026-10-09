// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// The published SDK (0.14.0) does not ship `@gladysassistant/integration-sdk/
// testing` yet, so this reproduces the surface the integration relies on, with
// the host API checks that bite (external id prefix, poll frequency):
//   - externalIds(type, platformId)       -> `ext:<selector>:<type>:<id>` ids
//   - publishStates / publishDiscoveredDevices / setConnectionStatus /
//     publishSceneEvent / requestWidgetRefresh / wakeOnLan -> recorded
//   - scanNetwork(type)                    -> `scanResults[type]`, recorded
//   - on*(…) handler registration          -> `handlers`, for the tests to call
// -----------------------------------------------------------------------------

// Quiet tests: the integration logs through the SDK logger (LOG_LEVEL).
process.env.LOG_LEVEL ??= 'silent';

export const SELECTOR = 'roku-test';
const POLL_FREQUENCIES = [1000, 2000, 10000, 15000, 30000, 60000];

export function createFakeGladys({ scanResults = {}, devices = [], config = {} } = {}) {
  const prefix = `ext:${SELECTOR}:`;
  // Handlers registered by the integration, as the SDK would call them:
  // handlers.setValue(device, feature, value), handlers.action.<key>(fields)…
  const handlers = { action: {}, sceneAction: {}, widgetGet: {}, widgetAction: {}, on: {} };
  const fake = {
    handlers,
    config,
    onScanRequest: (cb) => (handlers.scanRequest = cb),
    onSetValue: (cb) => (handlers.setValue = cb),
    onPoll: (cb) => (handlers.poll = cb),
    onDeviceCreated: (cb) => (handlers.deviceCreated = cb),
    onConfigUpdated: (cb) => (handlers.configUpdated = cb),
    onAction: (key, cb) => (handlers.action[key] = cb),
    onSceneAction: (key, cb) => (handlers.sceneAction[key] = cb),
    onWidgetGet: (key, cb) => (handlers.widgetGet[key] = cb),
    onWidgetAction: (key, cb) => (handlers.widgetAction[key] = cb),
    onWidgetGetImage: (cb) => (handlers.widgetGetImage = cb),
    on: (event, cb) => (handlers.on[event] = cb),
    async getConfig() {
      return fake.config;
    },

    states: [],
    discovered: null,
    discoveredCalls: 0,
    connectionStatuses: [],
    sceneEvents: [],
    widgetRefreshes: [],
    wakes: [],
    scans: [],
    scanResults,
    devices,

    externalId(suffix) {
      return `${prefix}${suffix}`;
    },

    externalIds(type, platformId) {
      const device = `${prefix}${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },

    async publishStates(states) {
      for (const state of states) {
        if (!state.device_feature_external_id.startsWith(prefix)) {
          throw new Error(`400: external id without prefix: ${state.device_feature_external_id}`);
        }
        if (state.text === undefined && typeof state.state !== 'number') {
          throw new Error('400: state must be a number or a text');
        }
      }
      fake.states.push(...states);
      return { success: true };
    },

    async publishState(featureExternalId, value) {
      const state = { device_feature_external_id: featureExternalId };
      if (value !== null && typeof value === 'object') {
        Object.assign(state, value);
      } else {
        state.state = value;
      }
      return fake.publishStates([state]);
    },

    async publishDiscoveredDevices(list) {
      for (const device of list) {
        if (!device.external_id.startsWith(prefix)) {
          throw new Error(`400: device external id without prefix: ${device.external_id}`);
        }
        if (
          device.poll_frequency !== undefined &&
          !POLL_FREQUENCIES.includes(device.poll_frequency)
        ) {
          throw new Error(`400: invalid poll frequency ${device.poll_frequency}`);
        }
      }
      fake.discovered = list;
      fake.discoveredCalls += 1;
      return { success: true, count: list.length };
    },

    async setConnectionStatus(connected, message) {
      fake.connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data = {}) {
      fake.sceneEvents.push({ key, data });
      return { success: true };
    },

    requestWidgetRefresh(key) {
      fake.widgetRefreshes.push(key);
    },

    async wakeOnLan(mac) {
      fake.wakes.push(mac);
      return { success: true };
    },

    async scanNetwork(type, options = {}) {
      fake.scans.push({ type, options });
      const results = fake.scanResults[type];
      if (results instanceof Error) {
        throw results;
      }
      return results ?? [];
    },

    /** The last state published for a feature (`state` or `text`). */
    lastState(featureExternalId) {
      const state = [...fake.states]
        .reverse()
        .find((candidate) => candidate.device_feature_external_id === featureExternalId);
      return state ? (state.text ?? state.state) : undefined;
    },
  };
  return fake;
}
