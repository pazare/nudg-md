/* NUDG MD — nudge engine: deterministic rules over the workflow bus, live cards
   in the buddy popover, a sliding "peek" nudge at the moment of relevance, and
   the second-opinion panel with AI lanes (local relay; scripted fallback).
   Privacy contract: the engine consumes derived signals only — raw note text
   never rides the bus. Every card traces to an event + rule id. */
(function () {
  "use strict";
  if (window.__nudgEngineLoaded || !window.NudgBus || !window.NudgBuddy) return;
  window.__nudgEngineLoaded = true;

  const APP = document.title.includes("LegacyChart") ? "ehr" : document.title.includes("gallery") ? "gallery" : "scribe";
  if (APP === "gallery") return;

  /* ---------------- config ---------------- */
  const DEMO = localStorage.getItem("nudg_demo_mode") !== "0"; // demo-paced by default for the event
  const R09_DWELL_MS = DEMO ? 8000 : 90000;
  const R04_WINDOW_MS = 40000;
  const R04_MIN_TABS = 4;
  const PEEK_TTL_MS = 14000;
  const COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const RELAY = "http://127.0.0.1:4809";
  const INSTANCE_ID = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------------- state ---------------- */
  let PATIENTS = [];
  const byMrn = new Map();
  const cards = new Map(); // id -> card
  const tabViews = new Map(); // mrn -> [ts, ...]
  const noteSignals = new Map(); // mrn -> {impressions, topics}
  let dwellTimer = null;
  let peekTimer = null;
  let panelCard = null; // card currently showing its second-opinion panel
  let activeMrn = null;

  const store = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch (e) { return f; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* optional */ } };

  function coolingDown(id) {
    const c = store("nudg_cooldowns", {});
    return c[id] && Date.now() < c[id].until;
  }
  function startCooldown(id) {
    const c = store("nudg_cooldowns", {});
    const level = (c[id] && c[id].level ? c[id].level : 0) + 1;
    c[id] = { until: Date.now() + COOLDOWN_MS * level, level };
    save("nudg_cooldowns", c);
  }
  function bumpMetric(key) {
    const m = store("nudg_metrics", { evaluated: 0, shown: 0 });
    m[key] += 1;
    save("nudg_metrics", m);
    return m;
  }

  /* ---------------- card factory ---------------- */
  const TYPE_META = {
    chart: { cls: "a-chart", chip: "t-chart", label: "Chart check" },
    nav: { cls: "a-nav", chip: "t-nav", label: "Navigate" },
    depth: { cls: "a-depth", chip: "t-depth", label: "Depth" },
    watch: { cls: "a-watch", chip: "t-watch", label: "Watch" },
  };

  function commit(card) {
    if (cards.has(card.id) || coolingDown(card.id)) return;
    cards.set(card.id, card);
    bumpMetric("shown");
    renderCards();
    // First tab to claim the id announces it; others render silently from the claim.
    const claims = store("nudg_claims", {});
    if (!claims[card.id] || Date.now() - claims[card.id] > 15000) {
      claims[card.id] = Date.now();
      save("nudg_claims", claims);
      NudgBus.emit("buddy", "nudge_committed", { id: card.id, rule: card.rule, mrn: card.mrn, headline: card.headline });
    }
    if (activeMrn === card.mrn) {
      showPeek(card);
    }
  }

  function removeCard(id, outcome, detail) {
    const card = cards.get(id);
    if (!card) return;
    cards.delete(id);
    if (panelCard && panelCard.id === id) exitPanel();
    renderCards();
    if (outcome) NudgBus.emit("buddy", outcome, Object.assign({ id, rule: card.rule, mrn: card.mrn, origin: INSTANCE_ID }, detail || {}));
    hidePeekFor(id);
  }

  /* ---------------- rules ---------------- */
  // R-01: a benign impression is typed while the chart documents a rhythm history.
  function evalR01(mrn) {
    bumpMetric("evaluated");
    const p = byMrn.get(mrn);
    const sig = noteSignals.get(mrn);
    if (!p || !sig || !sig.impressions.includes("anxiety")) return;
    if (!(p.problems || []).some((x) => /atrial fibrillation/i.test(x))) return;
    const prior = (p.priorNotes && p.priorNotes[0]) || null;
    commit({
      id: `r01:${mrn}`, rule: "R-01", type: "chart", tempo: "FOCUSED", mrn, name: p.name,
      headline: "Anxiety can wait: Rule out recurrent AF first.",
      bullets: [
        { t: "A 14-day monitor confirmed paroxysmal AF.", src: prior ? `Chart: Note ${prior.date}` : "Chart: Prior note" },
        { t: "Today's pulse is documented irregularly irregular.", src: "Chart: Vitals" },
        { t: "He misses apixaban about twice a month, after a prior TIA.", src: "Chart + visit" },
      ],
      frame: "Keep anxiety in the differential: Confirm the rhythm and his anticoagulation first. You decide.",
      actions: [
        { id: "open_rhythm", label: "Open the rhythm note", kind: "primary" },
        { id: "dismiss", label: "Dismiss ▾", kind: "quiet" },
      ],
      why: `You typed “anxiety” in ${p.name.split(" ")[0]}'s draft while the chart holds an AF history · R-01`,
    });
  }

  // R-04: the doctor is hunting — several tab views, nothing opened.
  function evalR04(mrn) {
    bumpMetric("evaluated");
    const p = byMrn.get(mrn);
    if (!p) return;
    const now = Date.now();
    const views = (tabViews.get(mrn) || []).filter((t) => now - t < R04_WINDOW_MS);
    tabViews.set(mrn, views);
    if (views.length < R04_MIN_TABS) return;
    const doc = (p.priorNotes && p.priorNotes[0]) || null;
    if (!doc) return;
    commit({
      id: `r04:${mrn}`, rule: "R-04", type: "nav", tempo: "NOW", mrn, name: p.name,
      headline: `Find the ${doc.type.toLowerCase()} in 3 clicks.`,
      steps: ["Open the Notes tab", `Pick “${doc.type} · ${doc.date}”`, "Click the row to read it"],
      alts: ["Latest results: Labs tab", "Signed orders: Orders tab"],
      actions: [
        { id: "show_me", label: "Show me", kind: "primary" },
        { id: "not_this", label: "Not this ▾", kind: "quiet" },
      ],
      why: `${views.length} tab views in under 40 s with nothing opened · R-04 · leaves on its own once you open anything`,
    });
  }

  // R-09: a flagged chart is open, and the draft plan never touches the flagged topic.
  function armR09(mrn) {
    clearTimeout(dwellTimer);
    dwellTimer = null;
    const p = byMrn.get(mrn);
    if (!p || !p.depthPack) return;
    dwellTimer = setTimeout(() => {
      if (activeMrn !== mrn) return;
      bumpMetric("evaluated");
      const sig = noteSignals.get(mrn);
      if (sig && sig.topics.includes("nutrition_referral")) return; // the plan already owns it
      const d = p.depthPack;
      commit({
        id: `r09:${mrn}`, rule: "R-09", type: "depth", tempo: "DEEP", mrn, name: p.name,
        headline: d.headline,
        frame: d.gap,
        research: d.research,
        specialists: d.specialists,
        question: d.question,
        actions: [
          { id: "start_referral", label: "Draft referral", kind: "primary" },
          { id: "second_opinion", label: "Second opinion ▸", kind: "" },
          { id: "dismiss", label: "Dismiss ▾", kind: "quiet" },
        ],
        why: `Chart open ${Math.round(R09_DWELL_MS / 1000)} s: The draft plan has no nutrition owner while the chart flag is active · R-09`,
      });
    }, R09_DWELL_MS);
  }

  function referralDraftCard(mrn) {
    const p = byMrn.get(mrn);
    if (!p) return;
    const drafts = store("nudg_referral_drafts", {});
    drafts[mrn] = { status: "draft", createdAt: new Date().toISOString(), simulated: true };
    save("nudg_referral_drafts", drafts);
    commit({
      id: `referral-draft:${mrn}`, rule: "R-12", type: "watch", tempo: "DRAFT", mrn, name: p.name,
      headline: "Referral draft saved locally: Nothing has been sent.",
      bullets: [
        { t: "Proposed service: Nutrition services. Owner and recipient require review.", src: "Synthetic draft" },
        { t: "Choose the explicit demo action below to simulate signing and sending." },
      ],
      actions: [
        { id: "simulate_send", label: "Simulate sign & send", kind: "primary" },
        { id: "discard_referral", label: "Discard draft", kind: "quiet" },
      ],
      why: "You asked NUDG MD to draft a referral · R-12 · local synthetic state only",
    });
  }

  // R-12: only an explicit simulated-send action starts result ownership.
  function fireR12(mrn) {
    const p = byMrn.get(mrn);
    if (!p) return;
    commit({
      id: `r12:${mrn}`, rule: "R-12", type: "watch", tempo: "WATCH", mrn, name: p.name,
      headline: "Simulated referral sent: A reply is due by Saturday, Jul 25.",
      bullets: [
        { t: "Owner: Dr. Rivera. Backup: Care coordination.", src: "R-12 · synthetic state" },
        { t: "If nobody replies by the deadline, this card returns and escalates." },
      ],
      actions: [
        { id: "acknowledge", label: "Acknowledge", kind: "primary" },
        { id: "stop_watching", label: "Stop watching ▾", kind: "quiet" },
      ],
      why: "You explicitly simulated signing and sending the referral · R-12 · no external system was contacted",
    });
  }

  /* ---------------- actions ---------------- */
  /* The buddy takes you there: focus the sibling tab by its window name.
     Same-origin and inside the click gesture, so the browser allows the jump. */
  function goToTab(app) {
    try {
      const w = window.open("", `nudg-${app}`);
      if (!w) return false;
      let blank = false;
      try { blank = w.location.href === "about:blank"; } catch (e) { /* leave it */ }
      if (blank) w.location = `/${app}/`;
      w.focus();
      return true;
    } catch (e) { return false; }
  }

  function runAction(card, actionId) {
    if (actionId === "dismiss" || actionId === "not_this" || actionId === "stop_watching") {
      toggleDismissMenu(card);
      return;
    }
    NudgBus.emit("buddy", "nudge_acted", { id: card.id, rule: card.rule, mrn: card.mrn, action: actionId, origin: INSTANCE_ID });
    if (actionId === "open_rhythm") {
      NudgBus.emit("buddy", "nudg_cmd", { action: "ehr_open_doc", mrn: card.mrn, match: "" });
      const jumped = APP === "ehr" ? false : goToTab("ehr");
      NudgBuddy.toast(jumped
        ? "Taking you to the rhythm note in LegacyChart."
        : "Ready in the LegacyChart tab: The rhythm note is open and highlighted.");
      removeCard(card.id, null);
    } else if (actionId === "show_me") {
      NudgBus.emit("buddy", "nudg_cmd", { action: "ehr_open_doc", mrn: card.mrn, match: "" });
      removeCard(card.id, null);
    } else if (actionId === "start_referral") {
      NudgBuddy.toast("Referral draft saved locally: Nothing has been sent.");
      removeCard(card.id, null);
      referralDraftCard(card.mrn);
      NudgBus.emit("buddy", "referral_drafted", { mrn: card.mrn, origin: INSTANCE_ID });
    } else if (actionId === "simulate_send") {
      const drafts = store("nudg_referral_drafts", {});
      delete drafts[card.mrn];
      save("nudg_referral_drafts", drafts);
      removeCard(card.id, null);
      fireR12(card.mrn);
      NudgBuddy.toast("Synthetic send recorded: No external system was contacted.");
      NudgBus.emit("buddy", "referral_simulated_sent", { mrn: card.mrn, origin: INSTANCE_ID });
    } else if (actionId === "discard_referral") {
      const drafts = store("nudg_referral_drafts", {});
      delete drafts[card.mrn];
      save("nudg_referral_drafts", drafts);
      removeCard(card.id, null);
      NudgBuddy.toast("Referral draft discarded.");
    } else if (actionId === "second_opinion") {
      enterPanel(card);
    } else if (actionId === "acknowledge") {
      NudgBuddy.toast("Acknowledged: I'll stay quiet unless the deadline slips.");
      removeCard(card.id, null);
    } else if (actionId === "open_research" && card.research && card.research.url) {
      window.open(card.research.url, "_blank", "noopener");
    }
  }

  function dismissWith(card, reason) {
    startCooldown(card.id);
    removeCard(card.id, "nudge_dismissed", { reason });
  }

  /* ---------------- rendering ---------------- */
  function chipRow(card) {
    const m = TYPE_META[card.type];
    return `<div class="nbc-ctx">
      <span class="nbc-chip ${m.chip}">${m.label}</span>
      <span class="nbc-chip">${card.tempo}</span>
      <span class="nbc-chip pt">${esc(card.name)} · ${esc(card.mrn)}</span>
    </div>`;
  }

  function cardHtml(card) {
    const m = TYPE_META[card.type];
    let body = "";
    if (card.bullets) {
      body += `<ul class="nbc-evi">${card.bullets
        .map((b) => `<li><span>${esc(b.t)}</span>${b.src ? `<span class="nbc-src">${esc(b.src)}</span>` : ""}</li>`)
        .join("")}</ul>`;
    }
    if (card.steps) {
      body += `<ol class="nbc-steps">${card.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
    }
    if (card.alts) {
      body += `<div class="nbc-ctx" style="margin-top:7px">${card.alts.map((a) => `<span class="nbc-src">${esc(a)}</span>`).join("")}</div>`;
    }
    if (card.frame) body += `<div class="nbc-frame">${esc(card.frame)}</div>`;
    if (card.research) {
      const references = [card.research, card.research.supporting].filter(Boolean);
      const rows = references.map((reference) => {
        const cite = reference.url
          ? `<a class="nbc-src nbc-src-link" href="${esc(reference.url)}" target="_blank" rel="noopener noreferrer">${esc(reference.cite)}</a>`
          : `<span class="nbc-src">${esc(reference.cite)}</span>`;
        return `<li><span>${esc(reference.title)}</span>${cite}</li>`;
      }).join("");
      const notes = references
        .filter((reference) => reference.note)
        .map((reference, index) => `<div class="nbc-frame"><strong>${index === 0 ? "Applicability" : "Supporting-source boundary"}:</strong> ${esc(reference.note)}</div>`)
        .join("");
      const limit = card.research.honesty
        ? `<div class="nbc-frame"><strong>Evidence limit:</strong> ${esc(card.research.honesty)}</div>`
        : "";
      body += `<div class="nbc-sect"><div class="nbc-sect-label">${references.length > 1 ? "RESEARCH: SOURCES + APPLICABILITY" : "RESEARCH: ONE SPECIFIC REFERENCE"}</div>
        <ul class="nbc-evi">${rows}</ul>${notes}${limit}</div>`;
    }
    if (card.specialists && card.specialists.length) {
      const first = card.specialists[0];
      const rest = card.specialists.slice(1);
      body += `<div class="nbc-sect"><div class="nbc-sect-label">IN-NETWORK: SYNTHETIC DIRECTORY</div>
        ${specHtml(first)}
        ${rest.length ? `<details class="nbc-more"><summary>More specialists ▾</summary>${rest.map(specHtml).join("")}</details>` : ""}</div>`;
    }
    const actions = `<div class="nbc-actions">${card.actions
      .map((a) => `<button class="nbc-btn ${a.kind || ""}" type="button" data-card="${esc(card.id)}" data-action="${esc(a.id)}">${esc(a.label)}</button>`)
      .join("")}</div>
      <div class="nbc-dismiss-menu nudg-hidden" data-menu="${esc(card.id)}">
        ${["Not relevant here", "Already considered", "Later today"].map((r) => `<button class="nbc-btn quiet" type="button" data-card="${esc(card.id)}" data-reason="${esc(r)}">${esc(r)}</button>`).join("")}
      </div>`;
    return `<div class="nbc ${m.cls}" data-card-root="${esc(card.id)}">${chipRow(card)}<h4>${esc(card.headline)}</h4>${body}${actions}
      <div class="nbc-trace">Why this, why now: ${esc(card.why)}</div></div>`;
  }

  function specHtml(s) {
    return `<div class="nbc-spec"><div class="nbc-ava">${esc(s.initials)}</div><div>
      <div class="nbc-spec-name">${esc(s.name)}</div>
      <div class="nbc-spec-meta">${s.tags.map((t) => `<span class="nbc-src">${esc(t)}</span>`).join("")}</div></div></div>`;
  }

  function renderCards() {
    const visibleCards = activeMrn
      ? [...cards.values()].filter((card) => card.mrn === activeMrn)
      : [];
    NudgBuddy.setNudgeCount(visibleCards.length);
    if (panelCard) return; // panel view owns the container
    const el = NudgBuddy.cardsEl;
    if (!visibleCards.length) {
      const held = cards.size - visibleCards.length;
      el.innerHTML = `<div class="nudg-cards-empty">${activeMrn ? "Nothing needs your attention for this patient." : "Open a synthetic patient to see context-matched nudges."} You'll only hear from me when I can point at something specific in the active chart.${held ? ` ${held} nudge${held === 1 ? " is" : "s are"} held for another synthetic patient.` : ""}</div>`;
      return;
    }
    el.innerHTML = visibleCards.reverse().map(cardHtml).join("");
  }

  function toggleDismissMenu(card) {
    const menu = NudgBuddy.cardsEl.querySelector(`[data-menu="${CSS.escape(card.id)}"]`) || (peekEl && peekEl.querySelector(`[data-menu="${CSS.escape(card.id)}"]`));
    if (menu) menu.classList.toggle("nudg-hidden");
  }

  NudgBuddy.cardsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-card]");
    if (!btn) return;
    const card = cards.get(btn.dataset.card);
    if (!card) return;
    if (btn.dataset.reason) dismissWith(card, btn.dataset.reason);
    else runAction(card, btn.dataset.action);
  });

  /* ---------------- peek: the nudge arrives where you are ---------------- */
  let peekEl = null;
  function ensurePeek() {
    if (peekEl) return peekEl;
    peekEl = document.createElement("div");
    peekEl.id = "nudgPeek";
    document.body.appendChild(peekEl);
    peekEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-peek]");
      if (!btn) return;
      const card = cards.get(btn.dataset.peek);
      if (btn.dataset.act === "view") {
        NudgBuddy.open();
        NudgBuddy.showView("nudges");
        hidePeek();
      } else if (btn.dataset.act === "close") {
        hidePeek();
      } else if (btn.dataset.act === "primary" && card) {
        runAction(card, card.actions[0].id);
        hidePeek();
      }
    });
    return peekEl;
  }

  function showPeek(card) {
    if (NudgBuddy.isOpen()) return; // the full card is already visible
    const el = ensurePeek();
    const m = TYPE_META[card.type];
    el.className = m.cls;
    el.innerHTML = `<div class="nbc-ctx"><span class="nbc-chip ${m.chip}">${m.label}</span><span class="nbc-chip pt">${esc(card.name)}</span></div>
      <h4>${esc(card.headline)}</h4>
      <div class="nbc-actions">
        <button class="nbc-btn primary" type="button" data-peek="${esc(card.id)}" data-act="primary">${esc(card.actions[0].label)}</button>
        <button class="nbc-btn" type="button" data-peek="${esc(card.id)}" data-act="view">Open buddy</button>
        <button class="nbc-btn quiet" type="button" data-peek="${esc(card.id)}" data-act="close" aria-label="Hide">✕</button>
      </div>`;
    const a = NudgBuddy.anchorEl().getBoundingClientRect();
    const W = 296, H = el.offsetHeight || 120;
    let left = Math.min(Math.max(12, a.left - W + a.width), window.innerWidth - W - 12);
    let top = a.top > H + 20 ? a.top - H - 10 : Math.min(a.bottom + 10, window.innerHeight - H - 12);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.dataset.cardId = card.id;
    setTimeout(() => el.classList.add("nudg-show"), 20);
    NudgBuddy.bloom();
    clearTimeout(peekTimer);
    peekTimer = setTimeout(hidePeek, PEEK_TTL_MS);
  }
  function hidePeek() { if (peekEl) peekEl.classList.remove("nudg-show"); }
  function hidePeekFor(id) { if (peekEl && peekEl.dataset.cardId === id) hidePeek(); }

  // However the popover opens (orb, cursor, Shift+P), the peek stands down.
  new MutationObserver(() => {
    if (NudgBuddy.isOpen()) hidePeek();
  }).observe(document.getElementById("nudgPop"), { attributes: true, attributeFilter: ["class"] });

  /* ---------------- second-opinion panel ---------------- */
  const LANE_LABEL = {
    "live-claude": ["live", "LIVE: CLAUDE (ANTHROPIC API)"],
    "live-codex": ["live", "LIVE: GPT VIA CODEX CLI"],
    scripted: ["scripted", "SCRIPTED: NO LIVE LANE CONNECTED"],
    "scripted-pending": ["scripted", "SCRIPTED · LIVE LANE DELIBERATING…"],
  };

  async function relay(path, body, ms, controller) {
    const ctl = controller || new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(RELAY + path, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(payload.error || `relay returned HTTP ${r.status}`);
      return payload;
    } finally { clearTimeout(t); }
  }

  let panelLane = null;   // which lane owns the panel body right now
  let panelRun = 0;       // bumps on every lane render; stale async paints bail
  let activeRelay = null; // lane changes abort the UI request; relay runId stops Codex children

  function beginRelay() {
    const run = {
      runId: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      controller: new AbortController(),
    };
    activeRelay = run;
    return run;
  }

  function finishRelay(run) {
    if (activeRelay === run) activeRelay = null;
  }

  function cancelActiveRelay() {
    const run = activeRelay;
    if (!run) return;
    activeRelay = null;
    run.controller.abort();
    fetch(RELAY + "/api/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: run.runId }),
      keepalive: true,
    }).catch(() => { /* best effort; a short in-flight Anthropic request may finish server-side */ });
  }

  function enterPanel(card) {
    panelCard = card;
    NudgBuddy.open();
    NudgBuddy.showView("nudges");
    NudgBuddy.setWide(true);
    renderPanel("quick");
  }
  function exitPanel() {
    cancelActiveRelay();
    panelCard = null;
    panelLane = null;
    panelRun += 1;
    NudgBuddy.setWide(false);
    renderCards();
  }

  function panelShell(lane, inner) {
    const p = panelCard;
    return `<button class="nbc-btn nbp-back" type="button" data-panel="back">← Back to nudges</button>
      <div class="nbp-head">Second opinion</div>
      <div class="nbp-q">${esc(p.question || "Should this plan change now?")} · ${esc(p.name)} · ${esc(p.mrn)}</div>
      <div class="nbp-lanes" role="tablist" aria-label="Second-opinion depth">
        <button class="nbp-lane ${lane === "quick" ? "active" : ""}" id="nbpTabQuick" role="tab" aria-selected="${lane === "quick"}" aria-controls="nbpPanelBody" tabindex="${lane === "quick" ? "0" : "-1"}" type="button" data-panel="quick">Quick take</button>
        <button class="nbp-lane ${lane === "panel" ? "active" : ""}" id="nbpTabPanel" role="tab" aria-selected="${lane === "panel"}" aria-controls="nbpPanelBody" tabindex="${lane === "panel" ? "0" : "-1"}" type="button" data-panel="panel">Panel review</button>
      </div>
      <div class="nbp-body" id="nbpPanelBody" role="tabpanel" aria-labelledby="${lane === "quick" ? "nbpTabQuick" : "nbpTabPanel"}">${inner}</div>
      <div class="nbc-trace">Decision owner: A. Rivera, MD. This is decision support: Nothing is ordered or sent without you. SYNTHETIC DEMO.</div>`;
  }

  function renderPanel(lane) {
    cancelActiveRelay();
    panelLane = lane;
    panelRun += 1;
    const el = NudgBuddy.cardsEl;
    if (lane === "quick") {
      el.innerHTML = panelShell("quick", `<div class="nbp-quick"><span class="nbp-spin"></span>Asking for a quick take…</div>`);
      runQuick();
    } else {
      el.innerHTML = panelShell("panel", `<div data-panel-mode></div><div class="nbp-agg nudg-hidden" data-panel-agg></div><div class="nbp-receipt nudg-hidden" data-panel-receipt></div><div data-panel-seats><div class="nbp-quick"><span class="nbp-spin"></span>Convening the seats…</div></div>`);
      runPanel();
    }
  }

  function defaultSeats() {
    const d = byMrn.get(panelCard.mrn).depthPack || {};
    return (d.seats || []).map((s) => ({ id: s.id, name: s.name, lens: s.name }));
  }

  let laneHealth = null; // {claude, codex} cached for 60 s
  async function lanes() {
    if (laneHealth && Date.now() - laneHealth.ts < 60000) return laneHealth;
    try {
      const h = await relay("/api/health", null, 1500);
      laneHealth = { ts: Date.now(), claude: h.lanes.claude === "ready", codex: h.lanes.codex === "ready" };
    } catch (e) {
      laneHealth = { ts: Date.now(), claude: false, codex: false };
    }
    return laneHealth;
  }

  function paintQuick(mode, text, receipt, note) {
    const body = NudgBuddy.cardsEl.querySelector(".nbp-body");
    if (!body || !panelCard || panelLane !== "quick") return;
    const [cls, label] = LANE_LABEL[mode] || LANE_LABEL.scripted;
    body.innerHTML = `<span class="nb-mode ${cls}">${label}</span><div class="nbp-quick">${esc(text)}</div>` +
      (note ? `<div class="nbp-receipt"><span class="nbp-spin"></span>${esc(note)}</div>` : "") +
      (receipt ? `<div class="nbp-receipt">${esc(receipt)}</div>` : "");
  }

  async function runQuick() {
    const myRun = panelRun;
    const p = byMrn.get(panelCard.mrn);
    const d = p.depthPack || {};
    const scripted = d.quickScripted || "No scripted quick take is prepared for this patient.";
    const h = await lanes();
    if (myRun !== panelRun) return;
    const liveAvailable = h.claude || h.codex;
    // Fallback ladder, inverted for latency honesty: scripted paints instantly,
    // the live lane replaces it in place when it lands (codex ≈ 60–90 s).
    paintQuick(liveAvailable ? "scripted-pending" : "scripted", scripted, "", liveAvailable ? (h.claude ? "Live lane answering (Claude): it replaces this scripted text when it lands." : "Live lane answering (GPT via codex, about a minute): it replaces this scripted text when it lands.") : "");
    if (!liveAvailable) return;
    const run = beginRelay();
    try {
      const res = await relay("/api/quick", { runId: run.runId, question: panelCard.question, patient: chartFacts(p), context: [] }, 150000, run.controller);
      if (myRun === panelRun && res && res.mode && res.mode !== "scripted" && res.text && panelCard) {
        paintQuick(res.mode, res.text, res.receipt ? `receipt: ${res.receipt.served_mode} · ${res.receipt.latency_ms} ms` : "");
      } else if (myRun === panelRun && res && res.mode === "scripted" && panelCard) {
        paintQuick("scripted", scripted, "receipt: live lane became unavailable; scripted fallback remains");
      }
    } catch (e) {
      if (myRun === panelRun && panelCard && panelLane === "quick") {
        paintQuick("scripted", scripted, "receipt: live lane unavailable; scripted fallback remains");
      }
    }
    finally { finishRelay(run); }
  }

  function paintSeats(mode, seats, receiptText) {
    if (!panelCard || panelLane !== "panel") return;
    const wrap = NudgBuddy.cardsEl;
    const seatsBox = wrap.querySelector("[data-panel-seats]");
    if (!seatsBox) return;
    seatsBox.innerHTML = seats
      .map((s) => `<div class="nbp-seat"><div class="nbp-seat-name">${esc(s.name)}</div>
        <span class="nbp-stance ${esc(s.stance)}">${esc(String(s.stance).toUpperCase())}</span>
        <div class="nbp-say">${esc(s.rationale + (s.requests ? ` Needs: ${s.requests}` : ""))}</div></div>`)
      .join("");
    const [cls, label] = LANE_LABEL[mode] || LANE_LABEL.scripted;
    const oldMode = wrap.querySelector(".nb-mode");
    if (oldMode) oldMode.remove();
    const modeSlot = wrap.querySelector("[data-panel-mode]");
    if (modeSlot) modeSlot.innerHTML = `<span class="nb-mode ${cls}">${label}</span>`;
    const support = seats.filter((s) => s.stance === "support").length;
    const requests = seats.filter((s) => s.stance === "insufficient").length;
    const agg = wrap.querySelector("[data-panel-agg]");
    if (agg) {
      agg.classList.remove("nudg-hidden");
      agg.innerHTML = requests > 0
        ? `UNDERDETERMINED <small>· the panel declines to ratify and lists what it needs first</small>`
        : `Supported with dissent: ${support}/${seats.length} <small>· no seat requested missing data · positions, never confidence</small>`;
    }
    const rec = wrap.querySelector("[data-panel-receipt]");
    if (rec) {
      rec.classList.remove("nudg-hidden");
      rec.textContent = receiptText;
    }
  }

  async function runPanel() {
    const myRun = panelRun;
    const p = byMrn.get(panelCard.mrn);
    const d = p.depthPack || {};
    const scripted = d.seats || [];
    const h = await lanes();
    if (myRun !== panelRun) return;
    // Fallback ladder, latency-honest: scripted seats paint instantly; the live
    // multi-agent run replaces them in place when it lands (codex ≈ 1–2 min).
    paintSeats(h.codex ? "scripted-pending" : "scripted", scripted, h.codex
      ? "run: scripted pack shown while the live panel deliberates (GPT via codex, 1–2 min)…"
      : "run: scripted pack · the live lane appears here when the relay is up");
    if (!h.codex) return;
    const run = beginRelay();
    try {
      const res = await relay("/api/panel", { runId: run.runId, question: panelCard.question, patient: chartFacts(p), seats: defaultSeats() }, 180000, run.controller);
      if (myRun === panelRun && res && res.mode === "live-codex" && res.seats && panelCard) {
        paintSeats(res.mode, res.seats,
          `run: live · seats: ${res.seats.length} · one model per lane, contexts isolated · ${res.receipt ? res.receipt.latency_ms + " ms" : ""}`);
      } else if (myRun === panelRun && res && res.mode === "scripted" && panelCard) {
        paintSeats("scripted", scripted, "run: live lane became unavailable; scripted fallback remains");
      }
    } catch (e) {
      if (myRun === panelRun && panelCard && panelLane === "panel") {
        paintSeats("scripted", scripted, "run: live lane unavailable; scripted fallback remains");
      }
    }
    finally { finishRelay(run); }
  }

  function chartFacts(p) {
    return {
      name: p.name, age: p.age, sex: p.sex, problems: p.problems, meds: p.meds,
      allergies: p.allergies, vitals: p.vitals, labs: p.labs, reason: p.reason,
      synthetic: true,
    };
  }

  NudgBuddy.cardsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-panel]");
    if (!b || !panelCard) return;
    if (b.dataset.panel === "back") exitPanel();
    else renderPanel(b.dataset.panel);
  });
  NudgBuddy.cardsEl.addEventListener("keydown", (e) => {
    const tab = e.target.closest('[role="tab"][data-panel]');
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const lane = (e.key === "ArrowLeft" || e.key === "Home") ? "quick" : "panel";
    renderPanel(lane);
    NudgBuddy.cardsEl.querySelector(`[role="tab"][data-panel="${lane}"]`)?.focus();
  });
  window.addEventListener("nudg:buddy-closed", () => {
    if (panelCard) exitPanel();
    else cancelActiveRelay();
  });

  /* ---------------- bus wiring ---------------- */
  NudgBus.on((evt) => {
    const d = evt.detail || {};
    switch (evt.type) {
      case "note_signals":
        noteSignals.set(d.mrn, { impressions: d.impressions || [], topics: d.topics || [] });
        if (APP === "scribe") evalR01(d.mrn);
        break;
      case "encounter_selected":
        if (APP === "scribe" && evt.app === "scribe") {
          activeMrn = d.mrn || null;
          if (panelCard && panelCard.mrn !== activeMrn) exitPanel();
          else renderCards();
          hidePeek();
        }
        break;
      case "ehr_tab_viewed": {
        if (APP !== "ehr" || !d.user) break; // programmatic tab changes never count as hunting
        const list = tabViews.get(d.mrn) || [];
        list.push(Date.now());
        tabViews.set(d.mrn, list);
        evalR04(d.mrn);
        if (activeMrn === d.mrn) armR09(d.mrn); // real activity restarts the stillness clock
        break;
      }
      case "ehr_patient_opened":
        if (APP !== "ehr" || evt.app !== "ehr") break;
        if (activeMrn && activeMrn !== d.mrn && cards.has(`r04:${activeMrn}`)) {
          removeCard(`r04:${activeMrn}`, "nudge_superseded", { reason: "chart_switched" });
        }
        activeMrn = d.mrn;
        tabViews.set(d.mrn, []);
        if (panelCard && panelCard.mrn !== activeMrn) exitPanel();
        else renderCards();
        hidePeek();
        armR09(d.mrn);
        break;
      case "ehr_chart_closed":
        if (APP === "ehr" && evt.app === "ehr" && (!d.mrn || activeMrn === d.mrn)) {
          activeMrn = null;
          clearTimeout(dwellTimer);
          dwellTimer = null;
          tabViews.delete(d.mrn);
          if (cards.has(`r04:${d.mrn}`)) {
            removeCard(`r04:${d.mrn}`, "nudge_superseded", { reason: "chart_closed" });
          }
          hidePeek();
          if (panelCard) exitPanel();
          else renderCards();
        }
        break;
      case "ehr_document_opened":
      case "ehr_note_filed":
      case "ehr_orders_signed":
        if (APP !== "ehr") break;
        tabViews.set(d.mrn, []);
        if (cards.has(`r04:${d.mrn}`)) removeCard(`r04:${d.mrn}`, "nudge_superseded");
        if (activeMrn === d.mrn) armR09(d.mrn);
        break;
      case "nudge_acted":
      case "nudge_dismissed":
      case "nudge_superseded":
        if (evt.app !== "buddy" || d.origin === INSTANCE_ID || !cards.has(d.id)) break;
        if (evt.type === "nudge_acted" && !["open_rhythm", "show_me", "start_referral", "simulate_send", "discard_referral", "acknowledge"].includes(d.action)) break;
        // Mirror outcomes that happened in the other tab.
        cards.delete(d.id);
        if (panelCard && panelCard.id === d.id) exitPanel();
        renderCards();
        hidePeekFor(d.id);
        break;
      case "referral_drafted":
        if (APP === "ehr" && evt.app === "buddy" && d.origin !== INSTANCE_ID) referralDraftCard(d.mrn);
        break;
      case "referral_simulated_sent":
        if (APP === "ehr" && evt.app === "buddy" && d.origin !== INSTANCE_ID) fireR12(d.mrn);
        break;
      case "demo_reset":
        cards.clear();
        noteSignals.clear();
        tabViews.clear();
        clearTimeout(dwellTimer);
        dwellTimer = null;
        activeMrn = null;
        save("nudg_cooldowns", {});
        save("nudg_claims", {});
        save("nudg_metrics", { evaluated: 0, shown: 0 });
        save("nudg_referral_drafts", {});
        exitPanel();
        hidePeek();
        renderCards();
        break;
      default:
        break;
    }
  });

  /* ---------------- boot ---------------- */
  fetch("/data/patients.json")
    .then((r) => r.json())
    .then((data) => {
      PATIENTS = data.patients || [];
      for (const p of PATIENTS) byMrn.set(p.mrn, p);
      renderCards();
    })
    .catch(() => { /* engine stays quiet without data */ });
})();
