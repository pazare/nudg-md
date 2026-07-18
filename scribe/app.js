/* Abridge-style scribe — synthetic demo logic. No network beyond the local JSON. */
"use strict";
const APP_ID = "scribe";
const SESSION_KEY = "nudg_scribe_state_v1";

const $ = (id) => document.getElementById(id);
const els = {
  todayLabel: $("todayLabel"), encList: $("encList"), addEnc: $("addEnc"), resetDemo: $("resetDemo"),
  railWork: $("railWork"), railRec: $("railRec"), recTimer: $("recTimer"), stopBtn: $("stopBtn"),
  encTitle: $("encTitle"), dictateBtn: $("dictateBtn"), startBtn: $("startBtn"), genBtn: $("genBtn"),
  centerFoot: $("centerFoot"), readyHeading: $("readyHeading"), readySub: $("readySub"),
  noteName: $("noteName"), noteMeta: $("noteMeta"), noteSections: $("noteSections"),
  copyNote: $("copyNote"), markReviewed: $("markReviewed"), aiEmpty: $("aiEmpty"),
  aiPatientCtx: $("aiPatientCtx"), aiThread: $("aiThread"), askInput: $("askInput"), askSend: $("askSend"),
  states: {
    empty: $("stateEmpty"), ready: $("stateReady"), listening: $("stateListening"),
    drafting: $("stateDrafting"), note: $("noteView"),
  },
};

let DATA = null;
let encounters = [];
let selected = null;
let renderedNotePatient = null;
let recordingPatient = null;
let recTimerId = null;
let recSeconds = 0;
let draftTimerId = null;
let draftPatient = null;
let draftGeneration = 0;
const noteReady = new Set();
const reviewed = new Set();
const noteDraftHtml = new Map();
const assistantThreads = new Map();

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nowTime = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function todayLabel() {
  const d = new Date();
  const day = d.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `Today (${d.toLocaleDateString("en-US", { month: "short" })} ${day}${suffix})`;
}

function restoreStatus() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "{}");
    for (const mrn of saved.noteReady || []) noteReady.add(mrn);
    for (const mrn of saved.reviewed || []) reviewed.add(mrn);
  } catch (e) { /* a corrupt demo session safely starts clean */ }
}

function persistStatus() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ noteReady: [...noteReady], reviewed: [...reviewed] }));
  } catch (e) { /* session storage is optional */ }
}

/* ---------------- Worklist ---------------- */
function renderWorklist() {
  els.encList.innerHTML = "";
  if (!encounters.length) {
    els.encList.innerHTML = '<div class="enc-empty">Your worklist is empty.</div>';
    return;
  }
  for (const e of encounters) {
    const isSelected = Boolean(selected && selected.mrn === e.mrn);
    const isReady = noteReady.has(e.mrn);
    const btn = document.createElement("button");
    btn.className = "enc" + (isSelected ? " selected" : "") + (isReady ? " done" : "");
    btn.disabled = Boolean(recordingPatient && recordingPatient.mrn !== e.mrn);
    btn.setAttribute("aria-pressed", String(isSelected));
    btn.setAttribute("aria-label", `${e.time}, ${e.name}, ${e.reason}, ${e.mrn}${isReady ? ", note ready" : ""}`);
    btn.innerHTML = `
      <span class="enc-time">${esc(e.time)}</span>
      <span class="enc-main">
        <span class="enc-name">${esc(e.name)}</span>
        <span class="enc-meta">${esc(e.reason)} · ${esc(e.mrn)}</span>
      </span>
      <span class="enc-dot" aria-hidden="true"></span>`;
    btn.addEventListener("click", () => selectEncounter(e));
    els.encList.appendChild(btn);
  }
}

function cancelDraftForSwitch(nextMrn) {
  if (!draftTimerId || !draftPatient || draftPatient.mrn === nextMrn) return;
  clearTimeout(draftTimerId);
  draftTimerId = null;
  draftGeneration += 1;
  NudgBus.emit(APP_ID, "note_generation_cancelled", { mrn: draftPatient.mrn, reason: "patient_switched" });
  draftPatient = null;
}

function saveRenderedDraft() {
  if (!renderedNotePatient || reviewed.has(renderedNotePatient.mrn)) return;
  noteDraftHtml.set(renderedNotePatient.mrn, els.noteSections.innerHTML);
}

function selectEncounter(e) {
  if (recordingPatient && recordingPatient.mrn !== e.mrn) return;
  cancelDraftForSwitch(e.mrn);
  saveRenderedDraft();
  selected = e;
  els.encTitle.disabled = false;
  els.encTitle.value = e.name;
  els.startBtn.disabled = false;
  els.genBtn.disabled = false;
  els.dictateBtn.disabled = false;
  els.askInput.disabled = false;
  els.askInput.value = "";
  syncAskButton();
  renderWorklist();
  renderAssistantThread();
  if (noteReady.has(e.mrn)) {
    renderNote(e);
  } else {
    renderedNotePatient = null;
    els.readyHeading.textContent = `Ready for ${e.name.split(" ")[0]}'s visit.`;
    els.readySub.textContent = `${e.reason} · scheduled ${e.time}. Start the simulated visit timer, or generate the prewritten synthetic note.`;
    showState("ready");
    els.centerFoot.classList.remove("hidden");
  }
  NudgBus.emit(APP_ID, "encounter_selected", { mrn: e.mrn, name: e.name, reason: e.reason });
}

function addEncounter() {
  const n = encounters.filter((e) => e.adhoc).length + 1;
  const e = {
    mrn: `SYN-WALKIN-${String(n).padStart(3, "0")}`,
    name: `Synthetic Walk-in ${n}`,
    time: nowTime(), reason: "Demo-only walk-in", adhoc: true,
  };
  encounters.push(e);
  renderWorklist();
  NudgBus.emit(APP_ID, "encounter_added", { mrn: e.mrn, name: e.name });
  selectEncounter(e);
}

/* ---------------- Center states ---------------- */
function showState(name) {
  for (const [key, el] of Object.entries(els.states)) el.classList.toggle("hidden", key !== name);
}

/* ---------------- Simulated recording ---------------- */
function fmtTimer(s) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function startRecording() {
  if (!selected || recTimerId) return;
  recordingPatient = selected;
  recSeconds = 0;
  els.recTimer.textContent = fmtTimer(0);
  els.railWork.classList.add("hidden");
  els.railRec.classList.remove("hidden");
  els.centerFoot.classList.add("hidden");
  showState("listening");
  renderWorklist();
  recTimerId = setInterval(() => {
    recSeconds += 1;
    els.recTimer.textContent = fmtTimer(recSeconds);
  }, 1000);
  NudgBus.emit(APP_ID, "recording_started", { mrn: recordingPatient.mrn, name: recordingPatient.name, simulated: true });
}

function stopRecording() {
  if (!recTimerId || !recordingPatient) return;
  const patient = recordingPatient;
  clearInterval(recTimerId);
  recTimerId = null;
  recordingPatient = null;
  els.railRec.classList.add("hidden");
  els.railWork.classList.remove("hidden");
  renderWorklist();
  NudgBus.emit(APP_ID, "recording_stopped", { mrn: patient.mrn, seconds: recSeconds, simulated: true });
  draftNote(1800, patient);
}

function draftNote(delayMs, patient = selected) {
  if (!patient) return;
  if (draftTimerId) clearTimeout(draftTimerId);
  const generation = ++draftGeneration;
  draftPatient = patient;
  els.startBtn.disabled = true;
  els.genBtn.disabled = true;
  els.dictateBtn.disabled = true;
  showState("drafting");
  els.centerFoot.classList.add("hidden");
  draftTimerId = setTimeout(() => {
    if (generation !== draftGeneration) return;
    draftTimerId = null;
    draftPatient = null;
    noteReady.add(patient.mrn);
    persistStatus();
    renderWorklist();
    if (selected && selected.mrn === patient.mrn) {
      els.startBtn.disabled = false;
      els.genBtn.disabled = false;
      els.dictateBtn.disabled = false;
      renderNote(patient);
    }
    NudgBus.emit(APP_ID, "note_generated", { mrn: patient.mrn, name: patient.name, scripted: true });
  }, delayMs);
}

/* ---------------- Editable note ---------------- */
function noteFor(p) {
  return p.note || {
    cc: p.reason + ".",
    hpi: `${p.name} presents for ${p.reason.toLowerCase()}. This ad-hoc synthetic encounter has no transcript; the demo uses a prewritten placeholder narrative.`,
    ros: "Review of systems performed and negative except as above.",
    exam: "Focused examination performed; findings within normal limits for this synthetic encounter.",
    ap: ["Plan discussed with the patient; follow-up as needed. (Synthetic placeholder.)"],
  };
}

function initialNoteHtml(p) {
  const n = noteFor(p);
  return `
    <h3>Chief Complaint</h3><p>${esc(n.cc)}</p>
    <h3>History of Present Illness</h3><p>${esc(n.hpi)}</p>
    <h3>Review of Systems</h3><p>${esc(n.ros)}</p>
    <h3>Physical Exam</h3><p>${esc(n.exam)}</p>
    <h3>Assessment &amp; Plan</h3><ol>${n.ap.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`;
}

function renderNote(p) {
  if (renderedNotePatient && renderedNotePatient.mrn !== p.mrn) saveRenderedDraft();
  renderedNotePatient = p;
  els.states.note.dataset.mrn = p.mrn;
  const isReviewed = reviewed.has(p.mrn);
  els.noteName.textContent = p.name;
  els.noteMeta.innerHTML = `${esc(p.reason)} · ${esc(p.time)} · MRN ${esc(p.mrn)} · Scripted synthetic draft` +
    (isReviewed ? ' · <span class="ok">Reviewed ✓</span>' : ' · <span class="edit-state">Editable — verify before filing</span>');
  els.noteSections.innerHTML = noteDraftHtml.get(p.mrn) || initialNoteHtml(p);
  els.noteSections.contentEditable = String(!isReviewed);
  els.noteSections.setAttribute("aria-label", isReviewed ? "Reviewed synthetic note" : "Editable synthetic note draft");
  els.noteSections.spellcheck = true;
  els.markReviewed.textContent = isReviewed ? "Reviewed ✓" : "Mark reviewed";
  els.markReviewed.disabled = isReviewed;
  els.copyNote.textContent = "Copy note";
  showState("note");
  els.centerFoot.classList.add("hidden");
  scheduleNoteSignals();
}

function notePlainText(p) {
  const body = renderedNotePatient && renderedNotePatient.mrn === p.mrn
    ? els.noteSections.innerText.trim()
    : initialNoteHtml(p).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return [
    "SYNTHETIC DEMO — NOT FOR CLINICAL USE",
    `MRN: ${p.mrn}`,
    `Patient: ${p.name}`,
    `Visit: ${p.reason}`,
    `Date: ${new Date().toLocaleDateString("en-US")}`,
    "",
    body,
  ].join("\n");
}

async function copyNote() {
  const patient = renderedNotePatient;
  if (!patient || !selected || patient.mrn !== selected.mrn) return;
  saveRenderedDraft();
  const text = notePlainText(patient);
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("aria-hidden", "true");
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand("copy"); } catch (copyError) { ok = false; }
    ta.remove();
  }
  els.copyNote.textContent = ok ? "Copied ✓" : "Copy failed";
  setTimeout(() => (els.copyNote.textContent = "Copy note"), 2200);
  if (ok) {
    NudgBus.emit(APP_ID, "note_copied", { mrn: patient.mrn, name: patient.name, chars: text.length });
  } else {
    NudgBus.emit(APP_ID, "note_copy_failed", { mrn: patient.mrn });
  }
}

function markReviewed() {
  const patient = renderedNotePatient;
  if (!patient || !selected || patient.mrn !== selected.mrn) return;
  saveRenderedDraft();
  reviewed.add(patient.mrn);
  persistStatus();
  renderNote(patient);
  NudgBus.emit(APP_ID, "note_reviewed", { mrn: patient.mrn, name: patient.name });
}

/* ---------------- Scripted assistant, scoped by MRN ---------------- */
function threadFor(mrn) {
  if (!assistantThreads.has(mrn)) assistantThreads.set(mrn, []);
  return assistantThreads.get(mrn);
}

function renderAssistantThread() {
  els.aiThread.innerHTML = "";
  if (!selected) {
    delete els.aiThread.dataset.mrn;
    els.aiPatientCtx.classList.add("hidden");
    els.aiEmpty.classList.remove("hidden");
    els.aiThread.classList.add("hidden");
    return;
  }
  els.aiThread.dataset.mrn = selected.mrn;
  els.aiPatientCtx.textContent = `Patient context: ${selected.name} · ${selected.mrn} · scripted synthetic responses`;
  els.aiPatientCtx.classList.remove("hidden");
  const messages = threadFor(selected.mrn);
  if (!messages.length) {
    els.aiEmpty.classList.remove("hidden");
    els.aiThread.classList.add("hidden");
    return;
  }
  els.aiEmpty.classList.add("hidden");
  els.aiThread.classList.remove("hidden");
  for (const message of messages) {
    const d = document.createElement("div");
    d.dataset.mrn = selected.mrn;
    d.dataset.role = message.role;
    if (message.role === "user") {
      d.className = "msg-user";
      d.textContent = message.text;
    } else {
      d.className = "msg-ai";
      if (message.typing) {
        d.innerHTML = '<span class="typing" aria-label="Preparing scripted answer"><i></i><i></i><i></i></span>';
      } else {
        const label = document.createElement("div");
        label.className = "answer-label";
        label.textContent = "SCRIPTED SYNTHETIC ANSWER · NOT MODEL OUTPUT";
        const answer = document.createElement("div");
        answer.textContent = message.text;
        const sources = document.createElement("div");
        sources.className = "srcs";
        for (const source of message.sources || []) {
          const chip = document.createElement("span");
          chip.className = "src";
          chip.textContent = source;
          chip.title = "Synthetic source label; no external source is connected in this demo.";
          sources.appendChild(chip);
        }
        d.append(label, answer, sources);
      }
    }
    els.aiThread.appendChild(d);
  }
  els.aiThread.lastElementChild?.scrollIntoView({ block: "end" });
}

function matchAnswer(patient, q) {
  const ql = q.toLowerCase();
  for (const item of patient.qa || []) {
    if (item.keys.some((key) => ql.includes(key))) return { a: item.a, sources: item.sources, matched: true };
  }
  return {
    a: patient.aiFallback || `This scripted demo has no prepared answer for that question about ${patient.name}.`,
    sources: ["Visit + chart (synthetic)"], matched: false,
  };
}

function syncAskButton() {
  els.askSend.disabled = !selected || !els.askInput.value.trim();
}

function ask() {
  const q = els.askInput.value.trim();
  const patient = selected;
  if (!q || !patient) return;
  els.askInput.value = "";
  syncAskButton();
  autoGrow();
  const messages = threadFor(patient.mrn);
  messages.push({ role: "user", text: q });
  const response = { role: "ai", typing: true, text: "", sources: [] };
  messages.push(response);
  renderAssistantThread();
  const ans = matchAnswer(patient, q);
  NudgBus.emit(APP_ID, "ai_question_asked", {
    mrn: patient.mrn, name: patient.name, matched: ans.matched, chars: q.length, scripted: true,
  });
  setTimeout(() => {
    response.typing = false;
    response.text = ans.a;
    response.sources = ans.sources;
    if (selected && selected.mrn === patient.mrn) renderAssistantThread();
  }, 900 + Math.random() * 600);
}

function autoGrow() {
  els.askInput.style.height = "auto";
  els.askInput.style.height = Math.min(els.askInput.scrollHeight, 96) + "px";
}

/* ---------- Derived note signals (privacy: raw text never rides the bus) ---------- */
let signalTimer = null;
let lastSignals = "";
function emitNoteSignals() {
  if (!renderedNotePatient) return;
  const text = els.noteSections.innerText.toLowerCase();
  const impressions = [];
  if (/\b(anxiety|anxious|panic)\b/.test(text)) impressions.push("anxiety");
  const topics = [];
  if (/\b(dietitian|nutritionist|nutrition referral|medical nutrition|mnt)\b/.test(text)) topics.push("nutrition_referral");
  const payload = JSON.stringify([renderedNotePatient.mrn, impressions, topics]);
  if (payload === lastSignals) return;
  lastSignals = payload;
  NudgBus.emit(APP_ID, "note_signals", {
    mrn: renderedNotePatient.mrn, name: renderedNotePatient.name, impressions, topics,
  });
}
function scheduleNoteSignals() {
  clearTimeout(signalTimer);
  signalTimer = setTimeout(emitNoteSignals, 700);
}

function resetLocal({ broadcast = true } = {}) {
  if (recTimerId) clearInterval(recTimerId);
  if (draftTimerId) clearTimeout(draftTimerId);
  recTimerId = null; draftTimerId = null; recordingPatient = null; draftPatient = null; draftGeneration += 1;
  selected = null; renderedNotePatient = null; recSeconds = 0;
  delete els.states.note.dataset.mrn;
  noteReady.clear(); reviewed.clear(); noteDraftHtml.clear(); assistantThreads.clear();
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* optional */ }
  encounters = DATA ? DATA.patients.map((p) => p) : [];
  els.railRec.classList.add("hidden");
  els.railWork.classList.remove("hidden");
  els.encTitle.value = ""; els.encTitle.disabled = true;
  els.startBtn.disabled = true; els.genBtn.disabled = true; els.dictateBtn.disabled = true;
  els.askInput.value = ""; els.askInput.disabled = true; syncAskButton();
  showState("empty"); els.centerFoot.classList.remove("hidden");
  renderWorklist(); renderAssistantThread();
  if (broadcast) NudgBus.reset(APP_ID);
}

/* ---------------- Init ---------------- */
async function init() {
  els.todayLabel.textContent = todayLabel();
  const res = await fetch("/data/patients.json");
  DATA = await res.json();
  encounters = DATA.patients.map((p) => p);
  restoreStatus();
  renderWorklist();
  renderAssistantThread();

  els.addEnc.addEventListener("click", addEncounter);
  els.resetDemo.addEventListener("click", () => {
    if (window.confirm("Reset both synthetic demo tabs and clear locally stored demo artifacts?")) resetLocal();
  });
  els.startBtn.addEventListener("click", startRecording);
  els.dictateBtn.addEventListener("click", startRecording);
  els.stopBtn.addEventListener("click", stopRecording);
  els.genBtn.addEventListener("click", () => selected && draftNote(700, selected));
  els.copyNote.addEventListener("click", copyNote);
  els.markReviewed.addEventListener("click", markReviewed);
  els.noteSections.addEventListener("input", saveRenderedDraft);
  els.noteSections.addEventListener("input", scheduleNoteSignals);
  els.askSend.addEventListener("click", ask);
  els.askInput.addEventListener("input", () => { syncAskButton(); autoGrow(); });
  els.askInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); ask(); }
  });
  NudgBus.on((evt) => {
    if (evt.type === "demo_reset" && evt.app !== APP_ID) resetLocal({ broadcast: false });
  });
  NudgBus.emit(APP_ID, "app_loaded", { encounters: encounters.length });
}

init();
