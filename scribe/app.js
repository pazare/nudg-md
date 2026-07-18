/* Abridge-style scribe — synthetic demo logic. No network beyond the local JSON. */
"use strict";
const APP_ID = "scribe";

const $ = (id) => document.getElementById(id);
const els = {
  todayLabel: $("todayLabel"),
  encList: $("encList"),
  addEnc: $("addEnc"),
  railWork: $("railWork"),
  railRec: $("railRec"),
  recTimer: $("recTimer"),
  stopBtn: $("stopBtn"),
  encTitle: $("encTitle"),
  startBtn: $("startBtn"),
  genBtn: $("genBtn"),
  centerFoot: $("centerFoot"),
  states: {
    empty: $("stateEmpty"),
    ready: $("stateReady"),
    listening: $("stateListening"),
    drafting: $("stateDrafting"),
    note: $("noteView"),
  },
  readyHeading: $("readyHeading"),
  readySub: $("readySub"),
  noteName: $("noteName"),
  noteMeta: $("noteMeta"),
  noteSections: $("noteSections"),
  copyNote: $("copyNote"),
  markReviewed: $("markReviewed"),
  aiEmpty: $("aiEmpty"),
  aiThread: $("aiThread"),
  askInput: $("askInput"),
  askSend: $("askSend"),
};

let DATA = null;
let encounters = [];
let selected = null;          // current encounter object
let recTimerId = null;
let recSeconds = 0;
const noteReady = new Set();  // MRNs with a generated note
const reviewed = new Set();

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const nowTime = () =>
  new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function todayLabel() {
  const d = new Date();
  const day = d.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `Today (${d.toLocaleDateString("en-US", { month: "short" })} ${day}${suffix})`;
}

/* ---------------- Worklist ---------------- */
function renderWorklist() {
  els.encList.innerHTML = "";
  if (!encounters.length) {
    els.encList.innerHTML = '<div class="enc-empty">Your worklist is empty.</div>';
    return;
  }
  for (const e of encounters) {
    const btn = document.createElement("button");
    btn.className =
      "enc" +
      (selected && selected.mrn === e.mrn ? " selected" : "") +
      (noteReady.has(e.mrn) ? " done" : "");
    btn.innerHTML = `
      <span class="enc-time">${esc(e.time)}</span>
      <span class="enc-main">
        <div class="enc-name">${esc(e.name)}</div>
        <div class="enc-meta">${esc(e.reason)} · ${esc(e.mrn)}</div>
      </span>
      <span class="enc-dot" title="Note ready"></span>`;
    btn.addEventListener("click", () => selectEncounter(e));
    els.encList.appendChild(btn);
  }
}

function selectEncounter(e) {
  selected = e;
  els.encTitle.disabled = false;
  els.encTitle.value = e.name;
  els.startBtn.disabled = false;
  els.genBtn.disabled = false;
  renderWorklist();
  if (noteReady.has(e.mrn)) {
    renderNote(e);
  } else {
    els.readyHeading.textContent = `Ready for ${e.name.split(" ")[0]}'s visit.`;
    els.readySub.textContent = `${e.reason} · scheduled ${e.time}. Start the visit to capture the conversation, or generate the note from the synthetic transcript.`;
    showState("ready");
    els.centerFoot.classList.remove("hidden");
  }
  NudgBus.emit(APP_ID, "encounter_selected", { mrn: e.mrn, name: e.name, reason: e.reason });
}

function addEncounter() {
  const name = window.prompt("Patient name for the new encounter:");
  if (!name || !name.trim()) return;
  const e = {
    mrn: "SYN-NEW" + String(Math.floor(1000 + Math.random() * 9000)),
    name: name.trim(),
    time: nowTime(),
    reason: "Added during demo",
    adhoc: true,
  };
  encounters.push(e);
  renderWorklist();
  NudgBus.emit(APP_ID, "encounter_added", { mrn: e.mrn, name: e.name });
  selectEncounter(e);
}

/* ---------------- Center states ---------------- */
function showState(name) {
  for (const [k, el] of Object.entries(els.states)) el.classList.toggle("hidden", k !== name);
}

/* ---------------- Recording ---------------- */
function fmtTimer(s) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function startRecording() {
  if (!selected) return;
  recSeconds = 0;
  els.recTimer.textContent = fmtTimer(0);
  els.railWork.classList.add("hidden");
  els.railRec.classList.remove("hidden");
  els.centerFoot.classList.add("hidden");
  showState("listening");
  recTimerId = setInterval(() => {
    recSeconds += 1;
    els.recTimer.textContent = fmtTimer(recSeconds);
  }, 1000);
  NudgBus.emit(APP_ID, "recording_started", { mrn: selected.mrn, name: selected.name });
}

function stopRecording() {
  clearInterval(recTimerId);
  recTimerId = null;
  els.railRec.classList.add("hidden");
  els.railWork.classList.remove("hidden");
  NudgBus.emit(APP_ID, "recording_stopped", { mrn: selected.mrn, seconds: recSeconds });
  draftNote(1800);
}

function draftNote(delayMs) {
  showState("drafting");
  els.centerFoot.classList.add("hidden");
  const patient = selected;
  setTimeout(() => {
    noteReady.add(patient.mrn);
    renderWorklist();
    renderNote(patient);
    NudgBus.emit(APP_ID, "note_generated", { mrn: patient.mrn, name: patient.name });
  }, delayMs);
}

/* ---------------- Note ---------------- */
function noteFor(p) {
  return (
    p.note || {
      cc: p.reason + ".",
      hpi: `${p.name} presents for ${p.reason.toLowerCase()}. This ad-hoc synthetic encounter has no scripted transcript, so the demo generates a placeholder narrative.`,
      ros: "Review of systems performed and negative except as above.",
      exam: "Focused examination performed; findings within normal limits for this synthetic encounter.",
      ap: ["Plan discussed with the patient; follow-up as needed. (Synthetic placeholder.)"],
    }
  );
}

function renderNote(p) {
  const n = noteFor(p);
  els.noteName.textContent = p.name;
  els.noteMeta.innerHTML =
    `${esc(p.reason)} · ${esc(p.time)} · MRN ${esc(p.mrn)} · Draft generated ${esc(nowTime())}` +
    (reviewed.has(p.mrn) ? ' · <span class="ok">Reviewed ✓</span>' : "");
  els.noteSections.innerHTML = `
    <h3>Chief Complaint</h3><p>${esc(n.cc)}</p>
    <h3>History of Present Illness</h3><p>${esc(n.hpi)}</p>
    <h3>Review of Systems</h3><p>${esc(n.ros)}</p>
    <h3>Physical Exam</h3><p>${esc(n.exam)}</p>
    <h3>Assessment &amp; Plan</h3><ol>${n.ap.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`;
  els.markReviewed.textContent = reviewed.has(p.mrn) ? "Reviewed ✓" : "Mark reviewed";
  els.markReviewed.disabled = reviewed.has(p.mrn);
  els.copyNote.textContent = "Copy note";
  showState("note");
  els.centerFoot.classList.add("hidden");
}

function notePlainText(p) {
  const n = noteFor(p);
  return [
    `${p.name} — ${p.reason} — ${new Date().toLocaleDateString("en-US")} (SYNTHETIC DEMO)`,
    "",
    "CHIEF COMPLAINT", n.cc, "",
    "HISTORY OF PRESENT ILLNESS", n.hpi, "",
    "REVIEW OF SYSTEMS", n.ros, "",
    "PHYSICAL EXAM", n.exam, "",
    "ASSESSMENT & PLAN",
    ...n.ap.map((x, i) => `${i + 1}. ${x}`),
  ].join("\n");
}

async function copyNote() {
  if (!selected) return;
  const text = notePlainText(selected);
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    ok = document.execCommand("copy");
    ta.remove();
  }
  els.copyNote.textContent = ok ? "Copied ✓" : "Copy failed";
  setTimeout(() => (els.copyNote.textContent = "Copy note"), 2200);
  NudgBus.emit(APP_ID, "note_copied", { mrn: selected.mrn, chars: text.length });
}

function markReviewed() {
  if (!selected) return;
  reviewed.add(selected.mrn);
  renderNote(selected);
  NudgBus.emit(APP_ID, "note_reviewed", { mrn: selected.mrn });
}

/* ---------------- Abridge AI panel ---------------- */
function threadVisible() {
  els.aiEmpty.classList.add("hidden");
  els.aiThread.classList.remove("hidden");
}

function addUserMsg(q) {
  threadVisible();
  const d = document.createElement("div");
  d.className = "msg-user";
  d.textContent = q;
  els.aiThread.appendChild(d);
  d.scrollIntoView({ block: "end" });
}

function addAiMsg(html) {
  const d = document.createElement("div");
  d.className = "msg-ai";
  d.innerHTML = html;
  els.aiThread.appendChild(d);
  d.scrollIntoView({ block: "end" });
  return d;
}

function matchAnswer(q) {
  const ql = q.toLowerCase();
  if (selected) {
    for (const item of selected.qa || []) {
      if (item.keys.some((k) => ql.includes(k))) return { a: item.a, sources: item.sources, matched: true };
    }
    return {
      a: selected.aiFallback ||
        `Grounded in the synthetic chart for ${selected.name}: ask about the visit's key problems, recent labs, or the drafted plan.`,
      sources: ["Visit + chart (synthetic)"],
      matched: false,
    };
  }
  return {
    a: "Select an encounter in the worklist and I'll ground answers in that visit's conversation and chart. (Synthetic demo.)",
    sources: ["Demo"],
    matched: false,
  };
}

function ask() {
  const q = els.askInput.value.trim();
  if (!q) return;
  els.askInput.value = "";
  els.askSend.disabled = true;
  autoGrow();
  addUserMsg(q);
  const typing = addAiMsg('<span class="typing"><i></i><i></i><i></i></span>');
  const ans = matchAnswer(q);
  NudgBus.emit(APP_ID, "ai_question_asked", { q, matched: ans.matched, mrn: selected ? selected.mrn : null });
  setTimeout(() => {
    typing.innerHTML =
      esc(ans.a) +
      `<div class="srcs">${ans.sources.map((s) => `<span class="src">${esc(s)}</span>`).join("")}</div>`;
    typing.scrollIntoView({ block: "end" });
  }, 900 + Math.random() * 600);
}

function autoGrow() {
  els.askInput.style.height = "auto";
  els.askInput.style.height = Math.min(els.askInput.scrollHeight, 96) + "px";
}

/* ---------------- Init ---------------- */
async function init() {
  els.todayLabel.textContent = todayLabel();
  const res = await fetch("/data/patients.json");
  DATA = await res.json();
  encounters = DATA.patients.map((p) => p);
  renderWorklist();

  els.addEnc.addEventListener("click", addEncounter);
  els.startBtn.addEventListener("click", startRecording);
  els.stopBtn.addEventListener("click", stopRecording);
  els.genBtn.addEventListener("click", () => selected && draftNote(700));
  els.copyNote.addEventListener("click", copyNote);
  els.markReviewed.addEventListener("click", markReviewed);
  els.askSend.addEventListener("click", ask);
  els.askInput.addEventListener("input", () => {
    els.askSend.disabled = !els.askInput.value.trim();
    autoGrow();
  });
  els.askInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      ask();
    }
  });

  NudgBus.emit(APP_ID, "app_loaded", { encounters: encounters.length });
}

init();
