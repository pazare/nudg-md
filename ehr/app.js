/* MediCore legacy EHR — synthetic demo logic. */
"use strict";
const APP_ID = "ehr";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let DATA = null;
let current = null; // open patient
let cart = [];      // pending orders
const sessionStart = Date.now();

const ORDER_CATALOG = {
  Laboratory: ["HbA1c", "Basic metabolic panel", "CBC with differential", "Lipid panel", "TSH", "Urine albumin/creatinine ratio"],
  Imaging: ["Chest X-ray PA/LAT", "Low-dose CT chest (lung ca screening)", "X-ray knee, bilateral standing"],
  Referral: ["Ophthalmology — diabetic eye exam", "Cardiology", "Pulmonology", "Nutrition services", "Gastroenterology — colonoscopy"],
  Immunization: ["Pneumococcal conjugate (PCV20)", "Influenza (seasonal)", "RSV vaccine"],
  Medication: ["— free-text in Comment —"],
};

function mcDate(d = new Date()) {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${d.getFullYear()}`;
}
function mcTime(d = new Date()) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function status(msg) {
  $("statusMsg").textContent = msg;
}
function store(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
}
function save(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

/* ---------------- Home: schedule + lookup ---------------- */
function renderSchedule() {
  const t = $("schedule");
  t.innerHTML =
    "<tr><th>Time</th><th>Patient</th><th>MRN</th><th>DOB</th><th>Reason for Visit</th><th>Status</th></tr>" +
    DATA.patients
      .map(
        (p) => `<tr class="click" data-mrn="${esc(p.mrn)}">
          <td>${esc(p.time)}</td><td>${esc(lastFirst(p.name))}</td><td>${esc(p.mrn)}</td>
          <td>${esc(p.dob)}</td><td>${esc(p.reason)}</td><td>${esc(p.status)}</td></tr>`
      )
      .join("");
  t.querySelectorAll("tr.click").forEach((r) =>
    r.addEventListener("click", () => openChart(r.dataset.mrn))
  );
}

function lastFirst(name) {
  const parts = name.split(" ");
  return (parts.pop().toUpperCase() + ", " + parts.join(" ")).trim();
}

function doSearch() {
  const mrn = $("qMrn").value.trim().toLowerCase();
  const nm = $("qName").value.trim().toLowerCase();
  const msg = $("searchMsg");
  const table = $("searchResults");
  if (!mrn && !nm) {
    msg.className = "mc-msg err";
    msg.textContent = "Enter an MRN or a last name.";
    table.classList.add("hidden");
    return;
  }
  const hits = DATA.patients.filter((p) => {
    const last = p.name.split(" ").pop().toLowerCase();
    return (mrn && p.mrn.toLowerCase().includes(mrn)) || (nm && last.startsWith(nm));
  });
  if (!hits.length) {
    msg.className = "mc-msg err";
    msg.textContent = "No records match the search criteria.";
    table.classList.add("hidden");
    return;
  }
  msg.className = "mc-msg";
  msg.textContent = `${hits.length} record(s) found.`;
  table.classList.remove("hidden");
  table.innerHTML =
    "<tr><th>Patient</th><th>MRN</th><th>DOB</th><th>Sex</th><th>PCP</th></tr>" +
    hits
      .map(
        (p) => `<tr class="click" data-mrn="${esc(p.mrn)}">
          <td>${esc(lastFirst(p.name))}</td><td>${esc(p.mrn)}</td><td>${esc(p.dob)}</td>
          <td>${esc(p.sex)}</td><td>${esc(p.pcp)}</td></tr>`
      )
      .join("");
  table.querySelectorAll("tr.click").forEach((r) =>
    r.addEventListener("click", () => openChart(r.dataset.mrn))
  );
}

/* ---------------- Chart ---------------- */
function openChart(mrn) {
  current = DATA.patients.find((p) => p.mrn === mrn);
  if (!current) return;
  cart = [];
  $("viewHome").classList.add("hidden");
  $("viewChart").classList.remove("hidden");
  $("pbName").textContent = `${lastFirst(current.name)}   (${current.age} yr ${current.sex})`;
  $("pbRow").innerHTML = `
    <td><b>MRN:</b> ${esc(current.mrn)}</td>
    <td><b>DOB:</b> ${esc(current.dob)}</td>
    <td><b>PCP:</b> ${esc(current.pcp)}</td>
    <td><b>Coverage:</b> ${esc(current.insurance)}</td>
    <td><b>Phone:</b> ${esc(current.phone)}</td>`;
  const al = current.allergies.map((a) => `${a.agent} (${a.reaction})`).join("; ");
  $("pbAllergy").textContent = "ALLERGIES: " + al;
  setTab("summary");
  status(`Chart opened: ${current.mrn} ${lastFirst(current.name)}`);
  NudgBus.emit(APP_ID, "ehr_patient_opened", { mrn: current.mrn, name: current.name });
}

function closeChart() {
  current = null;
  $("viewChart").classList.add("hidden");
  $("viewHome").classList.remove("hidden");
  status("Ready.");
}

function setTab(tab) {
  document.querySelectorAll("#chartTabs a").forEach((a) =>
    a.classList.toggle("active", a.dataset.tab === tab)
  );
  renderTab(tab);
  NudgBus.emit(APP_ID, "ehr_tab_viewed", { mrn: current.mrn, tab });
}

function grid(headers, rows) {
  return (
    `<table class="mc-grid"><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>` +
    rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") +
    "</table>"
  );
}

function renderTab(tab) {
  const p = current;
  const body = $("tabBody");
  if (tab === "summary") {
    const vit = p.vitals || {};
    body.innerHTML = `
      <div class="mc-cols">
        <div><h4>Active Problems</h4><ul class="mc-list">${p.problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div><h4>Current Medications</h4><ul class="mc-list">${p.meds.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>
      <h4>Most Recent Vitals</h4>
      ${grid(Object.keys(vit).map((k) => k.toUpperCase()), [Object.values(vit).map(esc)])}
      <h4 style="margin-top:12px">Most Recent Note</h4>
      ${p.priorNotes.length
        ? `<div class="mc-readbox">${esc(p.priorNotes[0].date)}  ${esc(p.priorNotes[0].type)}  (${esc(p.priorNotes[0].author)})\n\n${esc(p.priorNotes[0].preview)}</div>`
        : '<div class="mc-hint">No notes on file.</div>'}`;
  } else if (tab === "problems") {
    body.innerHTML = "<h4>Problem List</h4>" + grid(["#", "Problem", "Status"], p.problems.map((x, i) => [String(i + 1), esc(x), "Active"]));
  } else if (tab === "meds") {
    body.innerHTML = "<h4>Medication List</h4>" + grid(["#", "Medication / Sig", "Status"], p.meds.map((x, i) => [String(i + 1), esc(x), "Active"]));
  } else if (tab === "allergies") {
    body.innerHTML = "<h4>Allergies &amp; Intolerances</h4>" + grid(["Agent", "Reaction"], p.allergies.map((a) => [esc(a.agent), esc(a.reaction)]));
  } else if (tab === "labs") {
    body.innerHTML =
      "<h4>Laboratory Results</h4>" +
      (p.labs.length
        ? grid(
            ["Test", "Result", "Flag", "Reference", "Collected"],
            p.labs.map((l) => [
              esc(l.test),
              esc(l.result),
              l.flag ? `<span class="flag${esc(l.flag)}">${esc(l.flag)}</span>` : "",
              esc(l.ref),
              esc(l.date),
            ])
          )
        : '<div class="mc-hint">No results on file.</div>');
  } else if (tab === "notes") {
    renderNotesTab();
  } else if (tab === "orders") {
    renderOrdersTab();
  }
}

/* ---------------- Notes tab ---------------- */
function filedNotes() {
  return store("ehr_notes_" + current.mrn, []);
}

function renderNotesTab() {
  const filed = filedNotes();
  const all = [
    ...filed.map((n, i) => ({ ...n, _filedIdx: i })),
    ...current.priorNotes.map((n) => ({ ...n, status: "Signed" })),
  ];
  $("tabBody").innerHTML = `
    <h4>Documents on File</h4>
    ${all.length
      ? `<table class="mc-grid" id="noteRows"><tr><th>Date</th><th>Type</th><th>Author</th><th>Status</th></tr>${all
          .map(
            (n, i) => `<tr class="click" data-i="${i}"><td>${esc(n.date)}</td><td>${esc(n.type)}</td><td>${esc(n.author)}</td><td>${esc(n.status || "Signed")}</td></tr>`
          )
          .join("")}</table><div class="mc-hint">Click a row to read the document.</div><div id="noteRead"></div>`
      : '<div class="mc-hint">No documents on file.</div>'}
    <h4 style="margin-top:14px">New Note</h4>
    <table class="mc-form"><tr>
      <td>Type:</td>
      <td><select id="noteType"><option>Progress Note</option><option>Telephone Encounter</option><option>Result Letter</option><option>Addendum</option></select></td>
    </tr></table>
    <textarea id="noteText" rows="11" placeholder="Type or paste note text here..."></textarea>
    <div style="margin-top:6px">
      <button id="btnDraft">Save Draft</button>
      <button id="btnFile">File Note</button>
      <span class="mc-msg" id="noteMsg"></span>
    </div>`;

  const drafts = store("ehr_draft_" + current.mrn, "");
  if (drafts) $("noteText").value = drafts;

  document.querySelectorAll("#noteRows tr.click").forEach((r) =>
    r.addEventListener("click", () => {
      const n = all[Number(r.dataset.i)];
      $("noteRead").innerHTML = `<div class="mc-readbox">${esc(n.date)}  ${esc(n.type)}  (${esc(n.author)})\n\n${esc(n.text || n.preview)}</div>`;
    })
  );
  $("btnDraft").addEventListener("click", () => {
    save("ehr_draft_" + current.mrn, $("noteText").value);
    flash("noteMsg", "Draft saved locally.", "ok");
  });
  $("btnFile").addEventListener("click", fileNote);
}

function flash(id, text, cls) {
  const el = $(id);
  el.textContent = text;
  el.className = "mc-msg " + (cls || "");
}

function fileNote() {
  const text = $("noteText").value.trim();
  const type = $("noteType").value;
  if (!text) {
    flash("noteMsg", "Note text is required.", "err");
    return;
  }
  if (!window.confirm(`File this ${type} to the chart for ${lastFirst(current.name)}?`)) return;
  const filed = filedNotes();
  filed.unshift({ date: mcDate(), type, author: "RIVERA.A", status: "Filed " + mcTime(), text });
  save("ehr_notes_" + current.mrn, filed);
  save("ehr_draft_" + current.mrn, "");
  NudgBus.emit(APP_ID, "ehr_note_filed", { mrn: current.mrn, type, chars: text.length });
  status(`Note filed ${mcDate()} ${mcTime()} by RIVERA.A`);
  renderNotesTab();
  flash("noteMsg", `Note filed ${mcDate()} ${mcTime()} by RIVERA.A.`, "ok");
}

/* ---------------- Orders tab ---------------- */
function signedOrders() {
  return store("ehr_orders_" + current.mrn, []);
}

function renderOrdersTab() {
  const signed = signedOrders();
  $("tabBody").innerHTML = `
    <h4>New Order</h4>
    <table class="mc-form">
      <tr>
        <td>Category:</td>
        <td><select id="ordCat">${Object.keys(ORDER_CATALOG).map((c) => `<option>${c}</option>`).join("")}</select></td>
        <td>Order:</td>
        <td><select id="ordItem"></select></td>
      </tr>
      <tr>
        <td>Priority:</td>
        <td><label><input type="radio" name="ordPri" value="Routine" checked> Routine</label>
            <label><input type="radio" name="ordPri" value="STAT"> STAT</label></td>
        <td>Comment/Dx:</td>
        <td><input id="ordDx" size="28" placeholder="e.g. E11.9"></td>
      </tr>
    </table>
    <div style="margin-top:6px"><button id="btnAddOrd">Add to Order Cart</button> <span class="mc-msg" id="ordMsg"></span></div>
    <h4 style="margin-top:14px">Order Cart (${cart.length})</h4>
    <div id="cartArea"></div>
    <h4 style="margin-top:14px">Signed Orders</h4>
    ${signed.length
      ? grid(["Date", "Order", "Category", "Priority", "Comment", "Status"],
          signed.map((o) => [esc(o.date), esc(o.item), esc(o.cat), esc(o.pri), esc(o.dx || "—"), esc(o.status)]))
      : '<div class="mc-hint">No signed orders on file.</div>'}`;

  const catSel = $("ordCat");
  const itemSel = $("ordItem");
  const fillItems = () => {
    itemSel.innerHTML = ORDER_CATALOG[catSel.value].map((o) => `<option>${o}</option>`).join("");
  };
  fillItems();
  catSel.addEventListener("change", fillItems);
  $("btnAddOrd").addEventListener("click", () => {
    cart.push({
      cat: catSel.value,
      item: itemSel.value,
      pri: document.querySelector('input[name="ordPri"]:checked').value,
      dx: $("ordDx").value.trim(),
    });
    renderOrdersTab();
  });
  renderCart();
}

function renderCart() {
  const area = $("cartArea");
  if (!cart.length) {
    area.innerHTML = '<div class="mc-hint">Cart is empty. Add orders above, then sign.</div>';
    return;
  }
  area.innerHTML =
    grid(
      ["Order", "Category", "Priority", "Comment", ""],
      cart.map((o, i) => [esc(o.item), esc(o.cat), esc(o.pri), esc(o.dx || "—"), `<a href="#" data-rm="${i}">Remove</a>`])
    ) + `<div style="margin-top:6px"><button id="btnSign">Sign Orders (${cart.length})</button></div>`;
  area.querySelectorAll("a[data-rm]").forEach((a) =>
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      cart.splice(Number(a.dataset.rm), 1);
      renderOrdersTab();
    })
  );
  $("btnSign").addEventListener("click", () => {
    if (!window.confirm(`Sign and transmit ${cart.length} order(s) for ${lastFirst(current.name)}?`)) return;
    const signed = signedOrders();
    for (const o of cart) signed.unshift({ ...o, date: mcDate(), status: "Signed " + mcTime() });
    save("ehr_orders_" + current.mrn, signed);
    NudgBus.emit(APP_ID, "ehr_orders_signed", { mrn: current.mrn, count: cart.length, items: cart.map((o) => o.item) });
    status(`${cart.length} order(s) signed and transmitted.`);
    window.alert(`${cart.length} order(s) signed and transmitted to the receiving department.`);
    cart = [];
    renderOrdersTab();
  });
}

/* ---------------- Init ---------------- */
async function init() {
  $("mcDate").textContent = mcDate();
  $("schedLegend").textContent = `Today's Schedule — RIVERA.A — ${mcDate()}`;
  const res = await fetch("/data/patients.json");
  DATA = await res.json();
  renderSchedule();

  $("btnSearch").addEventListener("click", doSearch);
  $("btnClear").addEventListener("click", () => {
    $("qMrn").value = "";
    $("qName").value = "";
    $("searchMsg").textContent = "";
    $("searchResults").classList.add("hidden");
  });
  [$("qMrn"), $("qName")].forEach((i) =>
    i.addEventListener("keydown", (ev) => ev.key === "Enter" && doSearch())
  );
  $("backHome").addEventListener("click", (ev) => {
    ev.preventDefault();
    closeChart();
  });
  $("logoff").addEventListener("click", (ev) => {
    ev.preventDefault();
    window.alert("Log Off is disabled in the synthetic training environment.");
  });
  document.querySelectorAll("#chartTabs a").forEach((a) =>
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      setTab(a.dataset.tab);
    })
  );

  setInterval(() => {
    const s = Math.floor((Date.now() - sessionStart) / 1000);
    $("sessClock").textContent = `Session: ${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);

  NudgBus.emit(APP_ID, "app_loaded", { patients: DATA.patients.length });
}

init();
