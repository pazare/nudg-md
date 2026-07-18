# Nudge card design — NUDG MD

Design artifact for validation round 2 (2026-07-18). Live gallery: [`/design/cards.html`](../../design/cards.html) — open at `http://localhost:4800/design/cards.html`.
Scope: **design only**. Trigger wiring, data additions, and model lanes are implemented after Pablo validates this document and the gallery.

---

## 1 · Design principles

1. **Specific-or-silent.** A nudge must name this patient, this moment, and an exact chart datum. If it can't, it stays silent. The empty state says so.
2. **Glanceable, then rigorous.** Headline carries the whole point in ≤ 90 characters; evidence, math, and provenance are one click deeper (progressive disclosure). Non-technical surface, rigorous interior.
3. **Calm by default.** One card in view; others queue behind a count. No sound, no motion loops, one arrival pulse of the dock badge. Never modal, never steals focus, never blocks typing.
4. **Traceable.** Every card shows "Why this, why now": triggering event + rule id + sources. Every shown/suppressed nudge is countable (n shown / N rule evaluations).
5. **The clinician decides.** Cards suggest; humans act. Every action is explicit; nothing is ordered, sent, or filed by the buddy. Outcomes (acted / dismissed / expired) are logged to the same bus.
6. **Respect dismissal.** A dismissed topic cools down (24 h and a 2× higher evidence bar; second dismissal → 6×). Repeats without new evidence are a design failure.
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
- Dismiss is a menu, not a button: *Not relevant here* / *Already considered* / *Later today*. Each maps to an outcome + damper behavior.

## 3 · Type system

| Type | Accent | Contents |
| --- | --- | --- |
| Chart check | amber #b3701f | omitted/conflicting chart facts at documentation time (Scenario 1) |
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
| WATCH | a pending result/referral gets an owner | silent until deadline breach or new result; then one card | never reassigns or re-prioritizes without explicit sign-off |

Global: single silence floor across all streams; per-(rule × patient) damper keys; cross-tab dedup via the bus.

## 5 · Lifecycle & metrics

`created → queued → shown → acted | dismissed(reason) | expired`

- Decide vs commit: a card is *decided* by rules, *committed* only when actually rendered; both are logged (held reasons: flow / budget / min-gap).
- Outcomes feed the metrics strip: **n shown / N evaluations**, repeats-after-dismissal (target 0), median glance-to-action.
- Every metric shown with raw n/N; no rates without denominators.

## 6 · Traceability — the rules table

Every card's trace row resolves to a rule id. Initial demo set:

| Rule | Trigger (event pattern) | Card | Tempo |
| --- | --- | --- | --- |
| R-01 med-context check | note draft text matches med with chart contraindication flag (e.g., NSAID × eGFR<60) | Chart check | FOCUSED |
| R-04 wayfinding | ≥ 4 `ehr_tab_viewed` in 40 s with no open/file/sign action | Navigate | NOW-safe (info only) |
| R-09 depth prompt | chart dwell > 90 s + draft plan lacks topic X while chart flag Y active (e.g., no nutrition item × −7 % weight) | Depth (composite) | DEEP |
| R-12 result ownership | referral/order accepted from a nudge | Watch | WATCH |

"Why this, why now" expands to: triggering event (timestamp), rule id + plain-English rule text, sources cited, times shown, damper state.

## 7 · Scenario storyboards

### S1 — Omitted context at documentation time (Margaret Holloway)

Doctor reviews Holloway's chart in one tab, drafts in the other, and types a reasonable plan — *"start ibuprofen 400 mg TID PRN for knee pain"* — that two chart facts contradict.

- **Trigger:** R-01 on draft text `ibuprofen|naproxen|NSAID` with CKD flag active.
- **Card (Chart check · FOCUSED · Holloway):**
  - Headline: *"Before this note is filed — ibuprofen conflicts with documented findings in her chart."*
  - Bullets: eGFR 52 (07/02/2026), CKD 3a `[Chart · Labs]` · RN tele-note 01/08/2026: "advised acetaminophen, avoid NSAIDs given CKD" `[Chart · Notes]` · concurrent lisinopril — NSAID + ACEi compounds renal risk `[Guideline (synthetic summary)]`
  - Suggestion line: chart-consistent alternative — acetaminophen, as the RN advised (already PRN). Topical NSAIDs deliberately not suggested: contradicting the cited "avoid NSAIDs" note on stage is bad optics even where pharmacologically defensible.
  - Actions: **Open the RN note** · Dismiss ▾ (note-text insertion omitted pending Q4)
- **States shown in gallery:** collapsed, expanded, dismissed → cooldown chip ("won't repeat for 24 h unless new evidence").

### S2 — Guided navigation to buried information

Doctor hops across MediCore tabs looking for the RN phone note (or any buried datum). The interface is 2009; the buddy is the wayfinder.

- **Trigger:** R-04 lost-signal heuristic — canonical threshold **≥ 4 tab views in 40 s with nothing opened** (the gallery example shows 5 in 32 s; the trace always displays observed vs threshold).
- **Card (Navigate · NOW-safe · Holloway):**
  - Headline: *"The RN phone note is 3 clicks away."*
  - Steps: 1 · Notes tab → 2 · row "Telephone Encounter · 01/08/2026" → 3 · click to open.
  - Alt row (in case the target guess is wrong): "UACR result → Labs" · "Signed orders → Orders".
  - Actions: **Show me** (spotlights the real element when wired) · Not this ▾
- Info-only: never blocks; disappears on first successful open (expired-superseded outcome).

### S3 — Depth prompt + second opinion (Elena Vasquez — new synthetic patient, §13)

Oncology visit focused on chemotherapy tolerance; the chart shows 7 % weight loss in 8 weeks; the draft plan has no nutrition item. The buddy proposes the missing dimension, a specific reference, and in-network experts — with an optional second-opinion panel.

- **Trigger:** R-09 (dwell + omission signal + active weight-loss flag).
- **Card (Depth composite · DEEP · Vasquez):**
  - Headline: *"Eight weeks, −7 % body weight — nutrition isn't in the current plan."*
  - Research row: structured nutrition support during chemotherapy — one named synthetic summary, citation slot reserved for the evidence pack → **Open summary**
  - Network row: *Lena Chen, MS RD CSO — oncology nutrition · In-network · 2.1 mi · next opening Tue Jul 22* → **Start referral** · **More ▾** (expands 3 more in-network specialists with modality/distance/next-slot chips)
  - Affordance: **Second opinion ▸** opens the panel (§8).
- **Follow-through:** accepting the referral emits R-12 → Watch card with owner (Rivera), backup (care coordination), deadline (Jul 25), escalation promise.

## 8 · Second-opinion panel (560 px sheet)

Header: patient + framed question (*"Should nutrition support start before cycle 5?"*) + lane toggle:

- **Quick take — single model.** One formal 3-sentence synthesis, source chips, latency chip "single pass · ~2 s". Labeled `scripted in demo` until live.
- **Panel review — 4 isolated seats** (Tribunal heritage). Per seat: perspective (Oncology / Nutrition / Pharmacy / Primary care), stance chip (Support / Oppose / Insufficient — requests data), one-line rationale, evidence link. Dissent is preserved on the surface, never averaged away.
  - Aggregate line: **"Panel Support 3/4 · 1 requests data"** — the word is *support*, never *confidence*.
  - Refusal state exists by design: **UNDERDETERMINED** (evidence insufficient → the panel declines to ratify and lists what's missing).
  - Receipt row: run id, seat count with an honest isolation disclosure — in the demo the four seats are **one model with isolated contexts** (stated on the surface; cross-model seats are the designed upgrade and the honest answer to "why is this a second opinion?") — and a replayable note (synthetic).
  - Latency/cost chips: "~45–90 s · ~$0.40/case (est.)" vs Quick take "~2 s · ~$0.01".
  - Helper line: *"Use the panel when the question sits outside your specialty or the stakes are high."*

### Visualizations (all three shipped in the panel; palette validated: amber `#b3701f` = current/manual, blue `#2b5fd9` = guided/intervention; CVD ΔE 116, all checks pass)

1. **Well-being trajectory** — two-line projection, weight (kg) over 24 weeks: current plan declining vs with-intervention stabilizing; shaded delta labeled *"+3.6 kg preserved (illustrative)"*. Direct labels at line ends + legend; hover tooltips when wired.
2. **Clinician time** — paired horizontal bars: manual search + referral coordination ≈ 23 min vs guided ≈ 6 min → *"≈ 17 min saved on this case"*; every segment tied to an assumption id (A1–A3).
3. **Cost consideration** — range bars: potential avoided-cost range under stated assumptions vs intervention cost; explicitly *"illustrative range — synthetic unit costs"*, with the assumptions table one click below (C1–C3).

Rules honored: one axis per chart; text in ink (never series color); values with n/N or assumption ids; no motion.

Footer (always visible): *"Decision owner: A. Rivera, MD — decision support only; nothing is ordered or sent without you."* + SYNTHETIC banner.

## 9 · Model lanes (design contract for wiring)

| | Quick take | Panel review (MA) |
| --- | --- | --- |
| Engine | one frontier-model call (Claude) | 4 isolated-context calls — single model in demo, disclosed on the receipt; cross-model seats planned — + deterministic aggregate |
| Latency | ~2 s | ~45–90 s, progress shown per seat |
| Cost | ~$0.01 | ~$0.30–0.60 (fits $100 credit budget; cents-per-event ethos) |
| Labeling | `live model` or `scripted in demo` | same + seat receipts |
| Fallback ladder | live → scripted (labeled) | live → prerecorded run + live verify → scripted (labeled) |

## 10 · Honesty rails (visible in the design)

- SYNTHETIC DEMO strip on gallery, cards footer, and panel.
- Every calculation shows assumptions inline (id'd A1…, C1…), with the sentence *"illustrative — synthetic assumptions; replace with observed timings/costs."*
- Limits box: **EXHAUSTED (by construction):** the panel cannot verify data it was never given — e.g., no dietary intake on file. **HYPOTHESIZED:** time/cost estimates transfer to real workflows.
- No outcome claims anywhere: the demo claims a *mechanism on synthetic cases*.

## 11 · Consideration ledger (rigor items → where they live in this design)

| Consideration (from our prep) | Where it appears |
| --- | --- |
| Tempo modes NOW/FOCUSED/DEEP/WATCH | mode chip on every card + §4 cadence contract |
| Notification must trace to a condition code, n/N | trace row (R-ids) + metrics strip |
| Specific-or-silent grounding | principle 1 + quiet state copy |
| Decide→commit, held/delivered/outcome receipts | lifecycle §5, logged to bus |
| Damper (2×→6× cooldown) | dismissal design + cooldown chip |
| Panel Support (never "confidence"), dissent preserved | §8 aggregate + seats |
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
3. **Assumption tables:** A1–A3 (time), C1–C3 (cost), E1 (effect size placeholder pending evidence pack).
4. **Evidence pack:** real citations from the GPT-5.6 Pro deep-research run (docs/design/EXTERNAL_PROMPTS.md) — until it lands, research rows carry `citation slot — evidence pack pending`.

## 13 · Open questions for Pablo (validation round 2)

1. Composite Depth card (research + network together) vs two separate cards?
2. Panel seat set for the demo: Oncology / Nutrition / Pharmacy / Primary care — right four?
3. Cost visualization: show dollar ranges (with loud assumptions) or keep costs qualitative until the evidence pack lands?
4. "Insert alternative wording" action in S1 — currently **omitted** (critique: liability optics of the tool writing medication text into a legal document). Restore it, or keep it out?
5. Demo mode for the live run: zeroed silence floors/dwell timers + popover pinned open (or auto-open on card commit) so judges see cards land — acceptable, since it changes cadence, not content?
6. Add one cross-model seat (e.g., a GPT seat via your codex CLI) to the panel now, or keep single-model-disclosed and ship it post-hackathon?

## 14 · Critique round 1 (2026-07-18, adversarial Fable agent) — dispositions

**Applied immediately (objective defects):** S1 no longer suggests a topical NSAID under an "avoid NSAIDs" citation and drops "Insert alternative"; headline no longer miscounts findings; clinician surfaces de-jargonized (no "damper armed" / "logged to bus" / "2× bar" / "isolation: identity"); "(illustrative)" added inside the trajectory SVG and value labels moved to ink; seats/aggregate now carry an explicit "scripted in demo" label; cost chart rebuilt on one true shared $0–16k axis with ticks and "7–24×" instead of "order of magnitude"; metrics labeled synthetic; R-04 threshold unified (≥4 in 40 s) with observed-vs-threshold shown in traces; WATCH/quiet copy de-manifestoed.

**Accepted into the wiring plan (next step):** Vasquez + specialist directory in `data/patients.json`; a `?demo=1` mode (zeroed floors/dwell, pinned popover, first-run "your buddy lives here" cue — also answers validation-1's "couldn't find the orb"); per-seat progress/loading/error states for the live panel lane; research-row efficacy phrasing stays conditional until the evidence pack cites it.

**Positioning answers to carry into the demo script (S5):** data boundary — events stay on-machine; only the card's context leaves when a live lane is explicitly invoked; non-device CDS framing (clinician can review the basis of every recommendation — say it out loud); rule governance — every rule carries a version + clinical author slot in its trace; per-day nudge budget across a panel + off-hours WATCH escalation targets are HYPOTHESIZED scale work, labeled as such; desktop-first by design.
