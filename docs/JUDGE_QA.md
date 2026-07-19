# NUDG MD — Judge Q&A pack (2026-07-18)

Read the **Plain** answer aloud; keep the **Technical** answer for engineers. Evidence ids (NUT/CKD/CDS/TIME/COST) resolve to `data/evidence.json`; the letters A/B/C/U are the research run's internal source-type tiers, not formal GRADE certainty.

---

## 1 · The two questions already asked at the booth

**Q1: "Does it open things by itself, or does it open?"**

**Technical:** Two verbs, two policies. Surfacing is autonomous: the deterministic rules (R-01/R-04/R-09/R-12) evaluate bus events and render cards, and rendering is pure UI inside the buddy popover — no writes to either app's state, nothing opened, nothing filed, no side effects. Acting is never autonomous: every state-changing verb (open the note, draft the referral, simulate sign & send, acknowledge) executes only inside an explicit button's click handler. The cross-tab jump is the sharpest proof: the handler resolves the named same-origin browsing context (`window.open("", "nudg-ehr")`) inside the user's click gesture, so the browser's own user-activation requirement carries the tab switch; a staged command with a 15-second TTL covers the cold-start case, and the card is only cleared after LegacyChart acknowledges the note actually opened. Drafts stay drafts until the clinician clicks the sign action — on screen: "Referral draft saved locally: Nothing has been sent." — and nothing leaves localhost.

**Plain:** It raises its hand by itself. It never presses buttons by itself. Your click is the key that starts every motor — even the jump to the other tab rides on your click. And a draft stays a draft until you sign it.

**Q2: "What data does it feed from, specifically?"**

**Technical:** Three local sources; one external lane, and only on request. First, workflow breadcrumbs: an in-browser event bus (BroadcastChannel `nudg-demo`) carrying a typed taxonomy — `encounter_selected`, `note_signals`, `ehr_tab_viewed`, `ehr_document_opened`, and so on. Raw note text is architecturally excluded: the scribe computes derived keyword classes in its own tab (an impression class like "anxiety", a topic class like "nutrition_referral") and the bus strips the free-text fields (`q`, `text`, `note`) before both broadcast and persistence; the persisted history is a sanitized rolling localStorage log, 100 events, four-hour TTL. Second, the synthetic chart: `data/patients.json`, five fictitious patients — in production this source becomes the EHR's own FHIR resources. Third, on explicit clinician request only: the AI lanes via the localhost relay, which receive the card's bounded structured context (problems, meds, vitals, labs, the framed question) — never the event stream, never free text. Separately, Santiago's standalone gyn-onc agent live-fetches public-domain NCI PDQ guideline pages and logs every fetch: URL, timestamp, content hash.

**Plain:** Three things, all on this machine. Breadcrumbs of the workflow — like a step counter, not a wiretap: it knows a note was written, never what the note says. The patient's chart. And an AI only when the doctor asks — labeled every time it answers.

---

## 2 · Autonomy and safety boundaries

**Q3: What can it ever do on its own?**

**Technical:** Exactly three things: evaluate rules, render cards, and log its own outcomes to the bus. It can also stand its own cards down — R-04 self-supersedes the moment you open any document, file a note, sign orders, or switch charts, and a peek auto-hides after about 14 seconds with the card still waiting inside the buddy. It cannot open, file, order, send, or navigate on its own: those verbs exist only inside click handlers. The only autonomous "action" is subtraction — withdrawing its own suggestion when the moment has passed.

**Plain:** Alone, it can only suggest — and un-suggest. It takes its card back the moment you find the thing yourself. Everything else needs your click.

**Q4: What stops a bad nudge from becoming noise or harm?**

**Technical:** Four brakes. Specific-or-silent: a rule must name this patient, this moment, and an exact chart datum, or it stays silent — the empty state says so. Dismiss-with-reason: dismissal is a menu (Not relevant here / Already considered / Not now), each choice recorded to the bus; the design descends from accountable-justification evidence (CDS-04, internal tier A: Meeker JAMA 2016, cluster-RCT), and we state the boundary — our three-choice menu is not that trial's intervention and inherits none of its effect size. Escalating cooldowns: a dismissed card cools 24, then 48, then 72 hours. Never modal in this demo: nothing steals focus or blocks typing; CDS-06 (tier C, simulation) shows modals are powerful, which is exactly why we reserve them and ship none here. And a bad nudge still executes nothing — a human would have to act on it.

**Plain:** Four brakes. It must point at something specific or say nothing. If you dismiss it, it asks why — one tap — and stays away longer each time. It never blocks your screen. And even a wrong card can't do anything: it has no power, only words.

**Q5: How do you contain hallucination?**

**Technical:** In layers. The trigger layer is deterministic: rules cannot hallucinate — they can only misfire, and a misfire is inspectable, because every card carries "Why this, why now" with the observed event and rule id. The AI layer is opt-in, labeled, and contract-checked: the quick lane must ground itself in the provided chart facts and end with a "Basis:" line listing the facts it used, within 120 words — replies failing that contract are rejected server-side and the labeled scripted fallback remains. Panel seats must return strict JSON with a stance and bounded rationale; one unparseable seat downgrades the entire run to scripted rather than display fabricated deliberation. Aggregates show support counts, never confidence percentages, and refusal — UNDERDETERMINED — is a first-class output.

**Plain:** The part that watches is math, not AI — it can't make things up. The AI only speaks when asked, must list which chart facts it used, and wears a label. If it can't meet that bar, the screen says "scripted." It never fakes it.

**Q6: What happens when the AI is wrong on stage, right now?**

**Technical:** The containment becomes the demo. Live output arrives with a served-mode chip and a latency receipt; we read the screen, never predict it. A wrong live answer changes no state — no card action, no draft, no send executes from model text — and the "Basis:" contract makes the error auditable on the spot: the facts it claims are checkable against the chart in the next tab, one click away. If a lane fails or is cancelled, the scripted fallback stays visibly labeled scripted; a failed lane never silently upgrades its provenance.

**Plain:** Then you'll watch us catch it, live. The answer wears a label and lists the facts it used, so you can check it against the chart right there. And a wrong answer can't do anything — it has no buttons.

**Q7: The panel refused to answer. Why is that a feature?**

**Technical:** Because the aggregate is honest by construction. If any seat requests missing data, the aggregate is UNDERDETERMINED — on screen: "the panel declines to ratify and lists what it needs first." Holloway's scripted pack lands there deliberately: three seats name missing intake, preference, and access data; one opposes treating a simulated send as completed care. When no seat requests data, the screen shows a support count the math can back — "Supported: 3/4 seats · positions, never confidence." Consensus theater is how clinical tools lose trust; a refusal that names its needs is more useful to a clinician than a smoothed synthesis or a confidence percentage nothing supports.

**Plain:** A doctor doesn't need a yes-machine. When the data isn't there, the panel says so and lists exactly what's missing. That refusal is the most trustworthy sentence in the product.

**Q8: Isn't this just alert fatigue with better fonts?**

**Technical:** The alert-fatigue literature is our design constraint, not our competition. Overrides run about 90% in the wild (CDS-01, tier B, 570,776 prescriptions) and appropriateness varies from 29.4% to 100% (CDS-02, tier B), so raw override rate is not a metric we accept in either direction. Structurally the buddy differs from alerting systems: it is patient-scoped (cards for other patients are held out of view), specific-or-silent, tempo-stamped (NOW/FOCUSED/DEEP/WATCH, motivated by CDS-03's severity-tiering association, tier C), never modal here, and it stands down on its own when you act. The whole demo engine is four rules. Dismissal collects a reason and buys escalating silence.

**Plain:** Alert fatigue comes from alarms that fire everywhere and mean nothing. This fires four rules, only for the patient on screen, only with a fact it can point to. Dismiss one and it asks why, then stays away longer. Silence here is engineered, not accidental.

---

## 3 · Data, privacy, security

**Q9: Walk me through the privacy contract in depth.**

**Technical:** Three rings. Ring one, in-tab: raw note text never leaves the tab it was typed in — the scribe derives keyword classes locally and emits only those derived signals. Ring two, the bus: the transport strips free-text fields (`q`, `text`, `note`) before both broadcast and persistence; the persisted history is a rolling localStorage log capped at 100 events with a four-hour TTL, and Reset wipes it across tabs; drafts and filed notes live in per-tab sessionStorage. Ring three, the AI boundary: a model sees a bounded structured context — problems, meds, allergies, vitals, labs, the framed question, plus a `synthetic: true` flag — only when the clinician explicitly clicks a lane. The relay enforces an origin allowlist (the demo origin only), JSON content-type, a 256 KB body cap; keys live in env only — never logged, never echoed in responses, never written to disk — and codex children run under an env allowlist that excludes API keys, in a read-only, ephemeral sandbox.

**Plain:** The note never leaves the tab it was written in — the buddy only learns "a note exists, and it mentions anxiety." Everything it remembers stays on this machine and expires in four hours. An AI sees a small structured summary only when the doctor clicks. And today every patient is synthetic anyway.

**Q10: What would have to change for real PHI?**

**Technical:** Almost everything, and none of it exists today — we say that plainly. Required: a BAA with every model vendor before a single real-data call; encryption in transit and at rest (the demo transport is plain local HTTP); real access control and user identity bound to the health system's IdP; an append-only, tamper-evident audit trail; retention and minimization policies; full HIPAA Security Rule work; and no third-party call of any kind without an executed agreement. Santiago's agent README says it outright: "No PHI/security hardening at all." What the architecture does offer is the right chokepoints: the bus already sanitizes by contract, and the relay is already the single egress point — the compliance controls bolt onto boundaries that exist.

**Plain:** Honestly: none of the real-patient machinery exists today — no signed agreements, no encryption, no access control. What we did build is the right chokepoints: one sanitized event stream, one relay every AI call must pass through. That's where the compliance work bolts on.

**Q11: Why does localhost matter today?**

**Technical:** Localhost is the demo's verifiable trust story. Both apps and the buddy share one local origin; events cross tabs via BroadcastChannel, which never leaves the browser; the relay binds 127.0.0.1 and accepts only the demo origin; there are no accounts, no telemetry, no cloud storage. The only bytes that can leave this machine are an explicitly invoked AI-lane request — with one disclosed caveat from our README: an already-sent Anthropic HTTPS request cannot be recalled by the stdlib relay; cancellation detaches the UI result and terminates codex child processes, but a short in-flight HTTPS call may finish server-side.

**Plain:** Unplug the network and almost everything you saw still works — the cards, the jump, the draft, the watch. The only thing that ever leaves this laptop is the question the doctor explicitly asks the AI. That's the boundary, and we can show it to you.

**Q12: What does the audit trail actually record?**

**Technical:** Today, three surfaces. The bus log: every sanitized workflow event and every nudge outcome — committed, acted, dismissed with its reason, superseded — replayable by a late-joining tab. Metrics: global evaluated and shown counters only; per-rule n/N and repeats-after-dismissal are planned evaluation work, not implemented, and we say so. Receipts: every AI response carries served mode, model, and latency in milliseconds; panel receipts disclose seat count and context isolation. Santiago's agent adds a guideline-fetch audit: source URL, timestamp, and content hash per page pulled. Missing for production: user identity, tamper evidence, per-rule accounting.

**Plain:** Every nudge writes its own receipt — what fired it, what the doctor did, and why a dismissed one was dismissed. Every AI answer logs who answered and how fast. It's a demo-grade trail: real deployments need identity and tamper-proofing on top.

**Q13: Could a hospital run the AI lanes inside its own walls?**

**Technical:** By design intent, yes — the relay is the swap point. The browser never holds keys or model endpoints; it calls one local relay, and the relay chooses lanes. Pointing the quick lane at a VPC endpoint, a cloud-tenant deployment, or an on-prem serving stack is a relay-side change with zero UI change, and the receipt keeps disclosing whatever actually served. This is a design affordance, not a deployed capability: today the relay speaks to the Anthropic API and a local codex CLI, nothing else.

**Plain:** The apps never talk to an AI company — they talk to one small local relay, and the relay decides. A hospital could point that relay at models inside its own walls. We built the socket; the enterprise plug is future work.

---

## 4 · Scalability — software

**Q14: How does this generalize across EHRs?**

**Technical:** The portable product is the event taxonomy plus the rules — app-agnostic moments like `encounter_selected`, `note_signals`, `ehr_tab_viewed`. For modern systems the standards already exist: SMART on FHIR launch for patient context, FHIR reads (Condition, MedicationRequest, Observation, DocumentReference) replacing `patients.json`, and CDS Hooks as the native integration surface — its card model of source-attributed suggestions with explicit user actions maps almost one-to-one onto our nudge cards. For legacy systems with no APIs, the path is a browser extension or desktop overlay that observes the workflow and emits the same taxonomy. Wayfinding can never ship as a static map: TIME-03 (tier B, 2018) measured a nine-fold time and eight-fold click variance for the same task across four EHRs, so per-system wayfinding maps must be learned per deployment.

**Plain:** The buddy doesn't care which record system it's watching — it cares about a small vocabulary of moments: a chart opened, a note written, a doctor hunting. Modern systems hand us those through standard interfaces; old ones get an overlay that watches for the same moments. The step-by-step directions get learned per hospital, because the same task takes nine times longer on some systems than others.

**Q15: Isn't the demo's "integration" fake?**

**Technical:** Today's integration is staged, yes — we wrote both apps, so of course they emit our events. The claim we defend is narrower and testable: the rules, cards, cooldowns, supersession, and privacy contract consume only the taxonomy, never the apps' internals, so swapping the emitters does not change the engine. Earning each event from a real EHR — via SMART on FHIR, CDS Hooks, or the overlay path — is exactly the integration work, and it is not done.

**Plain:** Straight answer: we built both apps, so the plumbing is ours end to end. The honest bet is that the buddy only needs that small event vocabulary, and real systems can supply it. Proving that is the next build, not this one.

**Q16: Four handwritten rules is cute. How does that become a real rule library?**

**Technical:** Five parts. Authoring: every rule carries a clinical author and version — the trace row is designed for it; today it shows only rule id and observed trigger, and we say so. Versioning with changelogs. Per-site enablement: a health system turns each rule on deliberately, never by default. Staged rollout: new rules run in shadow mode first — evaluated silently, would-have-fired rates measured before a clinician ever sees a card. Measurement per §15 of the design spec: adjudicated appropriate acceptance and appropriate override — because CDS-01/CDS-02 show raw override rate is uninterpretable — plus downstream action and burden; rules that fail get retired. A governed global silence budget across a whole patient panel is on the same list; the POC implements per-card cooldowns only.

**Plain:** Today it's four rules we wrote by hand. At scale, every rule gets an author's name, a version, and a report card — and each hospital switches rules on deliberately. New rules run silently first, so we know how often they'd fire before any doctor sees one. Rules that annoy more than they help get retired.

**Q17: What breaks first at scale?**

**Technical:** Named, and labeled HYPOTHESIZED per our limits discipline. Signal extraction: regex keyword classes must become real clinical NLP, running in-tenant to preserve the raw-text boundary. Nudge budgets: per-card cooldowns exist, but a global silence budget across a 20-patient day does not. Wayfinding maps per site and per EHR version. WATCH at scale: a real deadline/result monitor with off-hours escalation — today WATCH records an owner and a due date and monitors nothing, and the card says so on screen. And per-rule measurement. None of this is demonstrated by the rig.

**Plain:** Five things, and we name them: smarter reading of notes; a budget so twenty patients don't mean twenty nudges; directions learned for each hospital; a real follow-up monitor — today's watch card is a sticky note, not an alarm clock; and per-rule scorekeeping. All hypothesized. None demonstrated.

**Q18: Why the browser first?**

**Technical:** The browser was the fastest honest substrate: one local origin gives cross-tab events with zero install, and it forced the right disciplines from hour one — derived signals, user activation for navigation, same-origin boundaries. The presence layer is deliberately transport-independent: the same engine renders as a dock orb or a cursor companion today, a browser extension against real portals next, an OS-level overlay after that. The moat is presence at the point of attention; the transport is whatever reaches it on a given machine.

**Plain:** The browser let us build the honest version in one day — no installs, nothing leaves the machine. But the buddy is a presence, not a website. Same brain, new bodies: extension, desktop overlay, and eventually glass.

---

## 5 · Scalability — hardware

**Q19: What is the touch-glass overlay?**

**Technical:** A design-stage concept, stated plainly up front: zero hardware has been built. The idea: a slim capacitive touchscreen panel physically mounted over a legacy monitor — a CRT or an old LCD — driven by a small companion computer that renders the buddy layer (cards, wayfinding highlights) on the glass and passes touches through to the underlying machine's existing input path. The legacy device's own software is never modified, intercepted, or altered; the overlay adds a guided layer on top of a screen no IT department will ever replace. Same engine, same event taxonomy — only the sensing (what the companion computer observes) and the surface (glass instead of DOM) change.

**Plain:** Picture a thin touch-glass sheet over the old monitor nobody will ever replace, with a small computer drawing the buddy on it and passing your taps through. The old machine never knows it's there. And to be clear: this is design on paper — we have built zero hardware, and we say that first.

**Q20: Why hardware at all?**

**Technical:** Because the installed base is the market the software path cannot reach: ultrasound carts, lab terminals, medication dispensing stations, embedded boxes with locked OS images — no browser, no APIs, replacement cycles measured in decades. Our thesis — value comes from presence at the point of attention — holds everywhere, but on closed devices, presence physically requires glass. And TIME-03's cross-system variance suggests navigation burden is worst exactly where the tooling is oldest.

**Plain:** Hospitals run on machines nobody is allowed to upgrade — ultrasound carts, lab terminals, the med-dispensing station. No apps, no browser, no help coming. If the buddy's job is to stand where the doctor's eyes are, on those machines the only way in is a layer of glass.

**Q21: What's the staged path from here to there?**

**Technical:** Three stages, each independently useful. Stage one, the browser layer: shipped today, works wherever clinical work is web-based. Stage two, an OS-level desktop overlay: a native companion drawing over any application window — same engine, richer signals such as window focus. Stage three, the hardware overlay for truly closed devices: design-stage only. Every stage reuses the nudge engine, taxonomy, honesty rails, and autonomy contract unchanged; stages differ only in how events are sensed and where cards render.

**Plain:** Three steps. Today: the browser — shipped. Next: a desktop layer that works over any program. Last: the glass, for machines that allow nothing else. Same buddy at every step — we just keep finding it new places to stand.

**Q22: Isn't overlaying hardware on a clinical device a regulatory minefield?**

**Technical:** Potentially, and we treat it as one. The binding design constraint is passthrough-only: the overlay never intercepts, alters, or occludes the device's own display or controls and never sits in the device's control loop — it advises the human, exactly like the software buddy. Whether a specific mounting on a specific device class crosses into device regulation is a determination we would make with regulatory counsel before any pilot; we assert nothing here. Design-stage only, zero hardware built, nothing anywhere in this project cleared for clinical use.

**Plain:** We take that seriously — glass near a clinical machine is not a casual accessory. The rule is: it may never touch or block what the device itself shows or does; it only advises the human. Regulatory counsel goes first, before any pilot. Today it's a drawing, not a device.

---

## 6 · ROI — calculations judges can check

> Full scaling ladder — per patient → clinic → community of 100,000, plus long-term and
> hardware lanes: `docs/ROI_MODEL.md`. Same rules: lanes never sum, every assumption numbered.

**Q23: Show me the time math.**

**Technical:** Inputs first, each labeled. TIME-01 (tier B, 2020; 2018 Cerner Millennium logs, ~100M encounters): 16 min 14 s of EHR time per encounter, 33% of it chart review → 5 min 21 s of review per encounter. TIME-06 (tier C, 2021, n=12 — twelve Stanford gastroenterology physicians answering standardized referral-packet questions, and we say that n out loud): 18% review-time reduction. A1: that 18% transfers to encounter chart review — HYPOTHESIZED; different task, different tool, twelve people. A2: 20 encounters per clinician-day. Arithmetic: 321 s × 0.18 ≈ 58 s per encounter × 20 ≈ 19 minutes per clinician-day. A3: any pricing uses a clinician-hour opportunity value — at an assumed $150/hour, ~19 min ≈ $48 per clinician-day; this sits in the capacity/opportunity lane only and is never summed with other cost lanes. Cost bases, not promised savings — a prospective study would have to earn these.

**Plain:** Published logs say a visit costs sixteen minutes of screen time, a third of it hunting through the chart. One small study — twelve doctors, we say so — cut review time eighteen percent. If that held here, and that's an assumption, it's about nineteen minutes back per doctor per day. Cost bases, not promised savings — a prospective study would have to earn these.

**Q24: What's the no-show math behind the WATCH card?**

**Technical:** The base: COST-07 (tier C, 2016 publication; $196 per no-show, 2008 USD, VA outpatients — construct: opportunity cost, unadjusted for inflation). The mechanic: WATCH records referral ownership and a due date; the demo runs no monitor, so it demonstrably prevents zero no-shows today. The checkable shape: A4 — avoided no-shows per month is a pure assumption with no demonstrated basis; at an assumed 25 per month for a clinic, 25 × $196 ≈ $4,900 per month, in 2008 VA dollars (A5: converting to current dollars is a further assumption we have not made). Directional context only: COST-08 (tier C, 2021) — a palliative clinic's reminder-call program, a different intervention, moved no-shows from 11.8% to 6.9%, about $79,200 per year on a 2016-USD opportunity basis. Cost bases, not promised savings — a prospective study would have to earn these.

**Plain:** A missed appointment cost the VA about a hundred ninety-six dollars — 2008 dollars, their clinics, their math. Our watch card gives every referral an owner and a due date, but today it prevents exactly zero no-shows, because the monitor isn't built. If a pilot showed it prevented, say, twenty-five a month, that's about forty-nine hundred a month in that old currency. Cost bases, not promised savings — a prospective study would have to earn these.

**Q25: And the nutrition numbers?**

**Technical:** Two lanes, kept apart. Program-cost lane: COST-05 (tier C, 2021; modeled from 27 trials, n=6,803, hospitalized patients): in-hospital nutrition costs $6.23 per patient-day, and the same model outputs $2,818 per patient — MODELED is the pack's own label, not observed, and it is a hospitalized population, not our ambulatory demo. Cost-of-illness lane: COST-02 (tier B, 2022; 2018 USD): Medicare cancer patients with malnutrition incurred mean ED claim costs of $10,724 vs $4,935 — an association; cost-of-illness is never achievable savings absent prospective causal evidence, by the pack's rule. The nudge's honest claim is process only: the plan named no nutrition owner, and now a human decided. Cost bases, not promised savings — a prospective study would have to earn these.

**Plain:** Hospital nutrition support costs about six dollars a day, and one model — a model, not a measurement — puts twenty-eight hundred dollars per patient at stake. Malnourished cancer patients also run double the ER costs, but that's an association, not money you can bank by nudging. Our card claims one thing: the plan forgot nutrition, and now a human decided. Cost bases, not promised savings — a prospective study would have to earn these.

**Q26: Why not add those up into one ROI number?**

**Technical:** The evidence pack forbids it, and the pack is right. Its display rule keeps four cost lanes separate — program cost, capacity/opportunity value, cost-of-illness association, reimbursement — because they are different constructs, in different dollars, from different populations and years (2008, 2012, 2016, and 2018 USD in the bases above). Summing a modeled saving with an opportunity value with an association double-counts and launders construct error into a confident total. The same boundary discipline binds every card: relative risks are never rendered as one patient's individual probability, a quoted guideline line never transfers authority to a different population, and UNVERIFIED stays UNVERIFIED. Every number we show carries its id, tier, year, and lane — which is exactly what makes them checkable.

**Plain:** Because they're different kinds of money, from different years, from different patients. Add a model to an association to an hourly value and you get a big number and no truth. We'd rather hand you three small honest numbers you can check than one big one you can't.

**Q27: So what ROI would you actually defend today?**

**Technical:** As savings: none — NUDG MD has zero outcome evidence and zero deployments. What we defend is a cost structure and a measurement plan. Cost structure: the trigger layer is free deterministic evaluation; AI depth costs cents per explicit request (illustrative: quick ~$0.01, panel ~$0.30–0.60). Measurement plan, per §15: adjudicated appropriate acceptance and appropriate override, time-to-information, downstream action completion, and burden — measured in a pilot before anyone models dollars. The pack's cost bases tell us where dollars could live; a prospective study decides whether they do.

**Plain:** Today? None — and anyone quoting a savings number for a one-day-old demo is guessing. What we can defend is the cost side — nudges cost cents — and the exact list of what a pilot must measure first. The dollars come after the study, not before.

---

## 7 · AI specifics

**Q28: Which models, and why those?**

**Technical:** Three, matched to jobs. Quick lane: Claude via the Anthropic Messages API from the local relay (default model `claude-sonnet-5`, env-configurable, 500-token cap) — chosen for ~2 s conversational latency under a strict grounding contract: 120 words maximum, ending with a "Basis:" line listing the chart facts used, validated server-side. Panel lane: GPT via the local codex CLI — two to four isolated, read-only, ephemeral subprocesses returning strict JSON — chosen because it exercises true context isolation cheaply, at a 1–2 minute latency we disclose on screen. And Santiago's standalone gyn-onc second-opinion agent runs `claude-fable-5` with a server-side refusal fallback to Opus 4.8, live-fetches public-domain NCI PDQ guidelines with a URL/timestamp/content-hash audit log — and its README status is quoted, not softened: "prototype under quarantine review — published for provenance by team decision (2026-07-18), NOT as a working capability. It has not run end to end."

**Plain:** A fast model for quick answers — about two seconds, and it must show which chart facts it used. A slower panel of four sealed reviewers for hard questions — a minute or two, and the screen tells you it's thinking. And Santiago built a deep oncology second-opinion agent that we published under quarantine, problems listed, because it hasn't run end to end yet. We'd rather show you the review findings than a demo we can't stand behind.

**Q29: The panel is one model in four contexts. Isn't that fake diversity?**

**Technical:** It's disclosed diversity of context, not of weights — and the receipt says so on screen: "one model per lane, contexts isolated." Isolation buys something real even within one model: no seat can anchor on another seat's answer, each lens gets its own prompt, and failure is independent — one unparseable seat downgrades the whole run to scripted rather than fabricate a seat. Cross-model seats are the designed next step (the design doc already poses a mixed GPT-and-Claude bench), and the aggregate contract — support counts, refusal on missing data — is independent of how many model families sit down.

**Plain:** Today it's one model asked four separate times, in four sealed rooms — and the receipt on screen says exactly that. Sealed rooms matter: no seat can copy another's answer. Different models in the seats is the next step. The honesty label is already there.

**Q30: Why show scripted answers at all? Explain the latency chips.**

**Technical:** It's a design position, not a workaround: real deliberation takes time — quick ~2 s, panel 1–2 minutes — and the UI never pretends otherwise. The scripted answer paints instantly under the chip "SCRIPTED · LIVE LANE DELIBERATING…"; the live result replaces it in place with a served-mode chip and a latency receipt in milliseconds; a missing, failed, or cancelled lane leaves the scripted fallback still labeled scripted — provenance never silently upgrades. Closing the buddy cancels the live run and the relay terminates the codex process group — no hidden paid work — with one disclosed caveat: an already-sent HTTPS request may finish server-side.

**Plain:** We could fake an instant answer — everyone at a hackathon can. Instead the screen says "scripted, live lane deliberating," and when the real answer lands, it shows its stopwatch. If the live lane dies, the label stays scripted. The label never lies — that's the whole design.

**Q31: Why deterministic rules instead of an LLM watching everything?**

**Technical:** Four reasons, then the roadmap. Cost: watching is continuous — rule evaluation on events is effectively free, while an always-on LLM meters every keystroke; our ethos is cents per event, spent only on request. Auditability: every card resolves to an observed event plus a rule id you can replay; model attention resolves to nothing inspectable. Privacy: rules run on derived signals — an ambient LLM would need the raw note stream, which our transport strips by contract. Predictability: same input, same nudge; cooldowns and supersession behave identically on every run, which is what clinical safety review needs. Roadmap: rules stay the trigger layer; LLMs deepen the content layer — on request, labeled, sourced, and refusable.

**Plain:** Four reasons. Watching with an AI costs money every second; rules cost nothing. Rules can be audited — ask why it fired and you get a real answer. Rules don't need to read the note, just the breadcrumbs. And rules behave the same every time. The AI adds depth when you ask; the tripwire stays simple.

**Q32: How would you evaluate whether this actually helps?**

**Technical:** Override rate alone is invalid, and the literature says so: CDS-01 shows ~90% overrides overall and CDS-02 shows appropriateness ranging 29.4%–100%, so a low override rate can mean good nudges or cowed clinicians. The §15 plan: adjudicated appropriate acceptance and appropriate override; downstream action completion — did the referral, the recheck, the reconciliation actually happen; burden — nudges per clinician-day, interruption time, repeats-after-dismissal; and time-to-information for wayfinding. Status, plainly: the POC stores global shown/evaluated counters only; none of those four metrics is implemented yet.

**Plain:** You can't grade this by how often doctors say no — sometimes no is the right answer. We'd grade whether accepts and dismissals were each appropriate, judged by clinicians; whether the follow-through actually happened; and how much attention it cost. Today we only count how often cards fired. The real scoreboard isn't built yet, and we say so.

**Q33: What's your regulatory posture?**

**Technical:** Designed toward FDA's non-device CDS criteria: it supports rather than replaces clinician judgment — no autonomous action, explicit human decisions, drafts that never send themselves — and the basis of every recommendation is transparent and inspectable: sources on the card, "Why this, why now" traces with rule ids, evidence limits displayed on the card itself. And plainly: we would confirm the classification with counsel; nothing here is cleared for clinical use; every surface carries "SYNTHETIC — NOT FOR CLINICAL USE"; no claim of clinical outcomes or diagnostic performance is made anywhere in this repo.

**Plain:** The design aims at the category regulators treat as decision support: the doctor decides, and the doctor can always see why the tool suggested what it did. But we're not lawyers, and we'd confirm with people who are. Nothing here is cleared for use on a real patient, and every screen says so.

---

## 8 · Business & moat

**Q34: What's the moat?**

**Technical:** Three layers that compound. Presence at the cursor: the nudge renders where attention already is — dock orb or cursor companion, across both tabs at once — while the default industry answer is another dashboard that competes for attention. Cross-system wayfinding: per-deployment learned maps of where things live in each EHR; TIME-03's nine-fold variance means those maps are accumulating assets, not config files. And the honesty layer as brand: labels, receipts, refusals, UNDERDETERMINED — in clinical software, demonstrated honesty compounds into switching-cost-grade trust.

**Plain:** Three things. We live where the doctor's eyes already are — everyone else builds another screen to check. We learn the maze of each hospital's systems, and those maps compound. And we never lie on screen. In medicine, that reputation is the moat.

**Q35: How do you relate to Abridge — aren't you competing with your host?**

**Technical:** Complement, not competitor, and structurally so: the scribe writes the note; the buddy cross-checks the note's conclusions against the chart and walks the clinician to the proof — Scenario 1 is exactly that division of labor. An ambient scribe's output is our best input signal: today as derived in-tab keyword classes, in production as a partner integration; nothing we build documents visits. Our scribe app is demo staging only — no Abridge code, assets, endorsement, or affiliation, as the README states. And the category they created, ambient clinical AI, is precisely what makes a cross-checking companion sensible now. It's their event; we're glad to build beside them.

**Plain:** Abridge writes the note; we check the note against the chart and walk you to the proof. A great scribe makes our buddy more useful, not less. We'd rather be the second set of eyes next to their product than a competitor to it — and it's their stage tonight.

**Q36: Who pays, and why?**

**Technical:** Health systems, on two budget lines they already fund. Clinician time: chart-review minutes shaped by the TIME-01/TIME-06 bases — bases, unproven for us — where EHR-time reduction is already a board-level purchase. And coordination follow-through: referrals and results with named owners and deadlines — the WATCH mechanic — where dropped handoffs cost real money and quality scores. The unit economics hold: deterministic triggers are free, AI depth costs cents per explicit request, so per-clinician pricing carries margin without metering a doctor's curiosity.

**Plain:** Hospitals already pay for two things: getting doctors' time back, and making sure follow-ups don't fall through the cracks. We sell both. The running cost is cents, because the AI only works when asked. The health system buys it; the doctor just gets a buddy.

**Q37: What's fake today? The whole list.**

**Technical:** The full list, plainly. Five scripted synthetic patients. Both apps are look-alikes we wrote ourselves. Note signals are regex-derived keyword classes, not clinical NLP. The scribe's ask-panel answers are scripted. Panel seats are one model in four isolated contexts, disclosed on the receipt. Demo pacing: the depth prompt fires after 8 seconds of stillness instead of 90. WATCH records an owner and a due date but runs no monitor. Per-rule metrics don't exist — only global shown/evaluated counts. The design gallery's charts and calculations are illustrative artifacts. The oncology evidence template is non-live. Santiago's agent is quarantined and has never run end to end. There is no real EHR integration. The hardware overlay is a drawing. There is zero outcome evidence. What's real is also a list: the rules, the cards, the cooldowns, the jump, the draft-and-watch flow, the sanitized bus, the relay, and every label — all of it runs live.

**Plain:** Fake today: the patients, both apps, the instant panel answers, and every dollar figure — those are bases, not results. The watch card doesn't actually watch yet, and the oncology agent stays quarantined until it earns trust. Real today: the rules, the cards, the jump, the labels — everything you clicked. We'd rather lose points for honesty than win them for theater.
