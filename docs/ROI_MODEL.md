# ROI model — the scaling ladder, with the honesty rails on

**Read this first.** NUDG MD is one day old, ran only on synthetic patients, and has zero outcome
evidence. Nothing below is a savings claim. These are **cost bases**: published numbers that say
where dollars and minutes *live*, scaled through labeled assumptions so a judge can check every
step. Four rules, inherited from `docs/evidence/EVIDENCE_PACK_2026-07-18.md`:

1. **Lanes never sum.** Capacity value, program cost, cost-of-illness association, and
   organizational cost are different constructs in different dollars from different years.
   One grand total would launder construct error into false confidence.
2. **Every number carries its id, tier, year, and lane.** Pack ids (TIME/COST/CDS) resolve to
   `data/evidence.json`; new bases added for this model are marked NB-# and listed in §8 —
   they were *not* verified in today's 36-claim research run, and we say so.
3. **Assumptions are numbered.** A1–A5 are the same assumptions as `docs/JUDGE_QA.md` §6;
   A6+ are new here. An unlabeled number is a bug.
4. **Cost bases, not promised savings — a prospective study would have to earn these.**

Registers: **Technical** is for engineers and skeptics; **Plain** is what you say out loud.

---

## Assumption register

| id | Assumption | Status |
|----|-----------|--------|
| A1 | TIME-06's 18% review-time reduction (tier C, n=12, referral packets) transfers to encounter chart review | HYPOTHESIZED — different task, different tool, twelve people |
| A2 | 20 encounters per clinician-day | Stipulated workload |
| A3 | Clinician-hour opportunity value $150/hour | Stipulated price; capacity lane only |
| A4 | Avoided no-shows per month (WATCH lane) | PURE ASSUMPTION — the monitor isn't built; today it prevents zero |
| A5 | Inflation conversion of 2008/2016 USD bases | NOT PERFORMED — figures stay in source-year dollars |
| A6 | 220 clinic days per year | Stipulated calendar |
| A7 | Panel of 1,500 patients per primary-care clinician (NB-6) | Structural constant, tier B literature |
| A8 | 65 primary-care FTEs per 100,000 patients, range 50–80 (NB-7) | Structural constant, tier C |
| A9 | WATCH recovers 10% of otherwise-open referral loops | PURE ASSUMPTION — no basis; shown only to size the lane |
| A10 | Legacy-terminal touch retrofit ≤ $100k all-in per 100 terminals | Order-of-magnitude engineering estimate |
| A11 | AI usage at restraint targets: quick lane on 10% of encounters (~$0.01), panel on 1% (~$0.45) | Stipulated usage; demo latency receipts are real, usage rates are not measured |

Sanity check on A2+A6+A7: 20 × 220 / 1,500 ≈ **2.9 visits per patient per year** — consistent
with typical US primary-care utilization. The constants cohere.

---

## §1 · The unit ladder — capacity/opportunity lane (the only priced lane)

**Technical.** One chain, every link labeled. TIME-01 (tier B, 2020; 2018 Cerner Millennium
logs, ~100M encounters): 16 min 14 s EHR time per encounter, 33% chart review → **321 s of
review per encounter**. Apply A1 (18%, hypothesized): **~58 s per encounter ≈ $2.41** (A3).
Then multiply, and only multiply — never add another lane:

| Unit | Time base | Priced (A3, $150/hr) | Half-transfer (A1 at 9%) |
|------|-----------|----------------------|--------------------------|
| Per encounter | ~58 s | ~$2.41 | ~$1.20 |
| Per clinician-day (A2) | ~19.3 min | ~$48 | ~$24 |
| Per clinician-year (A6) | ~71 h | ~$10,600 | ~$5,300 |
| **Per patient-year** (A7) | ~2.8 min | **~$7** | ~$3.50 |
| Clinic of 10 clinicians | ~3.2 h/day | ~$106k/yr | ~$53k/yr |
| **Community of 100,000** (A8) | ~21 h/day (16–26 across the FTE range) | **~$0.7M/yr (range $0.5–0.85M)** | ~$0.35M/yr |

The half-transfer column is the sensitivity row: if A1's 18% is really 9%, every dollar halves.
The community range comes from A8's 50–80 FTE spread, not from new evidence.

**Plain.** Per doctor: about nineteen minutes a day, roughly ten thousand dollars a year — IF
one small study's eighteen percent holds here, and that's an assumption we say out loud. Per
patient: about seven dollars a year of clinician time. For a town of a hundred thousand people:
somewhere between half a million and nine hundred thousand dollars a year of clinician time is
sitting in chart review. That's the size of the pool. Whether we drain any of it, a pilot decides.

---

## §2 · Follow-through lane — counted in loops, not dollars

**Technical.** NB-1 (tier B): ~9.3% of US primary-care visits generate a specialist referral.
NB-2 (tier B/C, wide range stated): 25–50% of referral loops never close. Ladder: A2 × A6 →
4,400 visits per clinician-year → **~409 referrals per clinician-year** → community of 100,000
(A8): **~26,600 referrals/yr** → open loops at baseline: **~6,700–13,300 per year**. Apply A9
(10% recovery, pure assumption): **~670–1,330 additional loops closed per community-year**.
We deliberately do not price a closed loop: its value is heterogeneous (a normal result, a
caught cancer, a malpractice claim avoided) and pricing it would cross the cost-of-illness
boundary. The adjacent priced base stays where JUDGE_QA Q24 put it: COST-07, $196 per no-show,
2008 VA dollars, its own lane. The demo's WATCH card records owner + due date but runs no
monitor — today it closes zero loops, and we say so.

**Plain.** Out of every hundred referrals a family doctor sends, published studies say
twenty-five to fifty never complete. For a community of a hundred thousand people that's
roughly seven to thirteen thousand dropped hand-offs a year. Our watch card gives each one an
owner and a due date. If that recovered even one in ten — an assumption, not a result — that's
about a thousand loops a year that stop falling on the floor. We count loops before we price
them, because a closed loop might be nothing, or might be the cancer caught in July instead
of December.

---

## §3 · Attention lane — interruptions avoided (mostly unpriced, deliberately)

**Technical.** CDS-01 (meta-analysis): ~90% of interruptive drug alerts are overridden —
the incumbent modal paradigm burns attention at scale. CDS-06 (simulation): modals outperform
nonmodal *for effect* — which is exactly why we reserve interruption for high severity and
run everything else as glanceable peripheral cards. CDS-04 (cluster-RCT, tier A): accountable
justification — our dismiss-with-reason — reduced inappropriate prescribing in ambulatory
antibiotics; we cite the **mechanism**, and per the pack's boundary rule the effect size does
not transfer to our population. The measurable KPI here is **modal-minutes avoided** and
**override rate under peripheral delivery** — pilot instruments, not claims.

**Plain.** Today's alert systems interrupt so often that doctors click ninety percent of them
away — the boy who cried wolf, built into the software. We flip it: the buddy waits at the
edge of the screen, and when you dismiss a nudge you say why, which a real trial showed makes
prescribing better. What we'd measure is simple: how many interruptions never happened.

---

## §4 · Long-term organizational lane — burnout and retention

**Technical.** Mechanism link: TIME-02 (tier B): ~6 h of an 11.4-h physician workday is EHR
interaction. NB-3 (tier B, 2019, Annals of Internal Medicine cost-modeling): burnout's
attributable organizational cost ≈ **$7,600 per employed physician per year** (turnover +
reduced clinical effort construct, modeled); industry-reported physician replacement cost
**$500k–$1M** (tier C). Sized, not claimed: 65 FTEs (A8) × $7,600 ≈ **~$0.5M/yr sitting in
this lane per 100,000-patient community**. NUDG MD's causal contribution to it: **unmeasured
and unclaimed**. We assert only the mechanism — less hunting, fewer interruptions, follow-ups
that don't ride home in the doctor's head — and would measure burnout instruments (e.g., MBI)
in any pilot longer than six months.

**Plain.** Doctors spend more of their day with the record than with patients, and burnout
has a price tag: about seventy-six hundred dollars per doctor per year, and half a million to
a million to replace one who quits. We do not claim we fix burnout — one day old, remember.
We claim the mechanism points the right way, and it's worth measuring: a buddy that hunts so
you don't, and remembers so you don't have to.

---

## §5 · Hardware lane — immediate $0, long-term the 1% retrofit

**Immediate — Technical.** Day-one hardware cost: **$0**. The buddy is a picture-in-picture
browser window on machines that already run the EHR. No new terminals, no integration
hardware, no server rack: one static origin plus a relay that costs cents (§6). This is
itself an ROI property: the deployment denominator starts at software-only.

**Long-term — Technical.** The overlay vision prices as a retrofit, not a replacement.
NB-4 (tier C, market pricing): commodity infrared touch-overlay frames run ~**$100–400 per
screen**; 100 legacy terminals ≈ $10k–40k hardware, ≤ **$100k all-in** with installation and
mounting (A10). The comparison construct — and it is a *different construct*, deferral not
substitution — is NB-5 (tier C, press-reported): EHR replacement capital projects run
**$10M–100M for community systems** and **$1B+ at flagship scale**. Order-of-magnitude claim
only: **a guided-touch retrofit costs ~0.1–1% of the replacement it defers.** The functional
case rides on TIME-03 (tier B): the same tasks take up to 9× longer across EHRs — navigation
variance that guided overlays attack directly. Long-term hardware KPIs: terminals retrofitted,
training-hours-to-competence on legacy screens, guided-path completion rate, and **upgrade
deferral years** (option value we name but do not price). Regulatory line first, always:
the overlay never touches or blocks what the device shows — it advises the human
(JUDGE_QA Q22).

**Plain.** Today it needs zero new hardware — it's a window on screens the clinic already
owns. Tomorrow's version: a two-hundred-dollar touch frame laid over a 2009 terminal, guiding
hands across software nobody remembers how to use — versus a ten-million-dollar rip-and-replace.
We're the one-percent path that buys a hospital time. And the glass never blocks the machine:
it only advises the human.

---

## §6 · Our own cost side — the only dollars we fully defend

**Technical.** The trigger layer is deterministic rule evaluation on bus events: marginal cost
≈ $0. AI depth is spent only on explicit request, labeled, with latency receipts: quick lane
~$0.01, panel ~$0.30–0.60 per run (illustrative, from demo-day pricing). At A11 restraint
targets (quick on 10% of encounters, panel on 1%): 2.9 encounters/patient-year →
**~$0.02 per patient per year** of AI cost; a 100,000-patient community ≈ **~$1,600/yr**.
Juxtaposition allowed, sum forbidden: two cents of defensible cost per patient-year stands
*against* a ~$7 capacity base (§1) — we may show both, we may not report the difference as
savings.

**Plain.** Our running cost is about two cents per patient per year, because the AI only works
when a human asks. The two cents is the number we'll defend all night. The seven dollars it
stands next to is a base a pilot has to earn.

---

## §7 · The scoreboard we'd actually build (and partly already run)

The demo bus already logs sanitized events — every nudge shown, accepted, dismissed-with-reason,
or refused. The pilot scoreboard (the table below is the canonical enumeration; a condensed
form appears in `docs/JUDGE_QA.md` Q27):

| Metric | Type | Status today |
|--------|------|--------------|
| Adjudicated appropriate acceptance / appropriate override | Outcome-adjacent | Not built — needs clinician adjudication |
| Time-to-information (R-04 promise: target ≤ 2 clicks) | Direct | Event-loggable now |
| Loop closure by due date (R-12 WATCH) | Direct | Card exists; monitor not built |
| Modal-minutes avoided; override rate under peripheral delivery | Attention | Pilot instrument |
| **Nudges per encounter (target < 1) and % encounters fully silent** | **Restraint** | Loggable now |
| Dismiss-with-reason rate; UNDERDETERMINED refusal rate | Trust | Loggable now |
| Latency receipts per AI request | Cost/honesty | **Shipping today** |
| Burnout instrument (≥ 6-month pilots) | Organizational | Not started |

**Plain.** The buddy's best number may be how often it says nothing. We already log every
nudge and every reason a doctor waves one off; the pilot adds the judges that decide whether
each nudge deserved to exist. We measure before we claim — that's the whole religion.

---

## §8 · New bases appendix — added for this model, NOT in today's verified 36-claim pack

| id | Base | Construct | Source type | Tier |
|----|------|-----------|-------------|------|
| NB-1 | ~9.3% of primary-care visits generate a specialist referral | Utilization rate | Peer-reviewed US claims analysis (~2011) | B |
| NB-2 | 25–50% of referral loops never close | Process-failure range | Peer-reviewed literature, multiple settings, wide range | B/C |
| NB-3 | Burnout ≈ $7,600/physician-year organizational cost; replacement $500k–$1M | Modeled organizational cost | Annals of Internal Medicine 2019 model; industry reports | B / C |
| NB-4 | IR touch-overlay frames ~$100–400/screen | Market price | Commodity hardware pricing, 2026 | C |
| NB-5 | EHR replacement: $10M–100M community scale; $1B+ flagship | Capital project cost | Press-reported implementations | C |
| NB-6 | Primary-care panel ≈ 1,500 patients (range ~1,200–1,900) | Structural constant | Peer-reviewed panel-size literature | B |
| NB-7 | 65 primary-care FTEs per 100,000 patients (range 50–80) | Structural constant | Workforce-density reports | C |

These carry sources by type and year rather than DOI because they were added after the
research run closed; before any use beyond judging conversation, they go through the same
verification pipeline as the pack (`docs/evidence/EVIDENCE_PACK_2026-07-18.md`, §
verification rules). Until then they are labeled exactly what they are: bases for sizing,
not verified claims.

---

## Immediate vs long-term, on one screen

| Horizon | Lane | The number | What it is |
|---------|------|-----------|------------|
| Immediate | Our cost | ~$0.02/patient-yr AI; $0 hardware | **Defensible today** |
| Immediate | Capacity | ~19 min/clinician-day; ~$7/patient-yr; ~$0.5–0.85M/community-yr | Base under A1 — halves if the transfer halves |
| Immediate | Follow-through | ~7k–13k open loops/community-yr; ~1k recovered at A9 | Counted, not priced |
| Immediate | Attention | Interruptions avoided | Pilot instrument |
| Long-term | Organizational | ~$0.5M/community-yr burnout lane; $500k–$1M per retained physician | Sized, mechanism only |
| Long-term | Hardware | Retrofit at ~0.1–1% of replacement cost; deferral years | Order of magnitude, different construct |
| Always | The rule | — | **Lanes never sum. Cost bases, not promised savings.** |
