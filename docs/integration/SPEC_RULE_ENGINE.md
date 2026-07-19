# Formal Specification — NUDG Rule Engine

Subsystem 2 of 2: the deterministic nudge engine `shared/nudges.js` — its state space,
its four rules (R-01, R-04, R-09, R-12 with the referral two-step), card lifecycle
(claims, cooldowns, supersession), cross-tab mirroring, the safety theorem over its full
action repertoire, timing constants, worked traces, and observed discrepancies.

Ground truth (line citations; repository root `/Users/pablo/Desktop/Summer 2026/nudg-md/`):

| Abbrev | File | Lines |
|---|---|---|
| ENG | `shared/nudges.js` | 923 |
| BUS | `shared/bus.js` | 78 |
| BUD | `shared/buddy.js` | 435 |
| EHR | `ehr/app.js` | 530 |
| SCR | `scribe/app.js` | 485 |

This document consumes, by reference, the Event-Fabric specification
(`agentB_spec_event_fabric.md`): its alphabet D2, sanitizer D3, privacy invariant INV5,
delivery theorem T1, ordering L2, run-to-completion SF6, and staged-command results
T4/L5/L6. Wherever an imported invariant is *used* in a proof below, its full statement
is restated at the point of use, per the specification discipline of this document set.

---

## 0. Notation

- An **engine instance** N_d is the evaluation of ENG's IIFE in document d. Guard:
  ENG:8 (`window.__nudgEngineLoaded`, requires `NudgBus` and `NudgBuddy`); gallery
  documents abort (ENG:11–12). APP(N_d) ∈ {"ehr", "scribe"} is computed at ENG:11 by
  title inspection (see DX-02).
- Events are the fabric's records e = ⟨ts, app, type, detail⟩; d abbreviates e.detail
  inside handler text, matching ENG:790.
- The **receive-history** H_d(t) is the sequence of events delivered to N_d's bus
  handler (registered ENG:789) up to local time t, in delivery order (fabric T1/L2:
  same-document emissions arrive synchronously in emission order; remote emissions
  arrive per-sender FIFO; cross-sender order adversarial).
- clk — `Date.now()` of the hosting document.
- CardId strings: `r01:m`, `r04:m`, `r09:m`, `referral-draft:m`, `r12:m` for MRN m.
- Definitions D𝑛, invariants INV-N𝑛, design laws DL𝑛, lemmas L-𝑛, theorems T-𝑛,
  worked traces TR-𝑛, discrepancies DX-𝑛. Every lemma has a proof or the marker
  CONJECTURE with what is missing.

---

## 1. State space

**D1 (Engine state record).** The volatile state of N_d is the record:

| Component | Type | Init | Decl |
|---|---|---|---|
| APP | {"ehr","scribe"} | title-derived | ENG:11 |
| PATIENTS | Patient[] | [] until boot fetch | ENG:32, 915–922 |
| byMrn | Map⟨MRN, Patient⟩ | ∅ | ENG:33, 919 |
| cards | Map⟨CardId, Card⟩ | ∅ | ENG:34 |
| tabViews | Map⟨MRN, ⟨{tab: TabName, ts: EpochMs}⟩*⟩ | ∅ | ENG:35 |
| noteSignals | Map⟨MRN, {impressions: string[], topics: string[]}⟩ | ∅ | ENG:36 |
| lastTabByMrn | Map⟨MRN, TabName⟩ | ∅ | ENG:37 |
| dwellTimer | TimerHandle ∪ {null} | null | ENG:38 |
| peekTimer, peekShowTimer, peekEl | timer/DOM | null | ENG:39, 468–469 |
| panelCard | Card ∪ {null} | null | ENG:40 |
| activeMrn | MRN ∪ {null} | null | ENG:41 |
| pendingHandoff | {commandId, cardId, card, expiresAt} ∪ {null} | null | ENG:42 |
| handoffTimer, commandCleanupTimer | TimerHandle ∪ {null} | null | ENG:43–44 |
| panelLane | {"quick","panel"} ∪ {null} | null | ENG:563 |
| panelRun | ℕ (monotone) | 0 | ENG:564 |
| activeRelay | {runId, controller} ∪ {null} | null | ENG:565 |
| laneHealth | {ts, claude, codex} ∪ {null} (60 s cache) | null | ENG:641–651 |
| INSTANCE_ID | string (uuid) | minted at load | ENG:26 |

TabName = {summary, problems, meds, allergies, labs, notes, orders} (EHR tab ids,
EHR:175–216). Patient records come from `/data/patients.json` (ENG:915–922); the engine
stays inert without them ("engine stays quiet without data", ENG:922).

**D2 (Persisted stores — localStorage, origin-shared by all engine instances).**

| Key | Shape | Writers | Readers |
|---|---|---|---|
| `nudg_cooldowns` | {cardId: {until: EpochMs, level: 1..3}} | ENG:54–58 (dismiss), ENG:901 (reset to {}) | ENG:50–53 |
| `nudg_claims` | {cardId: EpochMs} | ENG:81–84, ENG:902 (reset) | ENG:81–82 |
| `nudg_metrics` | {evaluated: ℕ, shown: ℕ} | ENG:60–65, ENG:903 (reset) | ENG:61 |
| `nudg_referral_drafts` (REFERRAL_STATE_KEY, ENG:25) | {mrn: {status: "draft"∨"simulated_sent", createdAt?, updatedAt?, simulated: true}} | ENG:207–209, 339–346, 351–354, 904 | ENG:48, 172–173 |
| `nudg_pending_ehr_command` | fabric D9 | ENG:269, 271, 280, 871, 878, 899 (removals/writes) | EHR:432, 493 |
| `nudg_demo_mode` | "0" disables demo pacing | (external) | ENG:15 |

Because these stores are origin-shared, cooldowns, claims, metrics, and referral state
are **global across tabs**, while `cards`, `tabViews`, `noteSignals`, `lastTabByMrn`,
`activeMrn` are **per-instance**. Every cross-tab agreement about cards is achieved by
event mirroring (§8), never by sharing the cards Map.

**D3 (Card record).** A card is
{id, rule ∈ {R-01, R-04, R-09, R-12}, type ∈ {chart, nav, depth, watch} (ENG:68–73),
tempo ∈ {NOW, FOCUSED, DEEP, WATCH, DRAFT}, mrn, name, headline, bullets?, steps?,
alts?, frame?, research?, specialists?, question?, quickScripted?, seats?,
followUpReview?, actions: {id, label, kind}[], why}. Construction sites: R-01 ENG:112–126,
R-04 ENG:141–151, R-09 ENG:175–200, referral-draft ENG:210–222, R-12 ENG:229–241.

---

## 2. Event intake

**D4 (Intake relation).** N_d's single bus handler (ENG:789–912) is a case switch.
Exhaustive table — condition column gives the guard exactly as coded; an event failing
its guard leaves the state unchanged (`break`).

| Event | Guard | State updates and calls | Lines |
|---|---|---|---|
| note_signals | (none for the map write) | noteSignals[m] ← {impressions ∥ [], topics ∥ []}; if APP="scribe": evalR01(m) | 792–795 |
| encounter_selected | APP="scribe" ∧ evt.app="scribe" | activeMrn ← d.mrn ∥ null; panel exit if mismatch, else re-render; hidePeek | 796–803 |
| ehr_tab_viewed | APP="ehr" | lastTabByMrn[m] ← d.tab **unconditionally** (806); then if ¬d.user: break (807); else push {tab, ts: clk} to tabViews[m] (808–810); evalR04(m) (811); if activeMrn=m: armR09(m) (812) | 804–814 |
| ehr_patient_opened | APP="ehr" ∧ evt.app="ehr" | supersede r04 of previous activeMrn (chart_switched) (817–819); activeMrn ← m (820); tabViews[m] ← [] (821); panel exit if mismatch else render (822–823); hidePeek (824); armR09(m) (825) | 815–826 |
| ehr_chart_closed | APP="ehr" ∧ evt.app="ehr" ∧ (¬d.mrn ∨ activeMrn=m) | activeMrn ← null; clear dwellTimer (830–831); tabViews.delete(m); supersede r04 (chart_closed) (833–835); hidePeek; panel exit ∨ render | 827–840 |
| ehr_document_opened ∣ ehr_note_filed ∣ ehr_orders_signed | APP="ehr" | tabViews[m] ← [] (845); supersede r04 (no reason) (846); if activeMrn=m: armR09(m) (847) | 841–848 |
| nudge_acted ∣ nudge_dismissed ∣ nudge_superseded | evt.app="buddy" ∧ d.origin ≠ INSTANCE_ID ∧ cards.has(d.id); for acted additionally d.action ∈ {open_rhythm, show_me, start_referral, simulate_send, discard_referral, acknowledge} (853) | mirror-remove: cards.delete(d.id); exitPanel if showing; render; hidePeekFor | 849–859 |
| referral_drafted | APP="ehr" ∧ evt.app="buddy" ∧ d.origin ≠ INSTANCE_ID | referralDraftCard(m) | 860–862 |
| referral_simulated_sent | same gates | fireR12(m) | 863–865 |
| ehr_command_ack | APP="scribe" ∧ evt.app="ehr" ∧ pendingHandoff ∧ d.commandId = pendingHandoff.commandId | fabric §6.3: late-ack refusal (868–874); ok ⇒ deferred nudge_acted (881) + card removal; ¬ok ⇒ retain card | 866–888 |
| demo_reset | (none) | clear cards/noteSignals/tabViews/lastTabByMrn; clear all timers; pendingHandoff ← null; remove staged command; activeMrn ← null; reset the four shared stores; exitPanel; hidePeek; render | 889–908 |
| (all other Σ) | — | no case: state unchanged | 909–910 |

Note the app-field gates: `encounter_selected` and `ehr_patient_opened`/`ehr_chart_closed`
require the *emitting app* to match (797, 816, 828) — engine-emitted or foreign
same-type events cannot move `activeMrn`. `ehr_tab_viewed` and the
document/file/sign triple check only the *hosting* APP (805, 844).

---

## 3. Card lifecycle

**D5 (commit).** `commit(card)` (ENG:75–91): if cards.has(card.id) ∨ coolingDown(card.id)
⇒ no-op (76). Else: cards[card.id] ← card (77); metrics.shown += 1 (78, 60–65);
renderCards (79); **claim step** — with claims = store("nudg_claims"): if no claim for
card.id or the claim is older than 15 000 ms (82), write claims[card.id] ← clk (83–84)
and emit `nudge_committed` {id, rule, mrn, headline} (85); **presence step** — if
activeMrn = card.mrn: screen-reader announcement (88, BUD:271–277) and peek (89, §3.4).

**D6 (removeCard).** `removeCard(id, outcome, detail?)` (ENG:93–101): delete from cards;
exitPanel if the panel was on this card (97); render; if outcome ≠ null: emit outcome
event (`nudge_dismissed` ∣ `nudge_superseded`) with {id, rule, mrn, origin: INSTANCE_ID}
∪ detail (99); hide the peek for id (100).

**D7 (dismissWith).** (ENG:367–370): startCooldown(card.id) **then**
removeCard(id, "nudge_dismissed", {reason}). Reasons are the three menu strings
(ENG:426). Dismissal is the **only** cooldown writer.

**D8 (Cooldowns).** coolingDown(id) ⇔ ∃c = store.nudg_cooldowns[id] ∧ clk < c.until
(ENG:50–53). startCooldown(id): level ← min(prev.level + 1, 3);
until ← clk + 86 400 000·level (ENG:54–58) — 24 h, 48 h, 72 h, capped. Levels never
decay (DX-10); demo_reset erases the store (ENG:901).

**INV-N1 (Per-instance card uniqueness).** For each engine instance and each CardId,
at most one live card exists at any time. *Proof.* cards is a Map keyed by id; the only
insertion is ENG:77, guarded by ENG:76's `cards.has` check. ∎

**L-AMO (At-most-once per (rule, mrn, window)).** Fix rule r, MRN m, id = r:m.
(i) While a card with id is live in instance N, no second commit of id occurs in N
(INV-N1). (ii) After a **dismissal** anywhere in the origin, no commit of id occurs in
any instance until the cooldown expires (24 h·level). (iii) After an **acted** or
**superseded** removal, re-commit is immediately possible.
*Proof.* (i) INV-N1. (ii) Restating D8 at its use site: coolingDown consults the
origin-shared localStorage record written by the dismissing instance; ENG:76 blocks
commit in every instance reading the same store (fabric SF4: localStorage is same-origin
shared, synchronous). (iii) By inspection, `startCooldown` is called only at ENG:368;
the acted paths (ENG:331, 335, 347, 361, 882) and superseded paths (ENG:818, 834, 846)
call removeCard without it. ∎
Clause (iii) is by design for R-04 (its why-string promises "leaves on its own once you
open anything", ENG:150) and is load-bearing for DX-07 (R-01 re-fire).

**D9 (Claims).** The claim table dedupes only the `nudge_committed` *announcement*
across instances (15 s freshness window, ENG:82); it does not gate rendering (comment
ENG:80: "First tab to claim the id announces it; others render silently from the
claim"). Claims are cleared only by demo_reset (ENG:902).

**D10 (Metrics).** `nudg_metrics.evaluated` increments at evalR01 entry (ENG:106),
evalR04 entry (ENG:131), and inside the R-09 dwell callback after gates f1–f2 (ENG:165).
`shown` increments per successful commit (ENG:78). Global counters only; per-rule
accounting does not exist (agrees with `docs/design/NUDGE_CARDS_DESIGN.md` §5's caveat;
asymmetry flagged as DX-04).

**3.4 Peek.** showPeek (ENG:496–523): suppressed when the popover is open (497);
placement (511–513): W = 296, anchored to the buddy anchor rect a,
left = clamp(a.left − W + a.width, 12, innerWidth − W − 12),
top = a.top − H − 10 if a.top > H + 20 else min(a.bottom + 10, innerHeight − H − 12);
show-class after 20 ms (517–519); orb bloom (520); auto-hide after PEEK_TTL_MS = 14 000
(521–522). The peek's primary button runs `card.actions[0].id` (ENG:489). Any popover
open (orb, cursor, Shift+P) stands the peek down via MutationObserver on `#nudgPop`
class (ENG:534–536). Rendering is patient-scoped: renderCards displays only cards with
mrn = activeMrn; others are counted as "held" (ENG:439–447) — **INV-N5**: the visible
card set is {c ∈ cards : c.mrn = activeMrn}, and the badge count equals its size
(ENG:442, BUD:433).

---

## 4. Rule R-01 — conflicting impression (chart check)

**D11 (R-01 LTS).** States: ⟨noteSignals[m], cards has r01:m?, cooldown r01:m?⟩.
Input: `note_signals` events (fabric D2 #9; emitted only by the scribe, SCR:420–422,
from the derivation Δ — fabric D6). Transition (intake row 1 + ENG:105–127): on
note_signals for m, in the scribe-hosted instance only (ENG:794), evaluate:

| # | Guard conjunct | Line | On false |
|---|---|---|---|
| g1 | byMrn.has(m) | ENG:107, 109 | return (silent) |
| g2 | noteSignals.has(m) | ENG:108–109 | return — vacuous at this call site: ENG:793 wrote it in the same task (fabric SF6 restated: the handler runs to completion; nothing intervenes between 793 and 794) |
| g3 | "anxiety" ∈ sig.impressions | ENG:109 | return |
| g4 | ∃x ∈ p.problems : /atrial fibrillation/i.test(x) | ENG:110 | return |
| g5 | ¬cards.has("r01:"+m) | ENG:76 | commit no-op |
| g6 | ¬coolingDown("r01:"+m) | ENG:76 | commit no-op |

**Short-circuit truth table** (evaluation order g1…g6; F at a row's conjunct with all
earlier conjuncts T):

| g1 | g2 | g3 | g4 | g5 | g6 | Fire? |
|---|---|---|---|---|---|---|
| F | – | – | – | – | – | no |
| T | F | – | – | – | – | no (unreachable from live intake; reachable only if evalR01 were called outside the handler — it is not: sole call site ENG:794) |
| T | T | F | – | – | – | no |
| T | T | T | F | – | – | no |
| T | T | T | T | F | – | no |
| T | T | T | T | T | F | no |
| T | T | T | T | T | T | **commit r01:m** |

**T-R01 (Firing condition).** In the scribe-hosted instance, a card r01:m is committed
at time t iff the last `note_signals` event for m delivered at t has
"anxiety" ∈ impressions, patient m exists with an AF problem, and g5 ∧ g6 hold at t.
*Proof.* The sole commit site for id r01:m is ENG:112; the sole call of evalR01 is
ENG:794, guarded by APP = "scribe"; conjuncts as tabulated; delivery order by fabric
T1. ∎

Card content (ENG:112–126): type chart, tempo FOCUSED, actions
[open_rhythm (primary), dismiss]; the why-string embeds the patient's first name and
rule id (ENG:125). `open_rhythm` initiates the fabric's cross-tab handoff protocol
(fabric §6.3; dispatch tree ENG:297–328) — the card is removed only on a timely
successful `ehr_command_ack` (ENG:879–883), keeping the card for retry on failure.

**TR-R01 (worked trace, scribe instance; Okafor = m, AF in problems).**

| t | event / act | noteSignals[m] | cards | notes |
|---|---|---|---|---|
| 0 | encounter_selected m | — | ∅ | activeMrn ← m (798) |
| 1 | note_generated m; renderNote schedules Δ (SCR:248) | — | ∅ | |
| 1.7 | note_signals {[],[]} (Δ = (0,0)) | {[],[]} | ∅ | g3 F |
| 40 | user types "…likely anxiety…"; debounce 700 ms | {[],[]} | ∅ | |
| 40.7 | note_signals {["anxiety"],[]} | {["anxiety"],[]} | ∅→{r01:m} | g1–g6 T ⇒ commit; shown += 1; claim + nudge_committed; peek (activeMrn = m) |
| 41 | note_signals identical content typed again | unchanged | {r01:m} | **no event**: SCR:417–419 dedup (lastSignals) — the "no second card" behavior of docs/TESTING.md:37 is enforced in the emitter, not the engine (DX-07) |

---

## 5. Rule R-04 — wayfinding (the hunting doctor)

### 5.1 The design law

**DL1 (Where vs. did — provenance separation).** *Location state is provenance-blind;
activity state is provenance-sensitive.* In the `ehr_tab_viewed` handler,
`lastTabByMrn.set(d.mrn, d.tab)` executes **before** the provenance guard:
ENG:806 (with comment "track where the doctor is, even for programmatic changes")
precedes ENG:807 (`if (!d.user) break;` — "programmatic tab changes never count as
hunting"). The provenance bit is minted at the single emitter EHR:164
(`user: !!(opts && opts.user)`, comment EHR:161–163) whose call sites are:
user = true only from the chart-tab click handler (EHR:473–477); user = false from
`openChart` (EHR:142) and from the buddy walkthrough `openDocFromBuddy` (EHR:396).
Justification (proved consequences): R-09's fire-time gate asks **where** the doctor is
resting and must be correct even after machine navigation (T-R09-GATE, §6); R-04's
evidence asks **what the doctor did** and must count only human acts (T-R04-B). §9
exhibits the failure of each direction when the separation is collapsed — the
regression that motivated it.

### 5.2 Windowing, exactly as coded

**D12 (View list and pruning).** On each user-provenance view for m, the instance
appends {tab, ts: clk} (receive-time, not evt.ts) to tabViews[m] (ENG:808–810) and calls
evalR04(m) (811). evalR04 (ENG:130–152) prunes: views ← ⟨v ∈ tabViews[m] :
clk − v.ts < 40 000⟩, written back (135–136); distinct ← |{v.tab}| (137); the window is
therefore a **sliding 40 s look-back, evaluated at user-view instants, pruned in place
at each evaluation** (strict inequality: a view exactly 40 000 ms old is evicted).
Reset boundaries erase the list wholesale: patient open (ENG:821), document open / note
filed / orders signed (ENG:845), chart close (delete, ENG:832), demo_reset (ENG:892).

**INV-N3 (List contents).** At every point, tabViews[m] contains exactly the
user-provenance views of m received since the last reset boundary for m, minus those
evicted by a prune at some evaluation instant (all of which were ≥ 40 s old at that
instant). *Proof.* Induction over the intake relation D4: the only writers of
tabViews[m] are the append (810, guarded by d.user at 807), the prune write-back (136),
and the resets (821, 832, 845, 892). ∎

### 5.3 Guards and firing

| # | Guard conjunct | Line | Notes |
|---|---|---|---|
| h0 | APP = "ehr" | ENG:805 | scribe instances never evaluate R-04 |
| h1 | d.user = true | ENG:807 | after DL1's location write |
| h2 | byMrn.has(m) | ENG:132–133 | |
| h3 | |{v.tab : v ∈ pruned views}| ≥ 4 | ENG:135–138 | R04_MIN_TABS = 4 (ENG:18), R04_WINDOW_MS = 40 000 (ENG:17) |
| h4 | p.priorNotes[0] exists | ENG:139–140 | the card's target document; DX-05 |
| h5 | ¬cards.has("r04:"+m) | ENG:76 | |
| h6 | ¬coolingDown("r04:"+m) | ENG:76 | |

Short-circuit truth table (same convention as §4): fire iff h0∧h1∧h2∧h3∧h4∧h5∧h6; the
first false conjunct in that order silences the evaluation; h0/h1 additionally skip the
append (after h1's failure the view is not recorded at all, while h0's failure skips
even the location write — h0 precedes ENG:806).

| h0 | h1 | h2 | h3 | h4 | h5 | h6 | outcome |
|---|---|---|---|---|---|---|---|
| F | – | – | – | – | – | – | nothing (not even lastTab) |
| T | F | – | – | – | – | – | lastTab updated; no append, no eval (DL1) |
| T | T | F | – | – | – | – | append happened; eval silent |
| T | T | T | F | – | – | – | silent (bump evaluated only — ENG:131) |
| T | T | T | T | F | – | – | silent |
| T | T | T | T | T | F | – | commit no-op |
| T | T | T | T | T | T | F | commit no-op |
| T | T | T | T | T | T | T | **commit r04:m** |

**T-R04-A (Firing condition).** In an EHR-hosted instance, r04:m is committed at a
user-view instant t iff the set {v.tab : v a user-provenance view of m received in
(t − 40 000 ms, t] with no reset boundary for m in (recv(v), t]} has cardinality ≥ 4,
and h2, h4, h5, h6 hold at t.
*Proof.* (⇐) By INV-N3 the pruned list at t is exactly that set of views; h3 compares
its distinct-tab cardinality to 4; commit follows. (⇒) The only commit site for id
r04:m is ENG:141, reached only through evalR04's guard chain; evalR04's only call site
is ENG:811, which executes only at user-view instants (h0, h1). The pruning at 135
discards precisely the views older than 40 s; the reset boundaries discarded the rest
(INV-N3 restated: the list contains exactly the user views since the last reset,
minus prune-evicted stale ones). ∎
Remark (repeats counted once): distinctness is over tab names via Set (ENG:137);
re-viewing one tab five times never fires.

**T-R04-B (No programmatic firing).** No sequence of events in which every
`ehr_tab_viewed` for m has d.user = false can commit r04:m.
*Proof.* evalR04's sole call site ENG:811 is dominated by the guard ENG:807
(`if (!d.user) break;`); with d.user always false, evalR04 is never invoked for m after
any such event, and no other code path commits id r04:m (grep-complete: ENG:141 is the
only `r04:` construction). The append at ENG:810 is likewise dominated, so even a later
user view starts from a list free of programmatic entries. ∎

Card content (ENG:141–151): type nav, tempo NOW, steps to priorNotes[0], alternates,
actions [show_me (primary), not_this (menu)], why-string includes the observed distinct
count and self-expiry promise (ENG:150). `show_me`: broadcast `nudg_cmd` **without**
commandId or target (ENG:330 — DX-06), remove own card with null outcome (mirroring to
other instances happens via the `nudge_acted` emission at ENG:294–295), close popover
without focus restore (ENG:332).

**Supersession (R-04's exit).** r04:m is removed with outcome `nudge_superseded` by:
document open / note filed / orders signed for m (ENG:846, no reason field); patient
switch away (ENG:817–819, reason "chart_switched"); chart close (ENG:833–835, reason
"chart_closed"). Superseded removals never start cooldowns (L-AMO(iii) restated:
startCooldown is called only from dismissWith, ENG:368) — a fresh hunt can re-fire
immediately, as designed.

### 5.4 TR-A — the maze trace (worked)

EHR instance; Holloway = m with priorNotes non-empty; no cooldowns. "u" marks
d.user = true.

| t (s) | event | tabViews[m] after | distinct | lastTab | outcome |
|---|---|---|---|---|---|
| 0.0 | ehr_patient_opened m | [] (reset, 821) | – | (unchanged) | activeMrn ← m; armR09 (825) |
| 0.0 | ehr_tab_viewed summary, ¬u (from openChart, EHR:142) | [] | – | summary (806) | h1 F: no append (DL1) |
| 2.1 | ehr_tab_viewed problems, u | [problems] | 1 | problems | h3 F (1 < 4); armR09 restart (812) |
| 5.4 | ehr_tab_viewed meds, u | [problems, meds] | 2 | meds | h3 F |
| 9.0 | ehr_tab_viewed allergies, u | [+allergies] | 3 | allergies | h3 F |
| 13.2 | ehr_tab_viewed labs, u | [+labs] | 4 | labs | h1..h6 T ⇒ **commit r04:m**; shown += 1; peek |
| 20.0 | ehr_tab_viewed labs, u | [+labs] (5 entries) | 4 | labs | h5 F: card already live (INV-N1 restated: one live card per id) |
| 31.0 | ehr_document_opened m | [] (845) | – | (unchanged) | r04:m superseded (846); armR09 (847) |
| 55.0 | (hypothetical user view) problems, u | [problems] | 1 | problems | fresh window; can re-climb to 4 — L-AMO(iii) |

Had the 13.2 s view instead occurred at t = 42.2 s: the prune at evaluation discards the
2.1 s entry (42.2 − 2.1 > 40), distinct = 3, silent — the sliding window as specified.

---

## 6. Rule R-09 — depth prompt (dwell + gate)

### 6.1 Arming: a sliding deadline

**D13 (ReArm set).** armR09(m) is invoked from exactly three intake sites (grep-complete):
- ehr_patient_opened m (ENG:825) — unconditionally after activeMrn ← m;
- ehr_tab_viewed m with d.user ∧ activeMrn = m (ENG:812);
- ehr_document_opened / ehr_note_filed / ehr_orders_signed for m with activeMrn = m
  (ENG:847).
Call these the **ReArm(m) events**. Programmatic tab views are **not** in ReArm(m)
(dominated by ENG:807), and — deliberately — they do not clear a pending timer either:
their effect on R-09 is confined to the location update (DL1) consulted at fire time.

**D14 (armR09).** ENG:155–202: clearTimeout(dwellTimer); dwellTimer ← null (156–157);
if ¬byMrn.has(m) ∨ ¬p.depthPack: return **disarmed** (158–159 — arming a depthPack-less
patient disarms the previous timer and arms nothing); else dwellTimer ←
setTimeout(fire-body, R09_DWELL_MS) (160, 201) with R09_DWELL_MS = 8 000 in demo mode,
90 000 otherwise (ENG:16, gated on `localStorage.nudg_demo_mode !== "0"`, ENG:15).
Disarm sites besides re-arm: chart close (ENG:830–831), demo_reset (ENG:894–897).

**INV-N4 (Dwell uniqueness).** At most one pending dwell callback exists per instance.
*Proof.* Every setTimeout at ENG:160 is textually preceded by clearTimeout at ENG:156
in the same synchronous body; dwellTimer is assigned only at ENG:157, 160, 830–831,
894–897, each adjacent to its clearTimeout; fabric SF6 restated (each task runs to
completion before another task of the agent runs) makes each body atomic. ∎

**L-SLIDE (Sliding deadline).** The dwell callback for m executes at time
t* = t_last + R09_DWELL_MS, where t_last is the time of the last ReArm(m) event, iff no
ReArm(any), chart-close, or demo_reset event occurs in (t_last, t*).
*Proof.* Each ReArm event replaces the single pending timer (INV-N4 restated: at most
one pending dwell callback per instance) with a fresh full-length one; chart close and
reset clear it; setTimeout fires once after its delay absent clearing (SF6; SF11's
throttling caveat can only delay t*, not duplicate it). Note the timer is **global to
the instance**, not per-mrn: a ReArm for m′ ≠ m silently cancels m's deadline — coupled
with the single activeMrn this is coherent (there is one "current dwell context"). ∎

### 6.2 Fire-time gates

The callback body (ENG:160–201) evaluates, in order:

| # | Gate | Line | On failure |
|---|---|---|---|
| f1 | activeMrn = m | ENG:161 | return (no metric) |
| f2 | (lastTabByMrn.get(m) ∥ "summary") = "summary" | ENG:164 | return (no metric). Comment ENG:162–163: "Depth prompts only interrupt the overview, never mid-navigation or a document read." The ∥ "summary" default covers the no-record case (a fresh open immediately records "summary" anyway via EHR:142 → ENG:806) |
| — | metrics.evaluated += 1 | ENG:165 | (bump occurs only past f1–f2 — DX-04) |
| f3 | ¬(noteSignals[m].topics ∋ "nutrition_referral") | ENG:166–167 | return — "the plan already owns it". noteSignals is populated in every instance (intake row 1 writes the map regardless of APP, ENG:793) |
| f4 | ¬cards.has(r04:m) ∧ referralState(m)?.status ≠ "draft" ∧ ¬cards.has(referral-draft:m) ∧ ¬cards.has(r12:m) | ENG:172 | return — the **no-stack guard**: depth never stacks on an unresolved navigation card, an open referral draft (either the shared draft state or the local draft card), or a pending watch card (comment ENG:168–171) |
| f5, f6 | commit gates ¬cards.has(r09:m), ¬coolingDown(r09:m) | ENG:76 | commit no-op |

followUpReview := (referralState(m)?.status = "simulated_sent") (ENG:173; reader
ENG:48 over the shared store D2).

**T-R09-FIRE (Firing condition).** In an EHR-hosted instance, r09:m is committed at
time t iff (i) some ReArm(m) event occurred at t − R09_DWELL_MS and no ReArm/disarm
event intervened (L-SLIDE), (ii) the patient exists with a depthPack (arm-time,
ENG:159), and (iii) f1 ∧ f2 ∧ f3 ∧ f4 ∧ f5 ∧ f6 at t.
*Proof.* Only commit site for r09:m is ENG:175, inside the callback; L-SLIDE gives the
timing; gates as tabulated, each an early return. ∎

**T-R09-GATE (Provenance-blind gate correctness).** f2 evaluates the doctor's true
resting tab even when the last navigation was programmatic.
*Proof.* Restating DL1 at its use site: lastTabByMrn is written at ENG:806 for **every**
`ehr_tab_viewed`, before the ENG:807 provenance guard; the emitter EHR:164 fires for
programmatic setTab calls (EHR:142, 396) with user = false. Hence at fire time the map
holds the last rendered tab regardless of provenance. ∎

### 6.3 The GATE-REJECT ABSORPTION state

**T-ABS (Absorption).** Consider any execution suffix for instance N and MRN m
containing no ReArm(m) event and no demo_reset. After the pending dwell callback (if
any) runs or is cleared, no commit of r09:m occurs in N during the suffix. In
particular, when the callback runs and **rejects at any gate f1–f6, the engine emits
nothing, schedules nothing, and remains silent until the next ReArm(m) event** — the
gate-reject absorption state.
*Proof.* The callback is one-shot (setTimeout semantics; INV-N4 restated: at most one
pending dwell callback per instance). Inspection of the callback body ENG:160–201: every
gate failure is a bare `return`; no branch calls setTimeout or armR09. New callbacks
arise only in armR09 (ENG:160), whose complete call-site set is D13 = the ReArm
handlers (ENG:812, 825, 847). With no ReArm(m) in the suffix, and noting armR09(m′)
only clears timers, no commit site for r09:m is reachable. ∎

**Traces entering absorption (enumeration).**
- **A1 — programmatic jump to a document (buddy walkthrough).** open_rhythm handoff
  lands: openChart (patient_opened ⇒ ReArm, ENG:825) → programmatic notes view
  (lastTab ← "notes", ENG:806; no ReArm) → row click ⇒ ehr_document_opened ⇒ ReArm
  (ENG:847). Deadline t* = that instant + 8 s; at t*: f2 sees "notes" ⇒ reject ⇒
  absorbed. The doctor reads the rhythm note in silence.
- **A2 — doctor clicks Notes and reads.** User view (ReArm, ENG:812) with
  lastTab ← "notes"; at t*: f2 reject ⇒ absorbed until the next click.
- **A3 — resting on any non-summary tab** (problems, labs, …): same shape as A2.
- **A4 — topic owned.** Scribe draft names a dietitian ⇒ note_signals topics ∋
  nutrition_referral (fabric D6) ⇒ f3 reject ⇒ absorbed; note_signals is **not** a
  ReArm event, so even deleting the dietitian line later does not revive the deadline
  until the next EHR-side ReArm(m).
- **A5 — no-stack.** r04:m live, or referral draft open, or r12 pending ⇒ f4 reject ⇒
  absorbed; frequently brief, because the superseding events that clear r04
  (document/file/sign) are themselves ReArm events (ENG:846–847).
- **A6 — patient switched before t\*.** f1 reject for m (and the switch already
  re-armed for the new patient, ENG:825).

**Design decision (explicit, accepted).** The code prefers **silence over
interruption**: rejection does not defer, queue, or retry the prompt; it drops it until
the next genuine activity (comment ENG:162–163; tempo contract DEEP in
`docs/design/NUDGE_CARDS_DESIGN.md` §4: "queued to natural pauses… never interrupts
typing"). Accepted consequence: a doctor who arrives programmatically and then only
reads/scrolls (no clicks) never receives the depth prompt for that dwell period — there
is no scroll- or focus-based ReArm.

### 6.4 followUpReview mode

When referralState(m).status = "simulated_sent" (ENG:173): headline "Referral recorded.
Review the decision in depth?" (177), follow-up frame (178–180), question ←
followUpQuestion ∥ question, quickScripted ← followUpQuickScripted ∥ quickScripted,
seats ← followUpSeats ∥ seats (183–185), followUpReview flag on the card (186), actions
reduced to [second_opinion (primary), dismiss] (187–191) — **the follow-up card cannot
draft another referral**; why-string variant (197–198). Otherwise actions are
[start_referral (primary), second_opinion, dismiss] (192–196). The flag also augments
the relay payload with the recorded simulated workflow (ENG:757–765).

### 6.5 TR-B — an R-09 trace that fires

Demo pacing (R09_DWELL_MS = 8 000). EHR instance; Holloway = m has depthPack; no
signals, no other cards, no cooldown.

| t (s) | event | dwell deadline | lastTab[m] | gates at fire | outcome |
|---|---|---|---|---|---|
| 0.0 | ehr_patient_opened m | 8.0 (ReArm, 825) | — | | activeMrn ← m |
| 0.0 | ehr_tab_viewed summary ¬u | 8.0 (not ReArm) | summary (806) | | DL1: location only |
| 3.0 | ehr_tab_viewed labs u | 11.0 (ReArm, 812) | labs | | evalR04: distinct 1 |
| 6.0 | ehr_tab_viewed summary u | 14.0 (ReArm) | summary | | distinct 2 |
| 14.0 | (dwell fires) | — | summary | f1 T, f2 T ("summary"), bump, f3 T, f4 T, f5–f6 T | **commit r09:m**: depth card, peek, nudge_committed |

### 6.6 TR-C — an R-09 trace absorbed by the gate

| t (s) | event | dwell deadline | lastTab[m] | outcome |
|---|---|---|---|---|
| 0.0 | ehr_patient_opened m | 8.0 | — | ReArm |
| 0.0 | ehr_tab_viewed summary ¬u | 8.0 | summary | |
| 2.5 | ehr_tab_viewed notes u | 10.5 | notes | ReArm (812); evalR04 distinct 1 |
| 10.5 | (dwell fires) | — | notes | f1 T; **f2 F** (notes ≠ summary) ⇒ return before the metric bump; nothing scheduled |
| 10.5 → ∞ | (doctor reads; scrolls; no clicks) | none | notes | **absorption** (T-ABS restated: with no ReArm(m) event, no commit of r09:m occurs); first later click (e.g., Summary tab at t = 95) re-arms and can fire at t = 103 |

---

## 7. The referral two-step and Rule R-12

**D15 (Referral workflow LTS).** Over the shared store W = nudg_referral_drafts (D2),
per m: W(m) ∈ {⊥, draft, simulated_sent}.

| Transition | Trigger (user action on a card) | State write | Card effects | Bus emissions | Lines |
|---|---|---|---|---|---|
| ⊥ → draft | start_referral on r09:m | W(m) ← {status: "draft", createdAt, simulated: true} | remove r09:m (null outcome); commit referral-draft:m (rule R-12, type watch, tempo DRAFT; actions [simulate_send, discard_referral]) | nudge_acted{start_referral} (294–295); referral_drafted{m, origin} (337) | ENG:333–337, 204–223 |
| draft → simulated_sent | simulate_send on referral-draft:m | W(m) ← {…, status: "simulated_sent", updatedAt, simulated: true} | remove referral-draft:m; commit r12:m (tempo WATCH; actions [acknowledge, dismiss]) | nudge_acted{simulate_send}; referral_simulated_sent{m, origin} (350) | ENG:338–350, 226–242 |
| draft → ⊥ | discard_referral on referral-draft:m | delete W(m) | remove referral-draft:m | nudge_acted{discard_referral} | ENG:351–356 |
| simulated_sent → (card gone) | acknowledge on r12:m | (no state change — status persists) | remove r12:m | nudge_acted{acknowledge} | ENG:359–361 |
| any → ⊥ | demo_reset | W ← {} | all cards cleared | — | ENG:904, 890 |

**T-R12 (Explicit-consent law).** W(m) = simulated_sent is reachable only through a
user click on the simulate_send button of a live referral-draft:m card (or the demo's
reset writing ⊥). Consequently the r12:m watch card, and the followUpReview variant of
R-09 (§6.4), are reachable only downstream of that explicit click.
*Proof.* Writers of status "simulated_sent": exactly ENG:341 (grep-complete over the
five sources). ENG:341 executes only in runAction with actionId = "simulate_send"
(ENG:338); runAction is invoked only from the two click listeners over live cards
(cards stack ENG:458–465; peek primary ENG:488–490), and "simulate_send" appears only
in the referral-draft card's actions (ENG:217–220). Mirror tabs commit the r12 card on
`referral_simulated_sent` (ENG:863–865) — an event emitted only at ENG:350, inside the
same click path. The R-12 card's own copy asserts the boundary (ENG:234: "No deadline
monitor runs, so this card will not return automatically"; ENG:240) — code agrees:
no timer, interval, or handler references r12 after commit. ∎

Remark (mirror rewrite): a mirroring EHR instance re-runs referralDraftCard (ENG:861),
which **re-writes** W(m) ← {status: "draft", createdAt: its-own-clock} (ENG:207–209)
into the shared store — last-writer-wins on createdAt (DX-14); status remains "draft".

**TR-E (two-step, single EHR instance).**

| t | act | W(m) | cards | emissions |
|---|---|---|---|---|
| 0 | TR-B fires | ⊥ | {r09:m} | nudge_committed |
| 5 | click start_referral | draft | {referral-draft:m} | nudge_acted, referral_drafted |
| 9 | dwell? — no pending timer (no ReArm since 0); had one fired: f4 rejects on draft state/card | draft | {referral-draft:m} | — |
| 20 | click simulate_send | simulated_sent | {r12:m} | nudge_acted, referral_simulated_sent |
| 30 | click acknowledge | simulated_sent | ∅ | nudge_acted |
| 40 | reopen chart m (ReArm); dwell fires at 48: f4 T (no draft, no cards), followUpReview = T | simulated_sent | {r09:m (follow-up variant)} | nudge_committed |

## 8. Cross-tab mirroring and supersession

**D16 (Outcome mirror).** Intake rows nudge_acted/nudge_dismissed/nudge_superseded
(ENG:849–859). Preconditions: evt.app = "buddy" ∧ d.origin ≠ INSTANCE_ID ∧
cards.has(d.id); for nudge_acted additionally d.action ∈ {open_rhythm, show_me,
start_referral, simulate_send, discard_referral, acknowledge} (ENG:853 — the allowlist
excludes second_opinion, which has no cross-tab effect, and unknown future actions).
Effect: local delete (ENG:855) **without** re-emission (removeCard is not called — no
echo, no outcome-event storm). Origin-filtering uses the per-instance uuid stamped into
every outcome emission (ENG:99, 295, 881).

**Supersession matrix (complete).** "→ event" entries carry outcome nudge_superseded.

| Card | Event-driven removal | Action-driven removal | Cooldown on removal? |
|---|---|---|---|
| r01:m | none | open_rhythm (ack-gated, ENG:882); dismiss menu (ENG:463 → 367–370) | only dismiss |
| r04:m | → document/file/sign (846); → chart_switched (817–819); → chart_closed (833–835) | show_me (331); not_this menu | only dismiss |
| r09:m | none | start_referral (335); dismiss | only dismiss |
| referral-draft:m | none | simulate_send (347); discard_referral (355) | never (no dismiss action) |
| r12:m | none | acknowledge (361); dismiss | only dismiss |
| all | demo_reset clears the Map (890) | — | stores zeroed (901–904) |

Restating L-AMO(ii) where it binds: a dismissal in any tab writes the shared cooldown
record, so no instance re-commits that id for 24 h·level (ENG:50–58, 76).

**CONJ-1 (Twin-EHR simultaneity).** Two EHR-hosted instances receiving the same event
stream compute R-04 over their own receive-clocks (ts = clk at ENG:809) and fire
near-simultaneously; the claims table (D9) then suppresses the second
`nudge_committed` within 15 s. CONJECTURE: exact simultaneity and claim-race freedom
are not provable from the fabric's SF3/SF4 (cross-process delivery latency and
localStorage race on the claim read-modify-write are unbounded); missing: a bound on
inter-process BroadcastChannel latency and an atomic claim primitive. Consequence of a
lost race: duplicate `nudge_committed` activity lines — benign, rendering unaffected.

---

## 9. Regression study — why provenance is separated (old vs. new)

The current semantics carries a boolean provenance flag on every tab view (emitter
EHR:164; DL1). Define the **old semantics O** as the same system with the flag absent
and the guard ENG:807 deleted (every view appended and evaluated). Define the **dual
mistake O′** as gating the location write ENG:806 behind d.user instead. Both are
counterfactuals reconstructed to exhibit the regression the current code guards
against; the current code is the only ground truth.

### TR-D1 — premature R-04 under O; silent under current semantics

The doctor opens Holloway's chart and deliberately visits three tabs. Note that
`openChart` always renders Summary programmatically (EHR:142) **after** the
patient-open reset (ENG:821 clears tabViews before the summary view arrives, since
EHR:141 emits patient_opened before EHR:142 emits the view — fabric T1 preserves this
order for every instance).

| t (s) | event | O: tabViews / distinct | current: tabViews / distinct | O outcome | current outcome |
|---|---|---|---|---|---|
| 0.0 | ehr_patient_opened m | [] | [] | reset | reset |
| 0.0 | tab_viewed summary (programmatic) | [summary] / 1 | [] / 0 (h1 F) | eval: silent | location only (DL1) |
| 3.0 | tab_viewed problems u | +problems / 2 | [problems] / 1 | silent | silent |
| 6.5 | tab_viewed meds u | +meds / 3 | +meds / 2 | silent | silent |
| 10.0 | tab_viewed allergies u | +allergies / **4** | +allergies / 3 | **commit r04:m — premature**: threshold crossed by the machine's own summary render; the doctor made three clicks | silent |
| 14.0 | tab_viewed labs u | (card live) | +labs / **4** | — | **commit r04:m** — on the fourth deliberate click |

Under O the effective human threshold is 3, not 4, whenever a chart open begins the
window — a wayfinding card fires at the moment a doctor has merely glanced at three
sections. Under the current semantics T-R04-B applies (restated: no sequence of
user = false views can commit r04:m, and such views are never appended), so only the
four deliberate clicks fire the rule.

### TR-D2 — R-09 interrupts a document read under O′; silent under current semantics

The buddy walkthrough (fabric §6.5) navigates programmatically to Notes and opens the
target row.

| t (s) | event | O′: lastTab[m] | current: lastTab[m] | dwell deadline | O′ at fire | current at fire |
|---|---|---|---|---|---|---|
| 0.0 | ehr_patient_opened m (walkthrough re-open) | (stale or unset) | — | 8.0 (ReArm 825) | | |
| 0.0 | tab_viewed summary ¬u | **unchanged** (gated) | summary | 8.0 | | |
| 0.1 | tab_viewed notes ¬u (EHR:396) | **unchanged** | notes | 8.0 | | |
| 0.2 | ehr_document_opened m (EHR:404 → 258) | unchanged | notes | 8.2 (ReArm 847) | | |
| 8.2 | dwell fires | "summary" (∥-default or stale) | notes | — | f2 **passes** on stale/default "summary" ⇒ **depth card interrupts the doctor mid-read** | f2 fails ("notes") ⇒ absorbed (T-ABS; trace A1) |

The two traces are the two halves of DL1 (restated: location provenance-blind so R-09's
gate sees the machine's navigation; activity provenance-sensitive so R-04's evidence
does not). Collapsing the separation in either direction produces a premature nudge —
TR-D1 a false navigation aid, TR-D2 a false interruption. This is stated in the code as
the paired comments ENG:806–807 and the emitter comment EHR:161–163.

---

## 10. Safety theorem — the action repertoire

**D17 (Repertoire).** Every side-effecting operation reachable from any engine state,
by exhaustive enumeration of ENG's statements:

| # | Operation | Sites | Boundary class |
|---|---|---|---|
| 1 | In-memory state writes (D1 maps/timers) | throughout | internal |
| 2 | DOM rendering in the hosting document: cards (438–451), panel (609–749), peek (470–531), toasts/announcements/badges via NudgBuddy API (87–89, 275, 326, 334, 349, 356, 360, 873, 883, 885) | as cited | own document |
| 3 | localStorage writes: cooldowns (58), claims (84), metrics (63), referral state (209, 346, 353–354), staged command write/remove (269, 271, 280, 871, 878, 899), reset zeroing (901–904) | as cited | origin-local storage |
| 4 | Bus emissions (fabric alphabet #22–28, 30) | 85, 99, 295, 307, 321, 324, 330, 337, 350, 881 | origin-local broadcast + ≤ 4 h sanitized log (fabric INV2–INV4) |
| 5 | Named-window operations: probe open("", "nudg-ehr") (250); navigate handle to "/ehr/" (314); handle.focus() (308, 315) | as cited | same-origin navigation/focus |
| 6 | window.open(card.research.url, "_blank", "noopener") | 362–364 | **dead code** — see proof below |
| 7 | Rendered research hyperlinks ⟨a href target="_blank" rel="noopener noreferrer"⟩ | 400–402 | cross-origin navigation, **user-clicked only** (browser-native anchor activation; no engine code path follows the URL) |
| 8 | fetch to RELAY = http://127.0.0.1:4809: GET /api/health (645, timeout 1 500); POST /api/quick (676, timeout 150 000); POST /api/panel (736, timeout 180 000); POST /api/cancel (585–590, keepalive) | as cited | loopback HTTP |
| 9 | fetch("/data/patients.json") (915) | boot | same-origin static read |
| 10 | Timers (setTimeout/clearTimeout) | passim | internal |

**Dead-code proof for #6.** runAction reaches ENG:362 only with
actionId = "open_research". Action ids originate from (a) the cards stack listener,
data-action of a rendered button (ENG:458–464) — buttons render only from
card.actions (ENG:422–424); (b) the peek primary = card.actions[0].id (ENG:489); (c)
the dismiss-menu reason buttons, which route to dismissWith instead (ENG:463). The
complete set of actions arrays constructed anywhere is: {open_rhythm, dismiss}
(ENG:121–124), {show_me, not_this} (146–149), {second_opinion, dismiss} ∨
{start_referral, second_opinion, dismiss} (187–196), {simulate_send, discard_referral}
(217–220), {acknowledge, dismiss} (236–239). "open_research" ∉ any of them. ∎
(Flagged as DX-03: the audited path is dead while the live anchors bypass runAction.)

**T-SAFE (No external side effect).** From every reachable engine state, every enabled
action is in D17, and:
(i) **No clinical or third-party system of record is written.** The only mutations
outside process memory are origin-local web storage (#3) and the sanitized rolling log
(#4). Every transition whose name suggests transmission — start_referral,
simulate_send, sign — terminates in storage writes plus simulated-flagged bus events
(T-R12; adjacent EHR surface: order signing writes sessionStorage only, confirm+alert,
`simulated: true` on the event, EHR:373–383).
(ii) **No engine-initiated network I/O leaves the machine.** #8 targets the loopback
literal 127.0.0.1:4809 (ENG:21); #9 is same-origin. These are the only fetch sites in
ENG (grep-complete).
(iii) **Cross-origin egress requires a human click** on a rendered research anchor
(#7); the engine never programmatically navigates cross-origin (#6 is dead; #5 is
same-origin by construction of the URL "/ehr/").
(iv) **Disclosure through the loopback relay is dataset-bounded and user-initiated.**
Restating fabric INV5 at its use site (no emitted or transmitted field depends on note
text except through Δ, lengths, and the matched bit): the relay payloads are
{runId, question, patient: chartFacts(p), context/seats} (ENG:676, 736); chartFacts
(ENG:751–767) projects only `patients.json` fields {name, age, sex, problems, meds,
allergies, vitals, labs, reason} plus `synthetic: true` and, in followUpReview, a
constant workflow record (757–765); `question`/`seats` come from the dataset depthPack
(ENG:183–185, 636–639). No note text, no typed clinician input is transmitted. The
lanes run only after the user clicks second_opinion (ENG:357–358 → 593–599 →
runQuick/runPanel), and lane changes or panel exit abort in-flight work
(cancelActiveRelay ENG:580–591, called at 600–601, 623, 786).
*Proof.* D17 is an exhaustive statement-level enumeration of ENG (verified by reading
the file end-to-end; fetch sites: 551, 585, 645-via-relay(), 676, 736, 915; window.open
sites: 250, 363; storage sites as tabulated). Claims (i)–(iv) are case checks over the
ten rows as argued inline. ∎
Boundary honesty: the relay process itself may forward to external model APIs
(Anthropic/Codex — `docs/TESTING.md` Phases 3, 5); that crossing occurs in a separate
process outside this subsystem, gated by the user's opt-in click, and receives
dataset-only content per (iv). A re-implementation must preserve (iv) if it repoints
RELAY.

---

## 11. Timing constants (as coded)

| Constant | Value (demo / real) | Site | Role |
|---|---|---|---|
| DEMO | localStorage nudg_demo_mode ≠ "0" | ENG:15 | pacing switch |
| R09_DWELL_MS | 8 000 / 90 000 | ENG:16 | R-09 dwell (L-SLIDE) |
| R04_WINDOW_MS | 40 000 | ENG:17 | R-04 sliding window |
| R04_MIN_TABS | 4 | ENG:18 | R-04 threshold |
| PEEK_TTL_MS | 14 000 | ENG:19, 522 | peek auto-hide |
| COOLDOWN_MS | 86 400 000 (×level ≤ 3) | ENG:20, 56–57 | dismissal cooldown 24/48/72 h |
| claim freshness | 15 000 | ENG:82 | nudge_committed dedup |
| staged-command TTL | 15 000 | ENG:267; consumer check EHR:437 | fabric L6 |
| command cleanup | 15 100 | ENG:277, 286 | producer-side purge |
| handoff warn | 3 500 | ENG:273–276 | "not confirmed" toast |
| ack lateness | clk > expiresAt | ENG:868 | late-ack refusal |
| relay health timeout / cache | 1 500 / 60 000 | ENG:645 / 643 | lane probe |
| quick / panel timeouts | 150 000 / 180 000 | ENG:676 / 736 | lane requests |
| peek show-class delay | 20 | ENG:517–519 | CSS transition kick |
| spotlight glow | 6 000 | EHR:418 | post-command highlight |
| walkthrough row delay | 60 | EHR:397 | DOM settle before row click |
| note-signal debounce | 700 | SCR:426 | Δ emission (fabric D6) |
| scribe draft delays | 1 800 (post-stop) / 700 (generate) | SCR:180 / SCR:469 | simulated drafting |
| assistant reply delay | 900 + rand·600 | SCR:399 | scripted typing |
| buddy toast / onboarding / typing-fade / cursor-park | 2 300 / 1 200 / 1 100 / 450 | BUD:268 / 417 / 371 / 358 | surface pacing |
| bus log capacity / TTL | 100 / 4 h | BUS:10 / BUS:11 | fabric INV2–INV3 |

**CONJ-2 (Hidden-tab latency).** Under fabric SF11 (background timer throttling), the
EHR-side 60 ms walkthrough delay (EHR:397) and the ack round-trip can stretch to ≈ 1 s+
while the EHR tab is hidden, occasionally outrunning the 3 500 ms warn toast
(ENG:273–276) but never the 15 000 ms validity bound (fabric L6 restated: no staged
execution later than 15 s after staging). CONJECTURE: a tight worst-case bound is not
derivable — browser throttling policies are implementation-defined; missing: per-engine
timer-clamp specifications.

---

## 12. Discrepancies and defects observed

Neutral list; each item states what the code does, with lines. None is corrected here.

- **DX-01** R-12 card hardcodes the due date string "Saturday, Jul 25" (ENG:231) and
  chartFacts hardcodes due "2026-07-25" (ENG:763) — static demo dates; they drift if
  the demo runs another week.
- **DX-02** APP detection sniffs document.title for "LegacyChart"/"gallery" (ENG:11–12;
  EHR title `ehr/index.html:6`). Retitling either app silently reclassifies the engine
  instance (rules gate on APP throughout: 794, 797, 805, 816, 828, 844, 861, 864, 867).
- **DX-03** `open_research` is dead code (ENG:362–364; proof in §10). Live research
  links are plain anchors (ENG:400–402) that bypass runAction — opening a source emits
  no nudge_acted, so research consultation is invisible to the activity trail.
- **DX-04** Metric asymmetry: "evaluated" bumps at entry for R-01/R-04 (ENG:106, 131)
  but only past gates f1–f2 for R-09 (ENG:165); gate-rejected dwells at f1/f2 are
  uncounted, at f3/f4 counted. The single global counter cannot be decomposed per rule.
- **DX-05** R-04 requires priorNotes[0] (ENG:139–140): a patient without prior notes
  never yields a wayfinding card regardless of hunting; the card always targets
  priorNotes[0], which need not be what the doctor hunts (docs gallery example
  acknowledges the guess: "in case the target guess is wrong", NUDGE_CARDS_DESIGN §7 S2).
- **DX-06** show_me emits nudg_cmd with no commandId, no targetEhrInstanceId, no staging
  (ENG:330): no acknowledgment or retry path (contrast open_rhythm, ENG:297–328), and
  with two EHR tabs open both execute the walkthrough (EHR:491–495 filter passes when
  the stamp is absent).
- **DX-07** Acted/superseded cards never cool down (L-AMO(iii)); R-01 can re-commit
  after an impressions toggle off→on because the emitter's dedup (SCR:417–419)
  suppresses only *identical consecutive* triples. `docs/TESTING.md:37` ("no second
  card appears") holds for monotone additive typing only.
- **DX-08** Twin same-app tabs clobber each other's activeMrn: the gates accept any
  emitter of the same app id (ENG:797, 816), so tab B's active patient follows tab A's
  navigation. Single-instance-per-app is an implicit deployment assumption
  (cf. CONJ-1).
- **DX-09** Staged-command TOCTOU across process-isolated tabs — fabric L5; accepted,
  bounded by the 15 s TTL (fabric L6) and the single-owner discipline (fabric §6.4).
- **DX-10** Cooldown level ratchets up and never decays (ENG:56–57); after three
  dismissals an id stays at 72 h per dismissal until a demo_reset wipes the store
  (ENG:901).
- **DX-11** EHR init purges localStorage keys prefixed "ehr_" (EHR:449–452) although
  EHR persistence lives in sessionStorage (EHR:34–39); vestigial migration code.
  resetLocal purges both stores (EHR:508–517).
- **DX-12** Scribe reload divergence: noteReady/reviewed persist (sessionStorage,
  SCR:48–59) but edited note HTML lives only in the in-memory noteDraftHtml map
  (SCR:34, 98–101); after a reload a "Reviewed ✓" note re-renders pristine
  initialNoteHtml (SCR:239) — review status can attach to content the reviewer never
  saw. Checked the suspected "Generate note overwrites edits" defect: **not present**
  in this code — every input persists the draft (SCR:472) and renderNote prefers the
  saved draft over regeneration (SCR:239), so regenerate re-shows the edited draft.
- **DX-13** runQuick: a live response with a truthy mode but empty text paints nothing
  and never downgrades the "SCRIPTED · LIVE LANE DELIBERATING…" note (ENG:672,
  677–681); the stale pending caption persists until lane switch or panel exit.
- **DX-14** The referral_drafted mirror re-writes the shared workflow record with its
  own createdAt (ENG:861 → 207–209); actor's timestamp is overwritten (status
  unaffected).
- **DX-15** The engine stamps app = "buddy" on its emissions while hosted inside the
  scribe/EHR documents (ENG:85, 99, 295, …): consumers must not infer the hosting
  document from the app field (the intake gates at ENG:797/816 rely on this — they
  filter *out* buddy-stamped copies of app events, and the mirror rows filter *for*
  them).

---

## 13. Obligations index

| Item | Statement (short) | Status |
|---|---|---|
| D1–D17 | state, intake, lifecycle, rules, workflow, repertoire | defined |
| DL1 | where-vs-did provenance separation (ENG:806–807; EHR:161–164) | design law; consequences proved (T-R04-B, T-R09-GATE); failure modes exhibited (TR-D1, TR-D2) |
| INV-N1 | one live card per id per instance | proved |
| INV-N3 | tabViews contents | proved (induction) |
| INV-N4 | dwell-timer uniqueness | proved |
| INV-N5 | visibility = active-patient filter | proved in situ (§3.4) |
| L-AMO | at-most-once per (rule, mrn, window); cooldown/cross-tab clauses | proved |
| L-SLIDE | R-09 sliding deadline | proved |
| T-R01 | R-01 firing condition | proved |
| T-R04-A / T-R04-B | R-04 iff-condition; no programmatic firing | proved |
| T-R09-FIRE / T-R09-GATE / T-ABS | R-09 firing; gate correctness; gate-reject absorption | proved |
| T-R12 | simulated-send explicit-consent law | proved |
| T-SAFE | no external side effect; repertoire closed | proved (with boundary honesty on the loopback relay) |
| CONJ-1 | twin-tab simultaneity / claim race | CONJECTURE (missing: delivery-latency bound, atomic claims) |
| CONJ-2 | hidden-tab worst-case latency | CONJECTURE (missing: engine throttling specs) |
| TR-R01, TR-A, TR-B, TR-C, TR-D1, TR-D2, TR-E | worked traces incl. the required (a)–(d) set | exhibited |
| DX-01…DX-15 | discrepancies and defects | recorded, neutral |

End of Rule-Engine specification. Companion document:
`agentB_spec_event_fabric.md` (event fabric: alphabet, platform SPEC-FACTs, privacy
non-interference, rolling log, cross-tab surface ownership).
