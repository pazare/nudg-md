import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const patients = JSON.parse(read("data/patients.json"));
const gallery = read("design/cards.html");
const titleCard = read("card/index.html");
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
const handoffQueueBlock = nudges.slice(nudges.indexOf("function queueEhrCommand"), nudges.indexOf("function runAction"));
const openRhythmBlock = nudges.slice(nudges.indexOf('if (actionId === "open_rhythm")'), nudges.indexOf('} else if (actionId === "show_me")'));
const ehrAckBlock = nudges.slice(nudges.indexOf('case "ehr_command_ack"'), nudges.indexOf('case "demo_reset"'));

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
assert.ok(!gallery.includes("Nothing here is wired yet"), "gallery status must distinguish the live subset from illustrative states");
assert.ok(gallery.includes("no deadline monitor"), "gallery WATCH state must label its unimplemented monitor locally");
assert.ok(!gallery.includes("replay: verify"), "design artifact must not show a fake replay command");
assert.ok(titleCard.includes("We give AI bounded work") && titleCard.includes("Deterministic core") && titleCard.includes("Labeled AI lanes"), "title card must distinguish product ambition from the deterministic demo core");
assert.ok(!titleCard.includes("The AI does the legwork") && !titleCard.includes("Every commit public"), "title card must not imply the deterministic recording path is live AI or that uncommitted demo code is public");

assert.ok(scribe.includes("els.states.note.dataset.mrn = p.mrn"), "rendered note must expose its bound MRN");
assert.ok(scribe.includes("els.aiThread.dataset.mrn = selected.mrn"), "assistant thread must expose its bound MRN");
assert.ok(bus.includes("detail: sanitizedDetail(detail)"), "bus must sanitize details before live fanout or persistence");
for (const field of ["q", "text", "note"]) {
  assert.ok(bus.includes(`delete safe.${field}`), `bus transport must strip raw ${field} fields`);
}
assert.ok(scribe.includes('signalTimer = null; lastSignals = "";'), "Reset must let derived note signals fire again");
assert.ok(buddy.includes("cardsEl.scrollTop = 0"), "the buddy must reopen at the newest nudge instead of a stale scroll position");
assert.ok(buddy.includes('id="nudgAnnounce"') && buddy.includes("announceNudge"), "new nudges must be announced outside the hidden popover for screen-reader users");
assert.ok(buddy.includes('nudgeCount === 1 ? "nudge" : "nudges"'), "both buddy triggers must expose the actionable nudge count in their accessible name");
assert.ok(buddy.includes('orb.addEventListener("click"') && buddy.includes("e.detail !== 0") && buddy.includes("popOpen ? closePop() : openPop(orb)"), "the default dock buddy must honor native keyboard and assistive-technology activation without double-toggling pointer clicks");
assert.ok(!buddy.includes("renderBadges();\n      bloom();"), "ordinary activity must not animate like an actionable nudge");
assert.ok(buddyCss.includes("max-height: calc(100vh - 24px)"), "the popover must stay within short viewports");
assert.ok(ehr.indexOf('NudgBus.emit(APP_ID, "ehr_patient_opened"') < ehr.indexOf('setTab("summary")'), "EHR open event must precede tab event");
assert.ok(ehr.indexOf("if (noteMrn !== current.mrn.toUpperCase())") < ehr.indexOf("window.confirm"), "wrong-chart note must be blocked before confirmation");
assert.ok(nudges.includes('save(PENDING_EHR_COMMAND_KEY'), "cross-tab navigation must survive creation of a previously closed EHR tab");
assert.ok(openRhythmBlock.indexOf("openEhrTarget()") < openRhythmBlock.indexOf('NudgBus.emit("buddy", "nudg_cmd"'), "the target tab must be resolved before any broadcast can let an unrelated EHR consume the handoff");
assert.ok(openRhythmBlock.includes("target && target.existing") && openRhythmBlock.includes("target.handle.location = \"/ehr/\"") && openRhythmBlock.includes("do not broadcast to old EHRs"), "new and existing EHR targets must use separate live versus persisted handoff paths");
assert.ok(ehr.includes("consumePendingEhrCommand();"), "a newly opened EHR must consume the short-lived pending command after data loads");
assert.ok(ehr.includes("window.__nudgEhrReady = true") && ehr.includes("targetEhrInstanceId !== EHR_INSTANCE_ID"), "live EHR handoffs must wait for readiness and target only the resolved tab instance");
assert.ok(ehr.includes('"ehr_command_ack"'), "the EHR must acknowledge the document handoff after the row opens");
assert.ok(nudges.includes('case "ehr_command_ack"'), "the originating nudge must wait for the EHR acknowledgement");
assert.match(handoffQueueBlock, /if \(pendingHandoff && pendingHandoff\.commandId === command\.commandId\) \{[\s\S]*?pendingHandoff = null;/, "handoff TTL cleanup must clear matching in-memory state");
assert.ok(ehrAckBlock.indexOf("Date.now() > pendingHandoff.expiresAt") >= 0 && ehrAckBlock.indexOf("Date.now() > pendingHandoff.expiresAt") < ehrAckBlock.indexOf("removeCard(pendingHandoff.cardId"), "late EHR acknowledgements must be rejected before card removal");
assert.ok(nudges.includes("The nudge is still here so you can retry"), "failed handoffs must retain a visible retry path");
assert.ok(ehr.includes("localStorage.removeItem(PENDING_EHR_COMMAND_KEY)"), "EHR reset/consumption must clear stale pending handoffs");
assert.ok(scribe.includes("localStorage.removeItem(PENDING_EHR_COMMAND_KEY)"), "Scribe reset must clear stale pending handoffs");
assert.ok(nudges.includes('!["open_rhythm", "second_opinion"].includes(actionId)'), "opening a nonterminal second-opinion view must not be logged as a completed nudge action");
assert.ok(buddy.includes("ACTION_LABELS[d.action]"), "activity must translate internal action codes into clinician-facing language");
assert.ok(nudges.includes('status: "simulated_sent"') && nudges.includes("const followUpReview = referral?.status === \"simulated_sent\""), "a completed referral workflow must return only as an explicit second-opinion follow-up");
assert.ok(nudges.includes('cards.has(`r12:${mrn}`)') && nudges.includes('cards.has(`r04:${mrn}`)'), "depth must not stack on unresolved WATCH or navigation cards");
assert.ok(nudges.includes("peekEl.hidden = true") && nudges.includes("el.hidden = false"), "hidden peek controls must leave the accessibility tree until the peek is shown again");
assert.ok(nudges.includes("NudgBuddy.announceNudge(card.headline)"), "active-patient nudge commits must use the screen-reader announcer");
assert.ok(nudges.includes("SCRIPTED: QUICK LANE UNAVAILABLE") && nudges.includes("SCRIPTED: PANEL LANE UNAVAILABLE"), "scripted fallbacks must identify the unavailable lane without denying a different live lane");
assert.ok(nudges.includes('d.origin === INSTANCE_ID'), "same-tab nudge actions must not delete their own nonterminal cards");
assert.ok(nudges.includes('const visibleCards = activeMrn'), "cards must remain hidden when no patient context is active");
assert.ok(nudges.includes('tabViews.set(d.mrn, [])'), "opening a chart must clear stale wayfinding history");
assert.ok(nudges.includes("const distinctTabs = new Set") && nudges.includes("distinctTabs.size < R04_MIN_TABS"), "R-04 must require distinct chart tabs rather than repeated clicks on one tab");
assert.ok(nudges.includes("Math.min((c[id] && c[id].level ? c[id].level : 0) + 1, 3)"), "dismissal cooldown must cap at the documented 24/48/72-hour ladder");
assert.ok(nudges.includes('reason: "chart_closed"'), "closing a chart must supersede its stale NOW wayfinding card");
assert.ok(nudges.includes('if (APP === "scribe") evalR01'), "R-01 must have one owning runtime to avoid duplicate commits");
assert.ok(nudges.includes('if (APP !== "ehr") break;'), "EHR rules must have one owning runtime to avoid duplicate commits");
assert.ok(nudges.includes('fetch(RELAY + "/api/cancel"'), "lane changes must request server-side cancellation");
assert.ok(nudges.includes('window.addEventListener("nudg:buddy-closed"'), "closing the buddy must cancel hidden deliberation");
assert.ok(nudges.includes('requests > 0\n        ? `UNDERDETERMINED'), "any seat requesting missing data must keep the aggregate underdetermined");
assert.ok(nudges.includes("card.research.supporting"), "depth cards must render the supporting-source disclosure");
assert.ok(nudges.includes("card.research.honesty"), "depth cards must render the evidence-limit disclosure");
assert.ok(!nudges.includes("Friday, Jul 25"), "2026-07-25 must not be labeled Friday");
assert.ok(!nudges.includes("this card returns and escalates"), "runtime WATCH copy must not claim an unimplemented deadline monitor");
assert.ok(!nudges.includes("1st time shown"), "card traces must not hard-code a false display count");
assert.ok(!nudges.includes("Later today"), "dismissal reasons must not promise a same-day snooze when the runtime applies a 24-hour minimum cooldown");
assert.ok(nudges.indexOf('data-panel-agg') < nudges.indexOf('data-panel-seats'), "the panel verdict must appear before seat detail");
assert.ok(relay.includes("self.require_allowed_origin()"), "relay POSTs must reject untrusted origins and content types");
assert.ok(relay.includes('[codex, "login", "status"]'), "relay health must verify Codex authentication, not only binary presence");
assert.ok(relay.includes('"not logged in" not in output'), "relay health must reject an explicit logged-out status even if the CLI exits zero");
assert.ok(relay.includes("if invalid_count:") && relay.includes('failed_seats=invalid_count'), "an incomplete live panel must fail closed to the labeled scripted set");
assert.ok(relay.includes("json.loads(raw.strip())") && relay.includes('set(obj) == {"stance", "rationale", "requests"}'), "live panel seats must satisfy the exact strict-JSON response schema");
assert.ok(relay.includes("def valid_quick_reply(text):") && relay.includes('lines[-1].startswith("Basis: ")'), "live quick replies must satisfy the promised word and grounding-line contract");
assert.ok(relay.includes('elif self.path == "/api/cancel"'), "relay must implement the client cancellation endpoint");
assert.ok(relay.includes("stop_process_group(proc)"), "relay cancellation must terminate Codex child processes");
assert.ok(relay.includes("env=codex_subprocess_env()") && relay.includes("CODEX_ENV_ALLOWLIST"), "prompt-bearing Codex children must not inherit API keys or unrelated process secrets");
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
  if (item.quality_grade === "U") {
    for (const key of ["effect_size_or_number_with_n_N", "source", "year", "doi_or_url", "study_type", "exact_quotable_line_le_25_words"]) {
      assert.equal(item[key], "UNVERIFIED", `${item.id}: every unverifiable evidence field must fail closed`);
    }
  } else {
    assert.equal(typeof item.year, "number", `${item.id}: verified records must retain a numeric publication year`);
  }
}

assert.equal(oncologyDraft.depthPack, undefined, "oncology draft must itself be a depthPack-compatible template, not a wrapper");
for (const key of ["trigger", "headline", "gap", "question", "research", "specialists", "quickScripted", "seats"]) {
  assert.ok(oncologyDraft[key], `oncology draft must expose depthPack.${key} at top level`);
}
for (const patient of patients.patients.filter((item) => item.depthPack)) {
  assert.ok(patient.depthPack.trigger, `${patient.name}: a live depthPack must name its chart-verifiable trigger`);
}
const holloway = patients.patients.find((item) => item.name === "Margaret Holloway");
assert.ok(holloway?.depthPack?.followUpQuestion && holloway.depthPack.followUpSeats?.length === 4, "post-send second opinion must use a follow-up question and matching seats");
assert.ok(nudges.includes("referralWorkflow") && nudges.includes("deadlineMonitor: \"not_implemented\""), "live follow-up lanes must receive the bounded simulated-referral state and monitor limit");
assert.equal(oncologyDraft.seats.find((seat) => seat.id === "rd")?.stance, "insufficient", "a seat requesting missing screening data cannot report support");
assert.ok(oncologyDraft.research.note.includes("Confirm stage"), "ASCO applicability must require stage and appetite confirmation");
assert.ok(oncologyDraft.research.honesty.includes("cannot establish the evidence gap"), "NUT-09 must not be transferred from colon/FOLFOX to vaginal cancer");
assert.ok(!oncologyDraft.quickScripted.includes("weight and intake deterioration"), "oncology draft must not invent undocumented intake deterioration");
for (const field of [oncologyDraft.trigger, oncologyDraft.headline, oncologyDraft.gap, oncologyDraft.quickScripted, ...oncologyDraft.seats.flatMap((seat) => [seat.rationale, seat.requests || ""])]) {
  assert.ok(field.includes("TEMPLATE-ONLY") || field.includes("Bind "), "case-specific oncology decision fields must remain visibly gated until chart facts are bound");
}
assert.ok(nudges.includes("no observed derived note signal confirms it was addressed"), "R-09 trace must describe an observed-signal gap, not claim an unobserved plan omission");
const renderedOncologyEvidence = [
  oncologyDraft.research.title, oncologyDraft.research.cite,
  oncologyDraft.research.supporting?.title, oncologyDraft.research.supporting?.cite,
].filter(Boolean).join(" ");
for (const item of evidence.filter((entry) => entry.quality_grade === "U")) {
  assert.ok(!renderedOncologyEvidence.includes(item.id), `${item.id}: unverified claims must not render as supporting evidence`);
}
assert.ok(!/\bgrade [ABC]\b/i.test(renderedOncologyEvidence), "clinical source rows must not expose internal tiers as evidence grades");
assert.ok(evidence.find((item) => item.id === "NUT-02")?.population.includes("outpatients"), "NUT-02 must retain its outpatient scope");
assert.ok(evidence.find((item) => item.id === "NUT-05")?.population.includes("Postoperative"), "NUT-05 must retain its postoperative scope");
assert.ok(evidence.find((item) => item.id === "TIME-01")?.population.includes("Cerner Millennium"), "TIME-01 must retain its vendor and practice scope");
assert.ok(evidence.find((item) => item.id === "TIME-06")?.population.includes("gastroenterology"), "TIME-06 must retain its specialty and referral-packet scope");
assert.ok(docs.includes("source-type tiers"), "public design docs must distinguish internal evidence tiers from formal GRADE certainty");
assert.ok(docs.includes("does not run a deadline/result monitor"), "public docs must disclose the WATCH runtime boundary");

console.log(`Checks passed: ${patients.patients.length} patient ages, ${datedLabels} weekday labels, and critical static safety contracts.`);
