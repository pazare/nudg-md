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
  const PENDING_EHR_COMMAND_KEY = "nudg_pending_ehr_command";
  // Historical key retained for demo-state compatibility; values track the
  // referral workflow after drafting as well as after a simulated send.
  const REFERRAL_STATE_KEY = "nudg_referral_drafts";
  const INSTANCE_ID = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------------- state ---------------- */
  let PATIENTS = [];
  const byMrn = new Map();
  const cards = new Map(); // id -> card
  const tabViews = new Map(); // mrn -> [{ tab, ts }, ...]
  const noteSignals = new Map(); // mrn -> {impressions, topics}
  const lastTabByMrn = new Map(); // mrn -> last chart tab shown (user or programmatic)
  let dwellTimer = null;
  let peekTimer = null;
  let panelCard = null; // card currently showing its second-opinion panel
  let activeMrn = null;
  let pendingHandoff = null; // { commandId, cardId, card, expiresAt }
  let handoffTimer = null;
  let commandCleanupTimer = null;

  const store = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch (e) { return f; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* optional */ } };
  const referralState = (mrn) => store(REFERRAL_STATE_KEY, {})[mrn] || null;

  function coolingDown(id) {
    const c = store("nudg_cooldowns", {});
    return c[id] && Date.now() < c[id].until;
  }
  function startCooldown(id) {
    const c = store("nudg_cooldowns", {});
    const level = Math.min((c[id] && c[id].level ? c[id].level : 0) + 1, 3);
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
      NudgBuddy.announceNudge(card.headline);
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
        { t: "Today's pulse is documented as irregularly irregular.", src: "Chart: Vitals" },
        { t: "He misses apixaban about twice a month, with a prior TIA in his history.", src: "Chart + visit" },
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
    const views = (tabViews.get(mrn) || []).filter((view) => now - view.ts < R04_WINDOW_MS);
    tabViews.set(mrn, views);
    const distinctTabs = new Set(views.map((view) => view.tab));
    if (distinctTabs.size < R04_MIN_TABS) return;
    const doc = (p.priorNotes && p.priorNotes[0]) || null;
    if (!doc) return;
    commit({
      id: `r04:${mrn}`, rule: "R-04", type: "nav", tempo: "NOW", mrn, name: p.name,
      headline: `Find the ${doc.type.toLowerCase()} in 2 clicks.`,
      steps: ["Open the Notes tab", `Open “${doc.type} · ${doc.date}”`],
      alts: ["Latest results: Labs tab", "Signed orders: Orders tab"],
      actions: [
        { id: "show_me", label: "Show me", kind: "primary" },
        { id: "not_this", label: "Not this ▾", kind: "quiet" },
      ],
      why: `${distinctTabs.size} different chart tabs in under 40 s with nothing opened · R-04 · leaves on its own once you open anything`,
    });
  }

  // R-09: a pre-authored patient depth flag is open and no observed derived note signal addresses it.
  function armR09(mrn) {
    clearTimeout(dwellTimer);
    dwellTimer = null;
    const p = byMrn.get(mrn);
    if (!p || !p.depthPack) return;
    dwellTimer = setTimeout(() => {
      if (activeMrn !== mrn) return;
      /* Depth prompts only interrupt the overview, never mid-navigation or a
         document read: the doctor must be resting on the Summary tab. */
      if ((lastTabByMrn.get(mrn) || "summary") !== "summary") return;
      bumpMetric("evaluated");
      const sig = noteSignals.get(mrn);
      if (sig && sig.topics.includes("nutrition_referral")) return; // the plan already owns it
      const referral = referralState(mrn);
      // Do not stack a depth prompt on top of an unresolved navigation or
      // referral card. After the WATCH card is acknowledged, depth can return
      // as a second-opinion-only follow-up without asking for another referral.
      if (cards.has(`r04:${mrn}`) || referral?.status === "draft" || cards.has(`referral-draft:${mrn}`) || cards.has(`r12:${mrn}`)) return;
      const followUpReview = referral?.status === "simulated_sent";
      const d = p.depthPack;
      commit({
        id: `r09:${mrn}`, rule: "R-09", type: "depth", tempo: "DEEP", mrn, name: p.name,
        headline: followUpReview ? "Referral recorded. Review the decision in depth?" : d.headline,
        frame: followUpReview
          ? "The synthetic referral has an owner. A second opinion can inspect the evidence and remaining uncertainty; nothing changes unless you decide."
          : d.gap,
        research: d.research,
        specialists: d.specialists,
        question: followUpReview ? (d.followUpQuestion || d.question) : d.question,
        quickScripted: followUpReview ? (d.followUpQuickScripted || d.quickScripted) : d.quickScripted,
        seats: followUpReview ? (d.followUpSeats || d.seats) : d.seats,
        followUpReview,
        actions: followUpReview
          ? [
              { id: "second_opinion", label: "Open second opinion", kind: "primary" },
              { id: "dismiss", label: "Dismiss ▾", kind: "quiet" },
            ]
          : [
              { id: "start_referral", label: "Draft referral", kind: "primary" },
              { id: "second_opinion", label: "Second opinion ▸", kind: "" },
              { id: "dismiss", label: "Dismiss ▾", kind: "quiet" },
            ],
        why: followUpReview
          ? `You completed the synthetic referral workflow; after ${Math.round(R09_DWELL_MS / 1000)} s of chart stillness, deeper review remains opt-in · R-09`
          : `Chart open ${Math.round(R09_DWELL_MS / 1000)} s: ${d.trigger || "A patient-specific depth flag is active"}; no observed derived note signal confirms it was addressed · R-09`,
      });
    }, R09_DWELL_MS);
  }

  function referralDraftCard(mrn) {
    const p = byMrn.get(mrn);
    if (!p) return;
    const workflows = store(REFERRAL_STATE_KEY, {});
    workflows[mrn] = { status: "draft", createdAt: new Date().toISOString(), simulated: true };
    save(REFERRAL_STATE_KEY, workflows);
    commit({
      id: `referral-draft:${mrn}`, rule: "R-12", type: "watch", tempo: "DRAFT", mrn, name: p.name,
      headline: "Referral draft saved locally: Nothing has been sent.",
      bullets: [
        { t: "Proposed service: Nutrition services. Owner and recipient require review.", src: "Synthetic draft" },
        { t: "Nothing sends on its own: The button below only simulates signing and sending." },
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
        { t: "Prototype limit: No deadline monitor runs, so this card will not return automatically.", src: "POC boundary" },
      ],
      actions: [
        { id: "acknowledge", label: "Acknowledge", kind: "primary" },
        { id: "dismiss", label: "Dismiss card ▾", kind: "quiet" },
      ],
      why: "You explicitly simulated signing and sending the referral · R-12 · owner and due date recorded locally · no deadline monitor or external transmission",
    });
  }

  /* ---------------- actions ---------------- */
  /* Resolve the named EHR inside the click gesture before sending a command.
     An independently opened EHR can live in another browsing-context group;
     in that case Chrome returns a new about:blank tab instead of that old tab. */
  function openEhrTarget() {
    try {
      const handle = window.open("", "nudg-ehr");
      if (!handle) return null;
      let onEhrPath = false;
      let ready = false;
      let instanceId = null;
      try {
        onEhrPath = handle.location.href !== "about:blank" && handle.location.pathname.startsWith("/ehr/");
        ready = onEhrPath && handle.__nudgEhrReady === true;
        instanceId = ready && typeof handle.__nudgEhrInstanceId === "string" ? handle.__nudgEhrInstanceId : null;
      } catch (e) { /* an existing named context navigated away; reclaim it below */ }
      return { handle, existing: ready, needsNavigation: !onEhrPath, instanceId };
    } catch (e) { return null; }
  }

  function queueEhrCommand(command, card, { persist = true } = {}) {
    clearTimeout(handoffTimer);
    clearTimeout(commandCleanupTimer);
    const expiresAt = Date.now() + 15000;
    pendingHandoff = { commandId: command.commandId, cardId: card.id, card, expiresAt };
    if (persist) save(PENDING_EHR_COMMAND_KEY, { ...command, expiresAt });
    else {
      try { localStorage.removeItem(PENDING_EHR_COMMAND_KEY); } catch (e) { /* optional storage */ }
    }
    handoffTimer = setTimeout(() => {
      if (!pendingHandoff || pendingHandoff.commandId !== command.commandId) return;
      NudgBuddy.toast("LegacyChart has not confirmed the handoff. The nudge is still here so you can retry.");
    }, 3500);
    commandCleanupTimer = setTimeout(() => {
      const queued = store(PENDING_EHR_COMMAND_KEY, null);
      if (queued && queued.commandId === command.commandId) {
        try { localStorage.removeItem(PENDING_EHR_COMMAND_KEY); } catch (e) { /* optional storage */ }
      }
      if (pendingHandoff && pendingHandoff.commandId === command.commandId) {
        clearTimeout(handoffTimer);
        pendingHandoff = null;
      }
    }, 15100);
  }

  function runAction(card, actionId) {
    if (actionId === "dismiss" || actionId === "not_this") {
      toggleDismissMenu(card);
      return;
    }
    if (!["open_rhythm", "second_opinion"].includes(actionId)) {
      NudgBus.emit("buddy", "nudge_acted", { id: card.id, rule: card.rule, mrn: card.mrn, action: actionId, origin: INSTANCE_ID });
    }
    if (actionId === "open_rhythm") {
      const command = { action: "ehr_open_doc", commandId: `${INSTANCE_ID}:${Date.now()}`, mrn: card.mrn, match: "" };
      const target = APP === "ehr" ? null : openEhrTarget();
      let jumped = false;
      if (APP !== "ehr") {
        if (target && target.existing) {
          // The named EHR is reachable: command it live, without exposing a
          // shared pending record that an unrelated EHR tab could consume.
          queueEhrCommand(command, card, { persist: false });
          command.targetEhrInstanceId = target.instanceId;
          NudgBus.emit("buddy", "nudg_cmd", command);
          target.handle.focus();
          jumped = true;
        } else if (target) {
          // Chrome created or returned a blank/wrong-path target. Persist first,
          // then navigate only that returned tab; do not broadcast to old EHRs.
          queueEhrCommand(command, card);
          if (target.needsNavigation) target.handle.location = "/ehr/";
          target.handle.focus();
          jumped = true;
        } else {
          // Popup blocked: retain the command for a later EHR load and allow any
          // already-open listener to respond, but report that focus failed.
          queueEhrCommand(command, card);
          NudgBus.emit("buddy", "nudg_cmd", command);
        }
      } else {
        NudgBus.emit("buddy", "nudg_cmd", command);
      }
      NudgBuddy.toast(jumped
        ? "Opening the rhythm note in LegacyChart…"
        : "LegacyChart did not open. The nudge will stay until the EHR confirms the handoff.");
    } else if (actionId === "show_me") {
      NudgBus.emit("buddy", "nudg_cmd", { action: "ehr_open_doc", mrn: card.mrn, match: "" });
      removeCard(card.id, null);
      if (NudgBuddy.isOpen()) NudgBuddy.close({ restoreFocus: false });
    } else if (actionId === "start_referral") {
      NudgBuddy.toast("Referral draft saved locally: Nothing has been sent.");
      removeCard(card.id, null);
      referralDraftCard(card.mrn);
      NudgBus.emit("buddy", "referral_drafted", { mrn: card.mrn, origin: INSTANCE_ID });
    } else if (actionId === "simulate_send") {
      const workflows = store(REFERRAL_STATE_KEY, {});
      workflows[card.mrn] = {
        ...workflows[card.mrn],
        status: "simulated_sent",
        updatedAt: new Date().toISOString(),
        simulated: true,
      };
      save(REFERRAL_STATE_KEY, workflows);
      removeCard(card.id, null);
      fireR12(card.mrn);
      NudgBuddy.toast("Synthetic send recorded: No external system was contacted.");
      NudgBus.emit("buddy", "referral_simulated_sent", { mrn: card.mrn, origin: INSTANCE_ID });
    } else if (actionId === "discard_referral") {
      const workflows = store(REFERRAL_STATE_KEY, {});
      delete workflows[card.mrn];
      save(REFERRAL_STATE_KEY, workflows);
      removeCard(card.id, null);
      NudgBuddy.toast("Referral draft discarded.");
    } else if (actionId === "second_opinion") {
      enterPanel(card);
    } else if (actionId === "acknowledge") {
      NudgBuddy.toast("Acknowledged. This prototype will not monitor the deadline.");
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
        ${["Not relevant here", "Already considered", "Not now"].map((r) => `<button class="nbc-btn quiet" type="button" data-card="${esc(card.id)}" data-reason="${esc(r)}">${esc(r)}</button>`).join("")}
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
      el.innerHTML = `<div class="nudg-cards-empty">${activeMrn ? "Nothing needs your attention for this patient." : "Open a synthetic patient and I'll match nudges to that chart."} You'll only hear from me when I can point at something specific in the active chart.${held ? ` ${held} nudge${held === 1 ? " is" : "s are"} held for another synthetic patient.` : ""}</div>`;
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
  let peekShowTimer = null;
  function ensurePeek() {
    if (peekEl) return peekEl;
    peekEl = document.createElement("div");
    peekEl.id = "nudgPeek";
    peekEl.setAttribute("role", "region");
    peekEl.setAttribute("aria-label", "New nudge");
    peekEl.hidden = true;
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
    clearTimeout(peekShowTimer);
    el.hidden = false;
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
    peekShowTimer = setTimeout(() => {
      if (!el.hidden) el.classList.add("nudg-show");
    }, 20);
    NudgBuddy.bloom();
    clearTimeout(peekTimer);
    peekTimer = setTimeout(hidePeek, PEEK_TTL_MS);
  }
  function hidePeek() {
    clearTimeout(peekShowTimer);
    peekShowTimer = null;
    if (!peekEl) return;
    peekEl.classList.remove("nudg-show");
    peekEl.hidden = true;
  }
  function hidePeekFor(id) { if (peekEl && peekEl.dataset.cardId === id) hidePeek(); }

  // However the popover opens (orb, cursor, Shift+P), the peek stands down.
  new MutationObserver(() => {
    if (NudgBuddy.isOpen()) hidePeek();
  }).observe(document.getElementById("nudgPop"), { attributes: true, attributeFilter: ["class"] });

  /* ---------------- second-opinion panel ---------------- */
  const LANE_LABEL = {
    "live-claude": ["live", "LIVE: CLAUDE (ANTHROPIC API)"],
    "live-codex": ["live", "LIVE: GPT VIA CODEX CLI"],
    "scripted-quick": ["scripted", "SCRIPTED: QUICK LANE UNAVAILABLE"],
    "scripted-panel": ["scripted", "SCRIPTED: PANEL LANE UNAVAILABLE"],
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
    const [cls, label] = LANE_LABEL[mode] || LANE_LABEL["scripted-quick"];
    body.innerHTML = `<span class="nb-mode ${cls}">${label}</span><div class="nbp-quick">${esc(text)}</div>` +
      (note ? `<div class="nbp-receipt"><span class="nbp-spin"></span>${esc(note)}</div>` : "") +
      (receipt ? `<div class="nbp-receipt">${esc(receipt)}</div>` : "");
  }

  async function runQuick() {
    const myRun = panelRun;
    const p = byMrn.get(panelCard.mrn);
    const d = p.depthPack || {};
    const scripted = panelCard.quickScripted || d.quickScripted || "No scripted quick take is prepared for this patient.";
    const h = await lanes();
    if (myRun !== panelRun) return;
    const liveAvailable = h.claude || h.codex;
    // Fallback ladder, inverted for latency honesty: scripted paints instantly,
    // the live lane replaces it in place when it lands (codex ≈ 60–90 s).
    paintQuick(liveAvailable ? "scripted-pending" : "scripted-quick", scripted, "", liveAvailable ? (h.claude ? "Live lane answering (Claude): it replaces this scripted text when it lands." : "Live lane answering (GPT via codex, about a minute): it replaces this scripted text when it lands.") : "");
    if (!liveAvailable) return;
    const run = beginRelay();
    try {
      const res = await relay("/api/quick", { runId: run.runId, question: panelCard.question, patient: chartFacts(p, panelCard), context: [] }, 150000, run.controller);
      if (myRun === panelRun && res && res.mode && res.mode !== "scripted" && res.text && panelCard) {
        paintQuick(res.mode, res.text, res.receipt ? `receipt: ${res.receipt.served_mode} · ${res.receipt.latency_ms} ms` : "");
      } else if (myRun === panelRun && res && res.mode === "scripted" && panelCard) {
        paintQuick("scripted-quick", scripted, "receipt: live lane became unavailable; scripted fallback remains");
      }
    } catch (e) {
      if (myRun === panelRun && panelCard && panelLane === "quick") {
        paintQuick("scripted-quick", scripted, "receipt: live lane unavailable; scripted fallback remains");
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
    const [cls, label] = LANE_LABEL[mode] || LANE_LABEL["scripted-panel"];
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
        : `Supported: ${support}/${seats.length} seats <small>· no seat requested missing data · positions, never confidence</small>`;
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
    const scripted = panelCard.seats || d.seats || [];
    const h = await lanes();
    if (myRun !== panelRun) return;
    // Fallback ladder, latency-honest: scripted seats paint instantly; the live
    // multi-agent run replaces them in place when it lands (codex ≈ 1–2 min).
    paintSeats(h.codex ? "scripted-pending" : "scripted-panel", scripted, h.codex
      ? "run: scripted pack shown while the live panel deliberates (GPT via codex, 1–2 min)…"
      : "run: scripted pack · the live lane appears here when the relay is up");
    if (!h.codex) return;
    const run = beginRelay();
    try {
      const res = await relay("/api/panel", { runId: run.runId, question: panelCard.question, patient: chartFacts(p, panelCard), seats: defaultSeats() }, 180000, run.controller);
      if (myRun === panelRun && res && res.mode === "live-codex" && res.seats && panelCard) {
        paintSeats(res.mode, res.seats,
          `run: live · seats: ${res.seats.length} · one model per lane, contexts isolated · ${res.receipt ? res.receipt.latency_ms + " ms" : ""}`);
      } else if (myRun === panelRun && res && res.mode === "scripted" && panelCard) {
        paintSeats("scripted-panel", scripted, "run: live lane became unavailable; scripted fallback remains");
      }
    } catch (e) {
      if (myRun === panelRun && panelCard && panelLane === "panel") {
        paintSeats("scripted-panel", scripted, "run: live lane unavailable; scripted fallback remains");
      }
    }
    finally { finishRelay(run); }
  }

  function chartFacts(p, card) {
    const facts = {
      name: p.name, age: p.age, sex: p.sex, problems: p.problems, meds: p.meds,
      allergies: p.allergies, vitals: p.vitals, labs: p.labs, reason: p.reason,
      synthetic: true,
    };
    if (card && card.followUpReview) {
      facts.referralWorkflow = {
        status: "simulated_send_recorded",
        owner: "Dr. Rivera",
        backup: "Care coordination",
        due: "2026-07-25",
        deadlineMonitor: "not_implemented",
      };
    }
    return facts;
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
        if (APP !== "ehr") break;
        lastTabByMrn.set(d.mrn, d.tab); // track where the doctor is, even for programmatic changes
        if (!d.user) break; // programmatic tab changes never count as hunting
        const list = tabViews.get(d.mrn) || [];
        list.push({ tab: d.tab, ts: Date.now() });
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
      case "ehr_command_ack":
        if (APP !== "scribe" || evt.app !== "ehr" || !pendingHandoff || d.commandId !== pendingHandoff.commandId) break;
        if (Date.now() > pendingHandoff.expiresAt) {
          clearTimeout(handoffTimer);
          clearTimeout(commandCleanupTimer);
          try { localStorage.removeItem(PENDING_EHR_COMMAND_KEY); } catch (e) { /* optional storage */ }
          pendingHandoff = null;
          NudgBuddy.toast("LegacyChart confirmed too late. The nudge is still here so you can retry.");
          break;
        }
        clearTimeout(handoffTimer);
        clearTimeout(commandCleanupTimer);
        try { localStorage.removeItem(PENDING_EHR_COMMAND_KEY); } catch (e) { /* optional storage */ }
        if (d.ok) {
          const acted = pendingHandoff.card;
          NudgBus.emit("buddy", "nudge_acted", { id: acted.id, rule: acted.rule, mrn: acted.mrn, action: "open_rhythm", origin: INSTANCE_ID });
          removeCard(pendingHandoff.cardId, null);
          NudgBuddy.toast("LegacyChart confirmed: The rhythm note is open and highlighted.");
        } else {
          NudgBuddy.toast("LegacyChart could not open that note. The nudge is still here so you can retry.");
        }
        pendingHandoff = null;
        break;
      case "demo_reset":
        cards.clear();
        noteSignals.clear();
        tabViews.clear();
        lastTabByMrn.clear();
        clearTimeout(dwellTimer);
        clearTimeout(handoffTimer);
        clearTimeout(commandCleanupTimer);
        dwellTimer = null;
        pendingHandoff = null;
        try { localStorage.removeItem(PENDING_EHR_COMMAND_KEY); } catch (e) { /* optional storage */ }
        activeMrn = null;
        save("nudg_cooldowns", {});
        save("nudg_claims", {});
        save("nudg_metrics", { evaluated: 0, shown: 0 });
        save(REFERRAL_STATE_KEY, {});
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
