import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const patients = JSON.parse(read("data/patients.json"));
const gallery = read("design/cards.html");
const scribe = read("scribe/app.js");
const ehr = read("ehr/app.js");
const bus = read("shared/bus.js");
const docs = [read("README.md"), read("docs/CONTEXT.md"), read("docs/design/NUDGE_CARDS_DESIGN.md")].join("\n");

function ageOn(dob, asOf) {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ay, am, ad] = asOf.split("-").map(Number);
  return ay - by - (am < bm || (am === bm && ad < bd) ? 1 : 0);
}

for (const patient of patients.patients) {
  const expected = ageOn(patient.dob, patients.meta.generated);
  assert.equal(patient.age, expected, `${patient.name}: stored age must match DOB on ${patients.meta.generated}`);
  const narrative = [patient.note?.hpi, patient.aiFallback, ...(patient.qa || []).map((item) => item.a)]
    .filter(Boolean)
    .join(" ");
  for (const match of narrative.matchAll(/\b(\d{1,3})-year-old\b/g)) {
    assert.equal(Number(match[1]), expected, `${patient.name}: narrative age must match computed age`);
  }
}

let datedLabels = 0;
for (const match of gallery.matchAll(/<time datetime="(\d{4}-\d{2}-\d{2})">([^<]+)<\/time>/g)) {
  const date = new Date(`${match[1]}T00:00:00Z`);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
  const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
  assert.equal(match[2], `${weekday} ${monthDay}`, `${match[1]}: visible weekday must match the ISO date`);
  datedLabels += 1;
}
assert.equal(datedLabels, 3, "gallery must expose all three exact dates as machine-readable time elements");

assert.ok(gallery.includes("UNDERDETERMINED"), "panel must expose its refusal result");
assert.ok(!gallery.includes("Panel Support 3/4"), "panel must not report consensus while required data are missing");
assert.ok(gallery.includes('id="laneQuick" role="tab" aria-selected="true"'), "Quick take must be the default tab");
assert.ok(gallery.includes('role="tablist"'), "lane selector must expose tab semantics");
assert.ok(gallery.includes("ILLUSTRATIVE RECEIPT SCHEMA — NO RUNTIME RUN CREATED"), "mock receipt must be labeled locally");
assert.ok(gallery.includes("10.1016/j.clnu.2021.02.005"), "research row must name its specific source");
assert.ok(!gallery.includes("replay: verify"), "design artifact must not show a fake replay command");

assert.ok(scribe.includes("els.states.note.dataset.mrn = p.mrn"), "rendered note must expose its bound MRN");
assert.ok(scribe.includes("els.aiThread.dataset.mrn = selected.mrn"), "assistant thread must expose its bound MRN");
assert.ok(!bus.includes("detail: { q:"), "event log must not persist raw assistant questions");
for (const field of ["q", "text", "note"]) {
  assert.ok(bus.includes(`delete detail.${field}`), `bus history must strip raw ${field} fields`);
}
assert.ok(ehr.indexOf('NudgBus.emit(APP_ID, "ehr_patient_opened"') < ehr.indexOf('setTab("summary")'), "EHR open event must precede tab event");
assert.ok(ehr.indexOf("if (noteMrn !== current.mrn.toUpperCase())") < ehr.indexOf("window.confirm"), "wrong-chart note must be blocked before confirmation");
assert.ok(!docs.includes("MediCore"), "public documentation must use the explicitly fictional LegacyChart name");

console.log(`Checks passed: ${patients.patients.length} patient ages, ${datedLabels} weekday labels, and critical static safety contracts.`);
