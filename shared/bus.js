// NUDG demo event bus — same-origin, dependency-free.
// Both demo apps (scribe, EHR) emit workflow events here; the buddy companion
// (Step 2) subscribes to this channel to decide when a nudge is warranted.
// Transport: BroadcastChannel for live listeners + a rolling localStorage log
// so a late-joining window can replay recent context.
window.NudgBus = (function () {
  const CHANNEL = "nudg-demo";
  const LOG_KEY = "nudg_demo_events";
  const LOG_MAX = 300;
  const ch = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL) : null;

  function emit(app, type, detail) {
    const evt = { ts: new Date().toISOString(), app, type, detail: detail || {} };
    try {
      const log = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
      log.push(evt);
      localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-LOG_MAX)));
    } catch (e) {
      /* storage full or unavailable — live channel still works */
    }
    if (ch) ch.postMessage(evt);
    return evt;
  }

  function on(handler) {
    if (ch) ch.onmessage = (m) => handler(m.data);
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
