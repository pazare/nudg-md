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
const buddy = read("shared/buddy.js");
const buddyCss = read("shared/buddy.css");
const nudges = read("shared/nudges.js");
const relay = read("server/relay.py");
const serve = read("scripts/serve.sh");
const evidence = JSON.parse(read("data/evidence.json"));
const oncologyDraft = JSON.parse(read("data/depthpack-oncology-draft.json"));
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
assert.ok(gallery.includes('href="https://pubmed.ncbi.nlm.nih.gov/33946039/"'), "gallery research citation must be directly openable");
assert.ok(!gallery.includes("guideline slot"), "gallery must not show placeholder source copy");
assert.ok(!gallery.includes("replay: verify"), "design artifact must not show a fake replay command");

assert.ok(scribe.includes("els.states.note.dataset.mrn = p.mrn"), "rendered note must expose its bound MRN");
assert.ok(scribe.includes("els.aiThread.dataset.mrn = selected.mrn"), "assistant thread must expose its bound MRN");
assert.ok(bus.includes("detail: sanitizedDetail(detail)"), "bus must sanitize details before live fanout or persistence");
for (const field of ["q", "text", "note"]) {
  assert.ok(bus.includes(`delete safe.${field}`), `bus transport must strip raw ${field} fields`);
}
assert.ok(scribe.includes('signalTimer = null; lastSignals = "";'), "Reset must let derived note signals fire again");
assert.ok(buddy.includes("cardsEl.scrollTop = 0"), "the buddy must reopen at the newest nudge instead of a stale scroll position");
assert.ok(!buddy.includes("renderBadges();\n      bloom();"), "ordinary activity must not animate like an actionable nudge");
assert.ok(buddyCss.includes("max-height: calc(100vh - 24px)"), "the popover must stay within short viewports");
assert.ok(ehr.indexOf('NudgBus.emit(APP_ID, "ehr_patient_opened"') < ehr.indexOf('setTab("summary")'), "EHR open event must precede tab event");
assert.ok(ehr.indexOf("if (noteMrn !== current.mrn.toUpperCase())") < ehr.indexOf("window.confirm"), "wrong-chart note must be blocked before confirmation");
assert.ok(nudges.includes('d.origin === INSTANCE_ID'), "same-tab nudge actions must not delete their own nonterminal cards");
assert.ok(nudges.includes('const visibleCards = activeMrn'), "cards must remain hidden when no patient context is active");
assert.ok(nudges.includes('tabViews.set(d.mrn, [])'), "opening a chart must clear stale wayfinding history");
assert.ok(nudges.includes('reason: "chart_closed"'), "closing a chart must supersede its stale NOW wayfinding card");
assert.ok(nudges.includes('if (APP === "scribe") evalR01'), "R-01 must have one owning runtime to avoid duplicate commits");
assert.ok(nudges.includes('if (APP !== "ehr") break;'), "EHR rules must have one owning runtime to avoid duplicate commits");
assert.ok(nudges.includes('fetch(RELAY + "/api/cancel"'), "lane changes must request server-side cancellation");
assert.ok(nudges.includes('window.addEventListener("nudg:buddy-closed"'), "closing the buddy must cancel hidden deliberation");
assert.ok(nudges.includes('requests > 0\n        ? `UNDERDETERMINED'), "any seat requesting missing data must keep the aggregate underdetermined");
assert.ok(nudges.includes("card.research.supporting"), "depth cards must render the supporting-source disclosure");
assert.ok(nudges.includes("card.research.honesty"), "depth cards must render the evidence-limit disclosure");
assert.ok(!nudges.includes("Friday, Jul 25"), "2026-07-25 must not be labeled Friday");
assert.ok(!nudges.includes("1st time shown"), "card traces must not hard-code a false display count");
assert.ok(nudges.indexOf('data-panel-agg') < nudges.indexOf('data-panel-seats'), "the panel verdict must appear before seat detail");
assert.ok(relay.includes("self.require_allowed_origin()"), "relay POSTs must reject untrusted origins and content types");
assert.ok(relay.includes('elif self.path == "/api/cancel"'), "relay must implement the client cancellation endpoint");
assert.ok(relay.includes("stop_process_group(proc)"), "relay cancellation must terminate Codex child processes");
assert.ok(relay.includes("stop_all_process_groups()"), "relay shutdown must terminate every active Codex child");
assert.ok(relay.includes('raise RelayError(499, "run cancelled")'), "cancelled work must not be reported as a successful live result");
assert.ok(relay.includes('self.send_header("Connection", "close")'), "early POST rejection must not leave an unread body on a reusable connection");
assert.ok(serve.includes('relay_port="4809"'), "the integrated launcher must use the browser client\'s fixed relay port");
assert.ok(serve.includes('custom NUDG_RELAY_PORT values are test-only'), "the launcher must reject a relay port the browser cannot reach");
assert.ok(!docs.includes("MediCore"), "public documentation must use the explicitly fictional LegacyChart name");
assert.ok(!docs.includes("oncology pack pending supplied research"), "docs must not say the committed evidence pack is still pending");
assert.ok(!docs.includes("remains blocked on Pablo's research"), "docs must distinguish the landed evidence template from pending runtime integration");

const evidenceKeys = [
  "claim", "doi_or_url", "effect_size_or_number_with_n_N", "exact_quotable_line_le_25_words", "id",
  "population", "quality_grade", "source", "study_type", "year",
].sort();
assert.equal(evidence.length, 36, "evidence registry must retain all 36 claims");
assert.equal(new Set(evidence.map((item) => item.id)).size, evidence.length, "evidence ids must be unique");
for (const item of evidence) {
  assert.deepEqual(Object.keys(item).sort(), evidenceKeys, `${item.id}: evidence record must keep the exact schema`);
  assert.ok(Object.values(item).every((value) => value !== "" && value !== null), `${item.id}: evidence fields must be populated`);
  assert.ok(["A", "B", "C", "U"].includes(item.quality_grade), `${item.id}: evidence grade must be recognized`);
  const quoteWords = item.exact_quotable_line_le_25_words.trim().split(/\s+/).filter(Boolean).length;
  assert.ok(quoteWords <= 25, `${item.id}: exact quote must remain at or below 25 words`);
}

assert.equal(oncologyDraft.depthPack, undefined, "oncology draft must itself be a depthPack-compatible template, not a wrapper");
for (const key of ["headline", "gap", "question", "research", "specialists", "quickScripted", "seats"]) {
  assert.ok(oncologyDraft[key], `oncology draft must expose depthPack.${key} at top level`);
}
assert.equal(oncologyDraft.seats.find((seat) => seat.id === "rd")?.stance, "insufficient", "a seat requesting missing screening data cannot report support");
assert.ok(oncologyDraft.research.note.includes("Confirm stage"), "ASCO applicability must require stage and appetite confirmation");
assert.ok(oncologyDraft.research.honesty.includes("cannot establish the evidence gap"), "NUT-09 must not be transferred from colon/FOLFOX to vaginal cancer");
assert.ok(!oncologyDraft.quickScripted.includes("weight and intake deterioration"), "oncology draft must not invent undocumented intake deterioration");

console.log(`Checks passed: ${patients.patients.length} patient ages, ${datedLabels} weekday labels, and critical static safety contracts.`);
