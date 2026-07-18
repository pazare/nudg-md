/* NUDG MD buddy — collapsed presence (Step 2 preview).
   Two variants the demo can switch live (Shift+B, synced across tabs):
     A "dock"   — calm orb pinned to a screen edge (draggable, snaps).
     B "cursor" — small companion that trails the cursor (NUDG heritage).
   Both listen to the workflow bus and preview what the buddy heard; nudge
   cards proper arrive in Step 2. */
(function () {
  "use strict";
  if (window.__nudgBuddyLoaded || !window.NudgBus) return;
  window.__nudgBuddyLoaded = true;

  const VKEY = "nudg_buddy_variant";
  const PKEY = "nudg_buddy_pos";
  let variant = localStorage.getItem(VKEY) === "cursor" ? "cursor" : "dock";
  let unseen = 0;
  let popOpen = false;
  let events = []; // {ts, app, text}

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- plain-language event labels (specific-or-silent) ---------- */
  const LABELS = {
    encounter_selected: (d) => `Opened ${d.name}'s visit`,
    encounter_added: (d) => `Added encounter — ${d.name}`,
    recording_started: (d) => `Simulated visit timer started — ${d.name}`,
    recording_stopped: (d) => `Simulated visit timer stopped after ${d.seconds}s`,
    note_generated: (d) => `Note drafted for ${d.name}`,
    note_generation_cancelled: () => "Note generation cancelled after patient switch",
    note_copied: (d) => `Copied note for ${d.name} (${d.mrn}) — ready for matching-chart check`,
    note_copy_failed: (d) => `Copy failed for note ${d.mrn}`,
    note_reviewed: (d) => `Note marked reviewed for ${d.name} (${d.mrn})`,
    ai_question_asked: (d) => `Asked scripted assistant about ${d.name} (${d.mrn})`,
    ehr_patient_opened: (d) => `Opened EHR chart — ${d.name}`,
    ehr_tab_viewed: (d) => `EHR: viewed ${d.tab} tab`,
    ehr_note_filed: (d) => `Filed ${d.type} for ${d.name} (${d.mrn})`,
    ehr_note_mismatch_blocked: (d) => `Blocked note mismatch: ${d.noteMrn} ≠ ${d.openMrn}`,
    ehr_orders_signed: (d) => `Signed ${d.count} EHR order(s)`,
    ehr_document_opened: (d) => `Read ${d.type} (${d.date})`,
    nudge_committed: (d) => `Nudge: ${d.headline}`,
    nudge_acted: (d) => `Acted on a nudge: ${d.action}`,
    nudge_dismissed: (d) => `Dismissed a nudge: ${d.reason}`,
    nudge_superseded: () => "A nudge resolved itself and left",
  };

  function labelFor(evt) {
    const fn = LABELS[evt.type];
    if (!fn) return null;
    try { return fn(evt.detail || {}); } catch (e) { return null; }
  }

  function rel(ts) {
    const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  /* ---------- DOM ---------- */
  const PULSE = '<svg viewBox="0 0 24 24"><path d="M2.5 12h4l2.5-6 4.5 12 2.5-6h5.5"/></svg>';
  const root = document.createElement("div");
  root.innerHTML = `
    <button id="nudgOrb" class="nudg-hidden" title="NUDG MD buddy" aria-label="Open NUDG MD buddy preview" aria-haspopup="dialog" aria-expanded="false" aria-controls="nudgPop">${PULSE}<span class="nudg-badge nudg-hidden"></span></button>
    <button id="nudgCur" class="nudg-hidden" title="NUDG MD buddy — press Shift+P to open" aria-label="Open NUDG MD buddy preview; keyboard shortcut Shift+P" aria-haspopup="dialog" aria-expanded="false" aria-controls="nudgPop">${PULSE}<span class="nudg-badge nudg-hidden"></span></button>
    <div id="nudgPop" class="nudg-hidden" role="dialog" aria-modal="false" aria-labelledby="nudgPopTitle" tabindex="-1">
      <div class="nudg-pop-head">
        <div class="nudg-pop-title" id="nudgPopTitle">NUDG MD<span>your buddy</span></div>
        <button class="nudg-close" aria-label="Close">✕</button>
      </div>
      <div class="nudg-tabs">
        <button class="nudg-tab active" type="button" data-view="nudges">Nudges</button>
        <button class="nudg-tab" type="button" data-view="activity">Activity</button>
      </div>
      <div id="nudgCards"></div>
      <div class="nudg-list nudg-hidden" role="log" aria-live="polite"></div>
      <div class="nudg-pop-foot">SYNTHETIC DEMO · event preview, not clinical guidance · <button id="nudgSwitch" type="button">Switch style (Shift+B)</button></div>
    </div>
    <div id="nudgToast" role="status" aria-live="polite"></div>`;
  document.body.appendChild(root);

  const orb = root.querySelector("#nudgOrb");
  const cur = root.querySelector("#nudgCur");
  const pop = root.querySelector("#nudgPop");
  const list = pop.querySelector(".nudg-list");
  const toast = root.querySelector("#nudgToast");
  const badges = root.querySelectorAll(".nudg-badge");
  const cardsEl = pop.querySelector("#nudgCards");
  const tabs = pop.querySelectorAll(".nudg-tab");
  let lastFocus = null;
  let nudgeCount = 0;
  let view = "nudges";

  /* ---------- badges / bloom ---------- */
  function renderBadges() {
    const shown = nudgeCount > 0 ? nudgeCount : unseen;
    for (const b of badges) {
      b.textContent = shown > 99 ? "99+" : String(shown);
      b.classList.toggle("nudg-hidden", shown === 0);
    }
    orb.classList.toggle("nudg-alive", shown > 0);
    cur.classList.toggle("nudg-alive", shown > 0);
    const nudgeTab = pop.querySelector('.nudg-tab[data-view="nudges"]');
    if (nudgeTab) nudgeTab.textContent = nudgeCount > 0 ? `Nudges (${nudgeCount})` : "Nudges";
  }

  function showView(name) {
    view = name;
    for (const t of tabs) t.classList.toggle("active", t.dataset.view === name);
    cardsEl.classList.toggle("nudg-hidden", name !== "nudges");
    list.classList.toggle("nudg-hidden", name !== "activity");
  }
  tabs.forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));
  function bloom() {
    const el = variant === "dock" ? orb : cur;
    el.classList.remove("nudg-bloom");
    void el.offsetWidth; // restart animation
    el.classList.add("nudg-bloom");
  }

  /* ---------- popover ---------- */
  function renderList() {
    if (!events.length) {
      list.innerHTML = `<div class="nudg-empty">I'm listening to your workflow. Work in either tab: everything I hear lands here, and the moments that matter become nudges.</div>`;
      return;
    }
    list.innerHTML = events
      .slice()
      .reverse()
      .map(
        (e) => `<div class="nudg-item"><span class="nudg-dot ${esc(e.app)}"></span><div>
          <div class="nudg-item-text">${esc(e.text)}</div>
          <div class="nudg-item-time">${esc(rel(e.ts))} · ${e.app === "scribe" ? "Scribe" : e.app === "ehr" ? "EHR" : "Buddy"}</div>
        </div></div>`
      )
      .join("");
  }

  function positionPop(rect) {
    const W = pop.offsetWidth || 304;
    const H = Math.min(360, pop.offsetHeight || 340);
    let left = Math.min(Math.max(12, rect.left - W + rect.width), window.innerWidth - W - 12);
    pop.style.left = `${left}px`;
    if (rect.top > H + 24) {
      pop.style.top = `${rect.top - H - 12}px`;
    } else {
      pop.style.top = `${Math.min(rect.bottom + 12, window.innerHeight - H - 12)}px`;
    }
  }

  function openPop(anchorEl) {
    lastFocus = document.activeElement;
    popOpen = true;
    unseen = 0;
    renderBadges();
    renderList();
    pop.classList.remove("nudg-hidden");
    positionPop(anchorEl.getBoundingClientRect());
    orb.setAttribute("aria-expanded", "true");
    cur.setAttribute("aria-expanded", "true");
    pop.querySelector(".nudg-close").focus();
  }
  function closePop({ restoreFocus = true } = {}) {
    popOpen = false;
    pop.classList.add("nudg-hidden");
    orb.setAttribute("aria-expanded", "false");
    cur.setAttribute("aria-expanded", "false");
    if (restoreFocus && lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }
  pop.querySelector(".nudg-close").addEventListener("click", closePop);
  document.addEventListener("pointerdown", (e) => {
    if (popOpen && !pop.contains(e.target) && e.target !== orb && !orb.contains(e.target) && e.target !== cur && !cur.contains(e.target)) closePop();
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && popOpen && closePop());

  /* ---------- variant switching ---------- */
  function applyVariant() {
    orb.classList.toggle("nudg-hidden", variant !== "dock");
    cur.classList.toggle("nudg-hidden", variant !== "cursor");
    if (popOpen) closePop({ restoreFocus: false });
  }
  function setVariant(v, { silent } = {}) {
    if (v === variant) return;
    variant = v;
    localStorage.setItem(VKEY, v);
    applyVariant();
    if (!silent) {
      showToast(v === "dock" ? "Buddy style: calm dock (Option A)" : "Cursor companion active — Shift+P opens its preview");
      NudgBus.emit("buddy", "buddy_variant_changed", { variant: v });
    }
  }
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (!typing && e.shiftKey && (e.key === "B" || e.key === "b")) {
      e.preventDefault();
      setVariant(variant === "dock" ? "cursor" : "dock");
    }
  });
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (!typing && variant === "cursor" && e.shiftKey && (e.key === "P" || e.key === "p")) {
      e.preventDefault();
      popOpen ? closePop() : openPop(cur);
    }
  });
  pop.querySelector("#nudgSwitch").addEventListener("click", () => setVariant(variant === "dock" ? "cursor" : "dock"));

  let toastTimer = null;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("nudg-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("nudg-show"), 2300);
  }

  /* ---------- dock: drag + snap ---------- */
  (function initDock() {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(PKEY)); } catch (e) { return null; } })();
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved.x, saved.y);
    function place(x, y) {
      orb.style.left = `${x}px`;
      orb.style.top = `${y}px`;
      orb.style.right = "auto";
      orb.style.bottom = "auto";
    }
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    orb.addEventListener("pointerdown", (e) => {
      const r = orb.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; dragging = false;
      orb.setPointerCapture(e.pointerId);
    });
    orb.addEventListener("pointermove", (e) => {
      if (!orb.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging && Math.hypot(dx, dy) > 5) dragging = true;
      if (dragging) place(ox + dx, oy + dy);
    });
    orb.addEventListener("pointerup", (e) => {
      orb.releasePointerCapture(e.pointerId);
      if (!dragging) { popOpen ? closePop() : openPop(orb); return; }
      const r = orb.getBoundingClientRect();
      const x = r.left + r.width / 2 < window.innerWidth / 2 ? 14 : window.innerWidth - r.width - 14;
      const y = Math.min(Math.max(14, r.top), window.innerHeight - r.height - 14);
      place(x, y);
      localStorage.setItem(PKEY, JSON.stringify({ x, y }));
    });
    window.addEventListener("resize", () => {
      const r = orb.getBoundingClientRect();
      if (r.right > window.innerWidth || r.bottom > window.innerHeight) {
        place(Math.min(r.left, window.innerWidth - r.width - 14), Math.min(r.top, window.innerHeight - r.height - 14));
      }
    });
  })();

  /* ---------- cursor companion: lagged follow, freeze on hover ---------- */
  (function initCursor() {
    let tx = window.innerWidth - 80, ty = Math.max(120, window.innerHeight - 300);
    let fx = tx, fy = ty, frozen = false, raf = null, typingTimer = null;
    function loop() {
      if (!frozen) {
        fx += (tx - fx) * 0.16;
        fy += (ty - fy) * 0.16;
      }
      cur.style.transform = `translate(${fx}px, ${fy}px)`;
      if (Math.abs(tx - fx) > 0.5 || Math.abs(ty - fy) > 0.5) raf = requestAnimationFrame(loop);
      else raf = null;
    }
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }
    document.addEventListener("pointermove", (e) => {
      tx = Math.min(e.clientX + 18, window.innerWidth - 40);
      ty = Math.min(e.clientY + 22, window.innerHeight - 40);
      cur.classList.remove("nudg-gone");
      kick();
    });
    document.documentElement.addEventListener("pointerleave", () => cur.classList.add("nudg-gone"));
    cur.addEventListener("pointerenter", () => { frozen = true; });
    cur.addEventListener("pointerleave", () => { frozen = false; kick(); });
    cur.addEventListener("click", () => (popOpen ? closePop() : openPop(cur)));
    document.addEventListener("keydown", (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        cur.classList.add("nudg-typing");
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => cur.classList.remove("nudg-typing"), 1100);
      }
    });
    cur.style.transform = `translate(${fx}px, ${fy}px)`;
  })();

  /* ---------- bus wiring ---------- */
  NudgBus.on((evt) => {
    if (evt.type === "demo_reset") {
      events = [];
      unseen = 0;
      renderBadges();
      renderList();
      if (popOpen) closePop();
      return;
    }
    if (evt.type === "buddy_variant_changed") {
      if (evt.detail && evt.detail.variant && evt.detail.variant !== variant) setVariant(evt.detail.variant, { silent: true });
      return;
    }
    const text = labelFor(evt);
    if (!text) return;
    events.push({ ts: evt.ts, app: evt.app, text });
    events = events.slice(-12);
    if (popOpen) renderList();
    else {
      unseen++;
      renderBadges();
      bloom();
    }
  });

  // Seed from recent history (counts as already seen).
  events = NudgBus.history()
    .map((e) => ({ ts: e.ts, app: e.app, text: labelFor(e) }))
    .filter((e) => e.text)
    .slice(-8);

  applyVariant();
  showView("nudges");
  renderBadges();

  if (!sessionStorage.getItem("nudg_hint_shown")) {
    sessionStorage.setItem("nudg_hint_shown", "1");
    setTimeout(() => showToast("Your buddy is here: click the pulse to open it. Shift+B switches style."), 1200);
  }

  /* ---------- public API for the nudge engine (shared/nudges.js) ---------- */
  window.NudgBuddy = {
    open() { if (!popOpen) openPop(variant === "dock" ? orb : cur); },
    close: closePop,
    isOpen: () => popOpen,
    anchorEl: () => (variant === "dock" ? orb : cur),
    variant: () => variant,
    toast: showToast,
    bloom,
    cardsEl,
    showView,
    setWide(w) { pop.classList.toggle("nudg-pop-wide", Boolean(w)); if (popOpen) positionPop((variant === "dock" ? orb : cur).getBoundingClientRect()); },
    setNudgeCount(n) { nudgeCount = n; renderBadges(); },
  };
})();
