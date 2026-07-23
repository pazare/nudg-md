# Nudge card design — NUDG MD

Design artifact for validation round 2 (2026-07-18). Live gallery: [`/design/cards.html`](../../design/cards.html) — open at `http://localhost:4800/design/cards.html`.
Scope: **gallery/design reference**. The gallery contains illustrative scripted content and is not a runtime result. Separate live apps implement a bounded subset of triggers and optional model lanes; gallery controls do not prove those runtime paths.

---

## 1 · Design principles

1. **Specific-or-silent.** A nudge must name this patient, this moment, and an exact chart datum. If it can't, it stays silent. The empty state says so.
2. **Glanceable, then rigorous.** Headline carries the whole point in ≤ 90 characters; evidence, math, and provenance are one click deeper (progressive disclosure). Non-technical surface, rigorous interior.
3. **Calm by default.** A small active-patient stack sits behind a count. No sound, no motion loops, one arrival pulse of the dock badge. Never modal, never steals focus, never blocks typing.
4. **Traceable.** Every card shows "Why this, why now": triggering event + rule id + sources. The current runtime stores global shown/evaluated counts; per-rule and suppressed-nudge accounting remain evaluation work.
5. **The clinician decides.** Cards suggest; humans act. Every action is explicit; nothing is ordered, sent, or filed by the buddy. Outcomes (acted / dismissed / expired) are logged to the same bus.
6. **Respect dismissal.** A dismissed card cools down for 24 hours, then 48, then 72 in the current demo. Repeats without new evidence are a design failure; an evidence-threshold escalation is not implemented.
7. **Tempo-stamped.** Every card carries its tempo mode (NOW / FOCUSED / DEEP / WATCH) with a mode-specific cadence contract (§4).
8. **Honest.** SYNTHETIC banner on every surface; scripted vs live-model content labeled; every number carries its assumptions; limits are EXHAUSTED (actually hit) or HYPOTHESIZED (labeled so).

## 2 · Card anatomy

```
┌──────────────────────────────────────────────┐
│ ●type-chip  TEMPO-chip        patient-chip   │  ← context row (who + what kind + cadence)
│ Headline — the entire point in one line.     │  ← ≤90 chars, formal, verb-forward
│ ▸ evidence bullet…            [source chip]  │  ← 2–4 bullets max, each with provenance
│ ▸ evidence bullet…            [source chip]  │
│ [Primary action] [Secondary] [Dismiss ▾]     │  ← explicit verbs; dismiss collects a reason
│ Why this, why now · R-xx · 1st time · mode   │  ← trace row (tap to expand full trace)
└──────────────────────────────────────────────┘
```

- Width 320 px in the dock popover (grows to 560 px only for the second-opinion panel).
- Left border 3 px in type accent; white surface on cream; radius 14; hairline #e2ddd2.
- Patient chip always present (name · MRN) — a nudge about nobody is not a nudge.
- Dismiss is a menu, not a button: *Not relevant here* / *Already considered* / *Not now*. Each maps to a recorded outcome and the current time-based cooldown; none promises a same-day snooze.

## 3 · Type system

| Type | Accent | Contents |
| --- | --- | --- |
| Chart check | amber #b3701f | a new impression conflicts with current/prior chart facts (Scenario 1) |
| Navigate | blue #2b5fd9 | step path to buried information; "Show me" spotlight (Scenario 2) |
| Research | violet #6b4fd8 | one specific article/summary with citation slot; never a listicle |
| Network | teal #0e7c66 | in-network specialist(s), distance + next opening; expandable "More" |
| Question | slate #5b6472 | one good question to ask the patient now |
| Watch | green #2e7d4f | result/referral ownership with owner, backup, deadline, escalation |

Scenario 3 uses a **composite Depth card**: Research row + Network row + "Second opinion ▸" affordance in one card, because they answer one clinical gap together.

## 4 · Tempo modes → cadence contract

| Mode | Fires when | Cadence contract | Never |
| --- | --- | --- | --- |
| NOW | acute, seconds-count contexts | pre-assembled facts only; ≤ 1 card; no computation the clinician waits on | never gates, delays, or interrupts any human action |
| FOCUSED | this visit, this hour | ≤ 2 visible per visit; 90 s silence floor between cards | never contacts anyone; never phrases suggestions as orders |
| DEEP | days-scale considerations (referrals, screening, depth prompts) | queued to natural pauses (note done, chart closed); batchable | never interrupts typing; never auto-sends anything |
| WATCH | a pending result/referral gets an owner | target: silent until breach/result; current POC only records owner + due date | never claim a monitor or escalation unless one runs |

Current runtime: patient-scoped rule timers, per-card cooldown keys, and cross-tab outcome mirroring via the bus. A single global silence budget is not implemented.

## 5 · Lifecycle & metrics

Design target: `created → queued → shown → acted | dismissed(reason) | expired`.

- Current POC commits matching rules directly and emits acted, dismissed, or superseded outcomes; it does not log a separate queued/held/expired lifecycle.
- Current metrics store only global **shown / evaluated** counts. Per-rule n/N, repeats-after-dismissal, and median glance-to-action are planned evaluation measures.
- Any future rate should show its raw numerator and denominator.

## 6 · Traceability — the rules table

Every card's trace row resolves to a rule id. Initial demo set:

| Rule | Trigger (event pattern) | Card | Tempo |
| --- | --- | --- | --- |
| R-01 diagnostic-context check | draft impression asserts a benign explanation while patient-scoped chart findings materially change the differential (demo: “likely anxiety” × known AF + irregular rhythm) | Chart check | FOCUSED |
| R-04 wayfinding | ≥ 4 distinct user-selected chart tabs in 40 s with no open/file/sign action | Navigate | NOW-safe (info only) |
| R-09 depth prompt | patient depth flag + chart stillness (90 s normal; 8 s demo) + no observed derived topic signal; defers behind navigation/referral cards | Depth (composite) | DEEP |
| R-12 result ownership | explicit **Simulate sign & send** after a local referral draft | Watch record | WATCH |

The current "Why this, why now" row names the observed trigger, rule id, and relevant source/boundary. Expandable timestamps, times-shown, and damper detail are not implemented.

**Current runtime status:** R-01 consumes a patient-scoped derived impression signal, R-04 consumes tab/document events, and R-09 consumes chart-open plus topic-presence signals. Raw free text is stripped before either broadcast or persistence. R-12 starts only after an explicit **Simulate sign & send** action; a draft alone never claims follow-through. It records a simulated owner and due date, but no deadline/result monitor returns or escalates the card in this POC. The oncology gallery remains a design example; the evidence template is present but cannot become runtime content until patient fields and source applicability are verified.

## 7 · Scenario storyboards

### S1 — Conflicting impression at documentation time (James Okafor)

The generated note already contains the visit facts; the doctor then adds *“palpitations likely anxiety”* after a reassuring conversation with James Okafor. The buddy checks that new impression against the note and prior chart: a monitor confirmed paroxysmal AF, today’s pulse is irregularly irregular, and anticoagulation adherence is imperfect after a prior TIA.

- **Trigger:** R-01 on a derived `benign_impression: anxiety` signal with patient-scoped AF-history and irregular-rhythm flags active. The persisted bus must not store raw draft text.
- **Card (Chart check · FOCUSED · Okafor):**
  - Headline: *"Anxiety is plausible. Recurrent atrial fibrillation must be resolved first."*
  - Bullets: AF confirmed on 14-day monitor `[Chart · Note 05/12/2026]` · pulse 72, irregularly irregular `[Chart · Vitals]` · missed apixaban doses + prior TIA `[Visit + chart · synthetic]`
  - Diagnostic frame: keep anxiety in the differential; first determine whether the symptoms and rhythm represent recurrent AF, and reconcile anticoagulation adherence.
  - Actions: **Open the rhythm note** · Dismiss ▾. No diagnosis is auto-entered.
- **States shown in gallery:** collapsed, expanded, dismissed → cooldown chip ("won't repeat for 24 h"). The current runtime does not shorten that cooldown when evidence changes.

### S2 — Guided navigation to buried information

Doctor hops across LegacyChart tabs looking for the RN phone note (or any buried datum). The fictional interface is 2009; the buddy is the wayfinder.

- **Trigger:** R-04 lost-signal heuristic — canonical threshold **≥ 4 distinct user-selected chart tabs in 40 s with nothing opened** (the gallery example shows 5 in 32 s; the trace always displays observed vs threshold).
- **Card (Navigate · NOW-safe · Holloway):**
  - Headline: *"The RN phone note is 2 clicks away."*
  - Steps: 1 · Notes tab → 2 · open row "Telephone Encounter · 01/08/2026".
  - Alt row (in case the target guess is wrong): "UACR result → Labs" · "Signed orders → Orders".
  - Actions: **Show me** (spotlights the real element when wired) · Not this ▾
- Info-only: never blocks; disappears on first successful open (expired-superseded outcome).

### S3 — Depth prompt + second opinion (Elena Vasquez — new synthetic patient, §13)

Oncology visit focused on chemotherapy tolerance; the chart shows 7 % weight loss in 8 weeks; the draft plan has no nutrition item. The buddy proposes the missing dimension, a specific reference, and in-network experts — with an optional second-opinion panel.

- **Trigger:** R-09 (dwell + omission signal + active weight-loss flag).
- **Card (Depth composite · DEEP · Vasquez):**
  - Headline: *"Eight weeks, −7 % body weight — nutrition isn't in the current plan."*
  - Research row: Muscaritoli et al., *ESPEN practical guideline: Clinical Nutrition in cancer*, Clin Nutr. 2021;40:2898–2913, DOI `10.1016/j.clnu.2021.02.005`. The card states that patient-level applicability still requires missing intake and symptom data → **Open guideline**
  - Network row: *Lena Chen, MS RD CSO — synthetic oncology-nutrition directory entry · 2.1 mi (mock) · next opening Wed Jul 22 (mock)* → **Draft referral** · **More ▾** (expands 3 more synthetic entries with modality/distance/next-slot chips)
  - Affordance: **Second opinion ▸** opens the panel (§8).
- **Follow-through:** drafting creates a locally stored, explicitly unsent draft. Only **Simulate sign & send** emits R-12 → a Watch record with owner (Rivera), backup (care coordination), and deadline (Jul 25). The POC does not monitor or escalate that deadline.

## 8 · Second-opinion panel (560 px sheet)

Header: patient + framed question (*"Should nutrition support start before cycle 5?"*) + lane toggle. **Quick take is the default; Panel review is an explicit clinician opt-in.**

- **Quick take — single model.** One formal 3-sentence synthesis with source and lane labels. The live app paints a labeled scripted fallback first and replaces it only after a live response arrives.
- **Panel review — 4 scripted AI perspectives** (Tribunal heritage). These are proposed isolated contexts from one model, **not four independent clinicians or models**. Per perspective: Oncology / Nutrition / Pharmacy / Primary care, stance chip, one-line rationale, and evidence link. Disagreement is preserved.
  - Current design result: **UNDERDETERMINED · 1 supports referral · 3 identify assessment or missing-data needs**. Missing intake, symptom-burden, preference, and access evidence prevents a treatment consensus.
  - Refusal state is the aggregate result, not a contradictory footnote: the panel declines to ratify and lists what is missing.
  - Receipt row is explicitly an illustrative schema; no runtime run id or replay command is shown until a verifiable run exists.
  - Latency/cost chips: "~45–90 s · ~$0.40/case (est.)" vs Quick take "~2 s · ~$0.01".
  - Helper line: *"Use the panel when the question sits outside your specialty or the stakes are high."*

### Visualizations (all three are illustrative design artifacts; amber `#b3701f` = current/manual, blue `#2b5fd9` = guided/intervention)

1. **Well-being trajectory** — two-line scenario, weight (kg) over 24 weeks; the delta is labeled *"3.6 kg modeled difference"*, not preserved weight, forecast, or causal effect. Direct labels, legend, assumptions, and an accessible data table are included.
2. **Clinician time** — paired bars: hypothetical manual path 23 min vs guided path 6 min → *"modeled 17-minute difference"*, not observed time saved; every segment is tied to A1–A3 and a data table.
3. **Costs at stake** — range bars compare a hypothetical complication cost with an intervention cost on one axis. Without event probability and treatment effect, this is explicitly **not expected savings**; C1–C3 and a data table are available below.

Rules honored: one axis per chart; text in ink (never series color); values with n/N or assumption ids; no motion.

Footer (always visible): *"Decision owner: A. Rivera, MD — decision support only; nothing is ordered or sent without you."* + SYNTHETIC banner.

## 9 · Model lanes (design contract for wiring)

| | Quick take | Panel review (MA) |
| --- | --- | --- |
| Engine | one frontier-model call (Claude) | 4 isolated-context calls — single model in demo, disclosed on the receipt; cross-model seats planned — + deterministic aggregate |
| Latency | illustrative ~2 s | illustrative ~45–90 s; scripted seats paint together, then a completed live set replaces them |
| Cost | ~$0.01 | ~$0.30–0.60 (fits $100 credit budget; cents-per-event ethos) |
| Labeling | `live model` or `scripted in demo` | same + seat receipts |
| Fallback ladder | live → scripted (labeled) | live → prerecorded run + live verify → scripted (labeled) |

## 10 · Honesty rails (visible in the design)

- SYNTHETIC DEMO strip on gallery, cards footer, and panel.
- Every calculation shows assumptions inline (id'd A1…, C1…), with the sentence *"illustrative — synthetic assumptions; replace with observed timings/costs."*
- Limits box: **EXHAUSTED (by construction):** the panel cannot verify data it was never given — e.g., no dietary intake on file. **HYPOTHESIZED:** time/cost estimates transfer to real workflows.
- No validated real-world outcome claims: modeled differences remain visible only as clearly labeled synthetic scenario math, never as forecasts, causal effects, or expected savings.

## 11 · Consideration ledger (rigor items → where they live in this design)

| Consideration (from our prep) | Where it appears |
| --- | --- |
| Tempo modes NOW/FOCUSED/DEEP/WATCH | mode chip on every card + §4 cadence contract |
| Notification must trace to a condition code, n/N | trace row (R-ids) + metrics strip |
| Specific-or-silent grounding | principle 1 + quiet state copy |
| Decide→commit, held/delivered/outcome receipts | lifecycle §5, logged to bus |
| Damper (24 h → 48 h → 72 h cooldown) | dismissal design + cooldown chip |
| UNDERDETERMINED when required evidence is absent; disagreement preserved | §8 aggregate + perspectives |
| Refusal / UNDERDETERMINED state | §8 refusal state |
| Receipts, replayability | §8 receipt row (synthetic in demo) |
| Claims discipline (n/N, comparator, assumptions) | §8 visualizations + §10 |
| EXHAUSTED vs HYPOTHESIZED limits | §10 limits box |
| Decision owner named; decision support framing | panel footer |
| Fallback ladder for the live demo | §9 |
| Synthetic labeling on every surface | §10 |

## 12 · Data additions required for wiring (next step, after validation)

1. **Patient 6 — Elena Vasquez (SYNTHETIC).** 61 F. Stage III colon adenocarcinoma, adjuvant FOLFOX cycle 4 of 12. Problems: colon ca, chemotherapy-associated nausea, HTN. Weight series: 74.0 → 68.8 kg over 8 weeks (−7 %). Labs: albumin 3.3 (L), Hgb 11.2 (L), CEA trending down. Meds: FOLFOX, ondansetron, lisinopril. Visit 12:20 PM "Chemo follow-up — cycle 4". Prior note: cycle 3 tolerance, mild neuropathy. Scripted note + QA entries. Weight-loss flag drives R-09.
2. **Directory — in-network specialists (synthetic):** 4 oncology-nutrition entries (name, credential, modality, distance, next opening, network badge).
3. **Assumption tables:** A1–A3 (time), C1–C3 (cost), E1 remains unavailable for the eventual patient because adjacent-population evidence cannot supply a patient-specific effect size.
4. **Evidence pack:** the 36-claim registry and verbatim report are present. The oncology `depthPack` is a non-live template; its patient slots and population applicability must be verified before integration. No adjacent study supplies a patient-specific outcome claim.

## 13 · Open questions for Pablo (validation round 2)

1. Composite Depth card (research + network together) vs two separate cards?
2. Panel seat set for the demo: Oncology / Nutrition / Pharmacy / Primary care — right four?
3. Cost visualization: show dollar ranges (with loud assumptions) or keep costs qualitative until the evidence pack lands?
4. Keep Scenario 1's diagnostic frame read-only (recommended), or add an explicit clinician-reviewed insertion action later?
5. Demo mode for the live run: zeroed silence floors/dwell timers + popover pinned open (or auto-open on card commit) so judges see cards land — acceptable, since it changes cadence, not content?
6. Add one cross-model seat (e.g., a GPT seat via your codex CLI) to the panel now, or keep single-model-disclosed and ship it post-hackathon?

## 14 · Critique round 1 (2026-07-18, adversarial Fable agent) — dispositions

**Applied immediately (objective defects):** Scenario 1 was first reframed from a medication conflict and is now aligned to the runtime as a new impression conflicting with facts already present in the note/prior chart; clinician surfaces are de-jargonized; modeled outputs carry local illustrative labels; the panel returns UNDERDETERMINED when required data are absent; Quick take is the default; exact synthetic directory dates have correct weekdays; cost ranges share one axis and are not described as expected savings; R-04 threshold is unified (≥4 distinct chart tabs in 40 s); WATCH/quiet copy is plain language.

**Historical wiring proposals, not current runtime:** Vasquez in the live patient data; a `?demo=1` query mode with a pinned popover; and per-seat progress/loading/error states. The shipped demo instead uses local demo pacing, an in-page dock/cursor, and set-level scripted/live panel replacement. Research-row efficacy phrasing was applied conditionally with population and applicability limits.

**Positioning answers to carry into the demo script (S5):** data boundary — events stay on-machine; only the card's bounded synthetic context leaves when a live lane is explicitly invoked; non-device CDS framing (clinician can review the basis of every recommendation — say it out loud); rule governance target — version + clinical author in each trace (the POC currently shows only rule id and observed trigger); per-day nudge budgets and off-hours WATCH escalation are HYPOTHESIZED scale work; desktop-first by design.

## 15 · Evidence mapping: why this design (2026-07-18 pack)

The GPT-5.6 Pro deep-research pack (verbatim: [`docs/evidence/EVIDENCE_PACK_2026-07-18.md`](../evidence/EVIDENCE_PACK_2026-07-18.md); validator-normalized 36-claim registry: [`data/evidence.json`](../../data/evidence.json)) contextualizes selected mechanisms in this spec; it is not validation of NUDG MD. A/B/C/U are the research run's internal **source-type tiers**, not formal GRADE certainty, recommendation strength, or patient-level confidence: **A** authoritative guideline/RCT/review · **B** peer-reviewed with indirectness/observational · **C** older canonical/simulation/single-center/cost model · **U** unverified. Each claim's exact line is quoted once, ≤25 words, with its id.

Mechanism → evidence (mapped as context, not proof of transportability; neither a mechanism nor an effect size is assumed to transfer across settings):

1. **Dismiss-with-reason on every card** (§2 dismiss menu; §5 lifecycle) → **CDS-04 (internal tier A)**, cluster-RCT, Meeker JAMA 2016 — accountable justification. `CDS-04`: "Mean antibiotic prescribing rates decreased from 23.2% at intervention start to 5.2% at intervention month 18 for accountable justification." Reading: this is directional evidence that an accountable workflow intervention can change behavior. NUDG MD's required choice among three dismissal categories is not the trial's prescribing intervention or free-text justification, and it inherits none of the trial's effect size.
2. **Active-choice cards with executable options** (§3 type system; §7 card actions) → **CDS-05 (internal tier A)**, cluster-RCT, Adusumalli JAMA Cardiology 2023. `CDS-05`: "The patient nudge alone did not change statin prescribing relative to usual care." Reading: the effective clinician arm bundled an EHR active-choice prompt with monthly peer feedback, so the study does not isolate active choice. It motivates testing clinician-facing workflow nudges; it does not validate this card design or transfer the reported effect size.
3. **Tempo tiers NOW / FOCUSED / DEEP / WATCH** (§4 cadence contract) → **CDS-03 (internal tier C)**, severity tiering, Paterno JAMIA 2009. `CDS-03`: "Tiered alerting by severity was associated with higher compliance rates of DDI alerts in the inpatient setting." Reading: this association motivates testing severity-matched interruption; it does not establish that NUDG MD's four tempo tiers will improve compliance.
4. **No interruptive modal in the demo** (§1 calm-by-default; §4) → **CDS-06 (internal tier C)**, simulation, Scott JAMIA 2011. `CDS-06`: "modal alerts were over three times more effective than nonmodal alerts." Reading: a simulation shows that modals can strongly change response behavior. NUDG MD ships none in this demo, so nothing steals focus or blocks typing; the study does not validate that design choice.
5. **"n shown / N evaluated" metrics + override-reason logging** (§5 metrics strip) → **CDS-01 + CDS-02 (internal tier B)**. `CDS-01`: "the overall prevalence of alert override by physicians was 90%." `CDS-02`: "The range of average override alerts was 46.2% to 96.2%." Reading: these studies motivate measuring more than click-through. They do not validate NUDG MD's metrics or make its overrides clinically appropriate.
6. **The problem statement — why a buddy at all** (product framing; §7 storyboards) → **TIME-01 + TIME-02 (internal tier B)**: "Physicians spent an average of 16 minutes and 14 seconds per encounter using EHRs" (2018 Cerner Millennium logs; chart review 33%); and "physicians spend more than one-half of their workday, nearly 6 hours, interacting with the EHR." Reading: these bounded studies motivate reducing EHR navigation burden; NUDG MD has not demonstrated a time reduction.
7. **The guided-navigation bet** (§7 S2; Navigate type) → **TIME-06 (internal tier C; n=12)**: "the AI system saved first-time physician users 18% of the time." Reading: this was 12 Stanford gastroenterology physicians/fellows answering standardized questions from referral packets, not a test of NUDG MD; our time claim remains HYPOTHESIZED.
8. **Cross-system wayfinding** (§3 Navigate; LegacyChart storyboard) → **TIME-03 (internal tier B)**: "an average of a nine-fold difference in time and eightfold difference in clicks." Reading: the four-system usability study motivates the wayfinding problem; it does not establish this implementation's benefit.

**Boundary rules carried from the pack (bind every card, visual, and depth pack):**
- **Relative risks are not individual probabilities.** A risk ratio (e.g., a triple-therapy AKI RR) is never rendered as one patient's "X% chance"; write "studies found XX%–YY% relative increases" instead.
- **Cost constructs are never summed.** Keep the four lanes separate — program cost / capacity-or-opportunity value / cost-of-illness association / reimbursement — and never total them; avoided cost-of-illness is not achievable savings absent prospective causal evidence.
- **Guideline authority does not transfer across populations.** A quoted guideline line (ESPEN, ASPEN, ASCO, KDIGO) holds for its studied population; it does not license the same claim for a different patient or tumor type.

Note on the oncology depth-pack template: [`data/depthpack-oncology-draft.json`](../../data/depthpack-oncology-draft.json) keeps NUT-03 (ASCO low evidence, moderate-strength recommendation) conditional on advanced-cancer/appetite-or-weight-loss applicability, labels NUT-05 as an indirect small postoperative-colorectal RCT, and uses NUT-04 only as a cachexia *diagnostic* criterion (never a referral trigger). NUT-09 is unverified, describes a colon-cancer/FOLFOX gap, and cannot establish the evidence gap for the pending vaginal-cancer case.
