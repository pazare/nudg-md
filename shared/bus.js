// NUDG demo event bus — same-origin, dependency-free.
// Both demo apps (scribe, EHR) emit workflow events here; the buddy companion
// subscribes to decide when a nudge is warranted.
// Transport: BroadcastChannel for other tabs + a local fanout for same-tab
// listeners (BroadcastChannel never delivers to its own context) + a rolling
// localStorage log so a late-joining window can replay recent context.
window.NudgBus = (function () {
  const CHANNEL = "nudg-demo";
  const LOG_KEY = "nudg_demo_events";
  const LOG_MAX = 300;
  const ch = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL) : null;
  const handlers = [];

  function fanout(evt) {
    for (const h of handlers) {
      try { h(evt); } catch (e) { /* one bad listener must not break the bus */ }
    }
  }

  if (ch) ch.onmessage = (m) => fanout(m.data);

  function emit(app, type, detail) {
    const evt = { ts: new Date().toISOString(), app, type, detail: detail || {} };
    try {
      const log = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
      log.push(evt);
      localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_MAX)));
    } catch (e) {
      /* storage full or unavailable — live channel still works */
    }
    if (ch) ch.postMessage(evt); // other tabs
    fanout(evt);                 // this tab
    return evt;
  }

  function on(handler) {
    handlers.push(handler);
  }

  function history() {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  return { emit, on, history };
})();
