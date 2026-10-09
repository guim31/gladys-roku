// -----------------------------------------------------------------------------
// Widget refresh nudges, at the pace the core accepts.
//
// The core takes one `requestWidgetRefresh` per widget every 10 seconds and
// silently drops the others. A state change right after a nudge must not be
// lost: the nudge is postponed to the end of the window instead (trailing
// edge), so the dashboard always ends up showing the last state.
// -----------------------------------------------------------------------------

export const NUDGE_INTERVAL_MS = 10000;

/**
 * @param {Object} gladys SDK instance.
 * @param {string[]} keys Widget keys.
 * @param {Object} [options] `{ now, schedule }` (tests).
 * @returns {{ nudge(key), nudgeAll(), stop() }}
 */
export function createWidgetNudger(gladys, keys, options = {}) {
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((fn, ms) => {
      const timer = setTimeout(fn, ms);
      timer.unref?.();
      return timer;
    });
  const lastSent = new Map();
  const pending = new Map();

  function send(key) {
    lastSent.set(key, now());
    try {
      gladys.requestWidgetRefresh(key);
    } catch {
      // Not connected: the next content pull shows the state anyway.
    }
  }

  function nudge(key) {
    if (pending.has(key)) {
      return;
    }
    const wait = (lastSent.get(key) ?? -Infinity) + NUDGE_INTERVAL_MS - now();
    if (wait <= 0) {
      send(key);
      return;
    }
    pending.set(
      key,
      schedule(() => {
        pending.delete(key);
        send(key);
      }, wait),
    );
  }

  return {
    nudge,
    nudgeAll() {
      keys.forEach(nudge);
    },
    stop() {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
    },
  };
}
