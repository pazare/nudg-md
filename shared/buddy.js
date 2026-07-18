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
  const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

  /* ---------- plain-language event labels (specific-or-silent) ---------- */
  const LABELS = {
    encounter_selected: (d) => `Opened ${d.name}'s visit`,
    encounter_added: (d) => `Added encounter — ${d.name}`,
    recording_started: (d) => `Recording started — ${d.name}`,
    recording_stopped: (d) => `Recording stopped after ${d.seconds}s`,
    note_generated: (d) => `Note drafted for ${d.name}`,
    note_copied: () => "Note copied — ready to file in the EHR",
    note_reviewed: () => "Note marked reviewed",
    ai_question_asked: (d) => `Asked Abridge AI: “${trunc(d.q, 44)}”`,
    ehr_patient_opened: (d) => `Opened EHR chart — ${d.name}`,
    ehr_tab_viewed: (d) => `EHR: viewed ${d.tab} tab`,
    ehr_note_filed: (d) => `Filed ${d.type} in the EHR`,
    ehr_orders_signed: (d) => `Signed ${d.count} EHR order(s)`,
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
    <button id="nudgOrb" class="nudg-hidden" title="NUDG MD buddy" aria-label="NUDG MD buddy">${PULSE}<span class="nudg-badge nudg-hidden"></span></button>
    <button id="nudgCur" class="nudg-hidden" title="NUDG MD buddy" aria-label="NUDG MD buddy">${PULSE}<span class="nudg-badge nudg-hidden"></span></button>
    <div id="nudgPop" class="nudg-hidden" role="dialog" aria-label="NUDG MD buddy preview">
      <div class="nudg-pop-head">
        <div class="nudg-pop-title">NUDG MD<span>buddy preview</span></div>
        <button class="nudg-close" aria-label="Close">✕</button>
      </div>
      <div class="nudg-list"></div>
      <div class="nudg-pop-foot">SYNTHETIC DEMO · nudge cards arrive in Step 2 · <a id="nudgSwitch">Switch style (Shift+B)</a></div>
    </div>
    <div id="nudgToast" aria-hidden="true"></div>`;
  document.body.appendChild(root);

  const orb = root.querySelector("#nudgOrb");
  const cur = root.querySelector("#nudgCur");
  const pop = root.querySelector("#nudgPop");
  const list = pop.querySelector(".nudg-list");
  const toast = root.querySelector("#nudgToast");
  const badges = root.querySelectorAll(".nudg-badge");

  /* ---------- badges / bloom ---------- */
  function renderBadges() {
    for (const b of badges) {
      b.textContent = unseen > 99 ? "99+" : String(unseen);
      b.classList.toggle("nudg-hidden", unseen === 0);
    }
    orb.classList.toggle("nudg-alive", unseen > 0);
    cur.classList.toggle("nudg-alive", unseen > 0);
  }
  function bloom() {
    const el = variant === "dock" ? orb : cur;
    el.classList.remove("nudg-bloom");
    void el.offsetWidth; // restart animation
    el.classList.add("nudg-bloom");
  }

  /* ---------- popover ---------- */
  function renderList() {
    if (!events.length) {
      list.innerHTML = `<div class="nudg-empty">I'm listening to your workflow. Work in either tab — what I hear shows up here, and becomes nudge cards in Step 2.</div>`;
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
    const W = 304;
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
    popOpen = true;
    unseen = 0;
    renderBadges();
    renderList();
    pop.classList.remove("nudg-hidden");
    positionPop(anchorEl.getBoundingClientRect());
  }
  function closePop() {
    popOpen = false;
    pop.classList.add("nudg-hidden");
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
    if (popOpen) closePop();
  }
  function setVariant(v, { silent } = {}) {
    if (v === variant) return;
    variant = v;
    localStorage.setItem(VKEY, v);
    applyVariant();
    if (!silent) {
      showToast(v === "dock" ? "Buddy style: calm dock (Option A)" : "Buddy style: cursor companion (Option B)");
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
  renderBadges();

  if (!sessionStorage.getItem("nudg_hint_shown")) {
    sessionStorage.setItem("nudg_hint_shown", "1");
    setTimeout(() => showToast("Buddy preview active — press Shift+B to switch style"), 1200);
  }
})();
