// -----------------------------------------------------------------------------
// The dashboard-widget path of the Gladys core 5.1.4, simulated on top of the
// fake SDK, with a virtual clock. Reproduces what a real dashboard does:
//   - the content of a widget is cached until its `ttl_seconds`, or until a
//     nudge (`requestWidgetRefresh`, 1 per 10 s per widget) or an action
//     invalidates it; every open box then fetches it again;
//   - a fetch that misses the cache "pulls" the content from the integration:
//     at most 30 pulls per minute per integration, in a fixed one-minute
//     window where refused attempts count too (countPerMinute); beyond, 429;
//   - a box answered 429 keeps showing its last content and retries 60 s later;
//   - an action re-reads the content (the allowlist of its action key):
//     when that pull is refused, the action never reaches the integration.
// Source: server/lib/external-integration/externalIntegration.{getWidgetContent,
// runWidgetAction,handleWidgetRefresh,widgetCache}.js and the front
// ExternalWidgetBox.jsx of GladysAssistant/Gladys v5.1.4.
// -----------------------------------------------------------------------------

export const MAX_PULLS_PER_MINUTE = 30;
const NUDGE_INTERVAL_MS = 10 * 1000;
const RATE_LIMITED_RETRY_MS = 60 * 1000;

/** A virtual clock whose timers run when the test advances it. */
export function createVirtualTime(start = 1_000_000) {
  let now = start;
  const timers = [];
  return {
    now: () => now,
    schedule(fn, ms) {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return timer;
    },
    cancel(timer) {
      const index = timers.indexOf(timer);
      if (index >= 0) {
        timers.splice(index, 1);
      }
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) {
          break;
        }
        timers.shift();
        now = next.at;
        await next.fn();
        await new Promise((resolve) => setImmediate(resolve));
      }
      now = end;
    },
  };
}

export function createFakeCore(gladys, time, { boxes = ['remote', 'media', 'apps'] } = {}) {
  const core = {
    pulls: 0,
    pullTimes: [],
    refusedPulls: 0,
    refusedActions: [],
    relayedActions: [],
    window: null,
    cache: new Map(),
    lastNudge: new Map(),
    boxRetry: new Map(),
  };

  function countPull() {
    const now = time.now();
    if (!core.window || core.window.resetAt <= now) {
      core.window = { count: 1, resetAt: now + 60 * 1000 };
      return true;
    }
    core.window.count += 1;
    return core.window.count <= MAX_PULLS_PER_MINUTE;
  }

  async function getContent(key) {
    const cached = core.cache.get(key);
    if (cached && cached.expiresAt > time.now()) {
      return cached.content;
    }
    if (!countPull()) {
      core.refusedPulls += 1;
      const err = new Error('EXTERNAL_INTEGRATION_WIDGET_PULL_RATE_LIMITED');
      err.status = 429;
      throw err;
    }
    core.pulls += 1;
    core.pullTimes.push(time.now());
    const content = await gladys.handlers.widgetGet[key]({
      settings: {},
      language: 'en',
      units: 'metric',
    });
    core.cache.set(key, { content, expiresAt: time.now() + (content.ttl_seconds ?? 60) * 1000 });
    return content;
  }

  // An open box fetches the content, and schedules its next fetch at expiry.
  async function boxFetch(key) {
    try {
      await getContent(key);
      const { expiresAt } = core.cache.get(key);
      time.schedule(() => boxFetch(key), expiresAt - time.now());
    } catch {
      time.schedule(() => boxFetch(key), RATE_LIMITED_RETRY_MS);
    }
  }

  async function invalidate(key) {
    core.cache.delete(key);
    if (boxes.includes(key)) {
      await boxFetch(key);
    }
  }

  gladys.requestWidgetRefresh = (key) => {
    gladys.widgetRefreshes.push(key);
    const last = core.lastNudge.get(key);
    if (last !== undefined && time.now() - last < NUDGE_INTERVAL_MS) {
      return;
    }
    core.lastNudge.set(key, time.now());
    // fire-and-forget on the integration side, async on the core side
    time.schedule(() => invalidate(key), 0);
  };

  /** The most pulls seen in any 60-second span. */
  core.maxPullsPerMinute = () =>
    Math.max(
      0,
      ...core.pullTimes.map(
        (start) => core.pullTimes.filter((at) => at >= start && at < start + 60 * 1000).length,
      ),
    );

  core.openBoxes = async () => {
    for (const key of boxes) {
      await boxFetch(key);
    }
  };

  /** A tap on a button of a widget, as POST /widget/:key/action/:action_key. */
  core.tap = async (key, actionKey) => {
    let content;
    try {
      content = await getContent(key);
    } catch (err) {
      core.refusedActions.push({ key, actionKey, reason: err.message });
      return { error: err.message };
    }
    const button = content.components.find(
      (c) => c.type === 'button' && c.action?.key === actionKey,
    );
    if (!button) {
      core.refusedActions.push({
        key,
        actionKey,
        reason: 'EXTERNAL_INTEGRATION_WIDGET_ACTION_NOT_FOUND',
      });
      return { error: 'not found' };
    }
    core.relayedActions.push({ key, actionKey });
    const message = await gladys.handlers.widgetAction[key](actionKey, button.action.params, {
      settings: {},
    });
    await invalidate(key);
    return { message };
  };

  return core;
}
